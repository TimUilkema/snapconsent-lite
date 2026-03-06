"use client";

import { FormEvent, useMemo, useState } from "react";

import { InviteSharePanel } from "@/components/projects/invite-actions";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";

type CreateInviteResponse = {
  inviteId: string;
  invitePath?: string;
  inviteUrl?: string;
  expiresAt: string | null;
};

type CreateInviteFormProps = {
  projectId: string;
  templates: ConsentTemplateOption[];
  defaultTemplateId: string | null;
};

type ConsentTemplateOption = {
  id: string;
  template_key: string;
  version: string;
};

type InvitePayload = {
  inviteId: string;
  invitePath: string;
  expiresAt: string | null;
};

function normalizeInvitePath(payload: CreateInviteResponse | null) {
  if (!payload) {
    return null;
  }

  if (typeof payload.invitePath === "string" && payload.invitePath.startsWith("/")) {
    return payload.invitePath;
  }

  if (typeof payload.inviteUrl === "string" && payload.inviteUrl.length > 0) {
    try {
      const parsed = new URL(payload.inviteUrl);
      if (parsed.pathname.startsWith("/")) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function CreateInviteForm({
  projectId,
  templates,
  defaultTemplateId,
}: CreateInviteFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    defaultTemplateId ?? templates[0]?.id ?? "",
  );
  const expiresAtLabel = useMemo(() => {
    if (!payload?.expiresAt) {
      return "No expiry";
    }

    return new Date(payload.expiresAt).toLocaleString();
  }, [payload?.expiresAt]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!selectedTemplateId) {
        setError("Select a consent template before creating an invite.");
        setIsSubmitting(false);
        return;
      }

      const idempotencyKey = createIdempotencyKey();
      const response = await fetch(`/api/projects/${projectId}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ consentTemplateId: selectedTemplateId }),
      });

      const responsePayload = (await response.json().catch(() => null)) as
        | (CreateInviteResponse & { message?: string })
        | null;
      const invitePath = normalizeInvitePath(responsePayload);

      if (!response.ok || !responsePayload?.inviteId || !invitePath) {
        setError(responsePayload?.message ?? "Unable to create invite.");
        return;
      }

      setPayload({
        inviteId: responsePayload.inviteId,
        invitePath,
        expiresAt: responsePayload.expiresAt ?? null,
      });
    } catch {
      setError("Unable to create invite.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasTemplates = templates.length > 0;

  return (
    <section className="content-card space-y-3 rounded-2xl p-4">
      <h2 className="text-sm font-semibold text-zinc-900">Create Subject Invite</h2>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">Consent template</span>
          <select
            className="w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            disabled={!hasTemplates}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.template_key} {template.version}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isSubmitting || !hasTemplates || !selectedTemplateId}
          className="rounded-full bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {isSubmitting ? "Creating..." : "Create Invite URL"}
        </button>
      </form>
      {!hasTemplates ? (
        <p className="text-sm text-red-700">No consent templates are available.</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {payload ? (
        <div className="space-y-2 text-sm">
          <p>
            <span className="font-medium">Invite ID:</span> {payload.inviteId}
          </p>
          <p>
            <span className="font-medium">Expires:</span> {expiresAtLabel}
          </p>
          <InviteSharePanel invitePath={payload.invitePath} defaultShowQr />
        </div>
      ) : null}
    </section>
  );
}
