"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

type PhotographerOption = {
  userId: string;
  email: string;
};

type ExistingWorkspace = {
  id: string;
  photographerUserId: string | null;
  name: string;
};

type ProjectWorkspaceStaffingFormProps = {
  projectId: string;
  photographers: PhotographerOption[];
  existingWorkspaces: ExistingWorkspace[];
};

function buildDefaultWorkspaceName(email: string) {
  const localPart = email.split("@")[0]?.trim() ?? "";
  return localPart.length > 0 ? `${localPart} capture` : "Photographer capture";
}

export function ProjectWorkspaceStaffingForm({
  projectId,
  photographers,
  existingWorkspaces,
}: ProjectWorkspaceStaffingFormProps) {
  const router = useRouter();
  const t = useTranslations("projects.workspaces");
  const tErrors = useTranslations("errors");
  const [selectedPhotographerUserId, setSelectedPhotographerUserId] = useState(
    photographers[0]?.userId ?? "",
  );
  const [workspaceName, setWorkspaceName] = useState(
    photographers[0]?.email ? buildDefaultWorkspaceName(photographers[0].email) : "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assignedPhotographerIds = useMemo(
    () =>
      new Set(
        existingWorkspaces
          .map((workspace) => workspace.photographerUserId)
          .filter((value): value is string => typeof value === "string" && value.length > 0),
      ),
    [existingWorkspaces],
  );

  const availablePhotographers = useMemo(
    () =>
      photographers.filter((photographer) => !assignedPhotographerIds.has(photographer.userId)),
    [assignedPhotographerIds, photographers],
  );

  const selectedPhotographer =
    availablePhotographers.find((photographer) => photographer.userId === selectedPhotographerUserId) ??
    availablePhotographers[0] ??
    null;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedPhotographer) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/workspaces`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          photographerUserId: selectedPhotographer.userId,
          name: workspaceName.trim() || buildDefaultWorkspaceName(selectedPhotographer.email),
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (availablePhotographers.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
        <p className="font-medium text-zinc-900">{t("staffingTitle")}</p>
        <p className="mt-1">{t("allPhotographersAssigned")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900">{t("staffingTitle")}</h3>
        <p className="mt-1 text-sm text-zinc-600">{t("staffingSubtitle")}</p>
      </div>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("photographerLabel")}</span>
        <select
          value={selectedPhotographer?.userId ?? ""}
          onChange={(event) => {
            const nextPhotographer =
              availablePhotographers.find((photographer) => photographer.userId === event.target.value) ??
              null;
            setSelectedPhotographerUserId(event.target.value);
            setWorkspaceName(
              nextPhotographer
                ? buildDefaultWorkspaceName(nextPhotographer.email)
                : "",
            );
          }}
          disabled={isSubmitting}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
        >
          {availablePhotographers.map((photographer) => (
            <option key={photographer.userId} value={photographer.userId}>
              {photographer.email}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("workspaceNameLabel")}</span>
        <input
          type="text"
          value={workspaceName}
          onChange={(event) => setWorkspaceName(event.target.value)}
          disabled={isSubmitting}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
        />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting || !selectedPhotographer}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
      >
        {isSubmitting ? t("assigning") : t("assign")}
      </button>
    </form>
  );
}
