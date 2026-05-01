"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type { ProjectReviewerAccessData } from "@/lib/tenant/reviewer-access-service";

type StatusMessage =
  | {
      tone: "success" | "error";
      text: string;
    }
  | null;

type ProjectReviewerAccessPanelProps = {
  projectId: string;
  data: ProjectReviewerAccessData;
};

export function ProjectReviewerAccessPanel({
  projectId,
  data,
}: ProjectReviewerAccessPanelProps) {
  const t = useTranslations("projects.detail.reviewerAccess");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const assignableReviewers = useMemo(
    () =>
      data.eligibleReviewers.filter(
        (reviewer) => !reviewer.hasProjectAccess && !reviewer.hasTenantWideAccess,
      ),
    [data.eligibleReviewers],
  );
  const tenantWideReviewers = data.eligibleReviewers.filter(
    (reviewer) => reviewer.hasTenantWideAccess,
  );
  const [selectedUserId, setSelectedUserId] = useState(assignableReviewers[0]?.userId ?? "");
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);

  async function handleResponse(response: Response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message ?? t("error"));
    }

    return payload;
  }

  function grantProjectAccess() {
    if (!selectedUserId) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/reviewer-access`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: selectedUserId,
          }),
        });

        await handleResponse(response);
        setStatusMessage({ tone: "success", text: t("granted") });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("error"),
        });
      }
    });
  }

  function revokeProjectAccess(userId: string) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/projects/${projectId}/reviewer-access/${userId}`, {
          method: "DELETE",
        });

        await handleResponse(response);
        setStatusMessage({ tone: "success", text: t("revoked") });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("error"),
        });
      }
    });
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
      <div className="space-y-1">
        <h2 className="text-base font-semibold text-zinc-900">{t("title")}</h2>
        <p className="text-sm text-zinc-600">{t("subtitle")}</p>
      </div>

      {statusMessage ? (
        <p
          className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
            statusMessage.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {statusMessage.text}
        </p>
      ) : null}

      <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-zinc-800">{t("reviewerLabel")}</span>
          <select
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
            disabled={assignableReviewers.length === 0 || isPending}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-500"
          >
            {assignableReviewers.length === 0 ? (
              <option value="">{t("noneAvailable")}</option>
            ) : (
              assignableReviewers.map((reviewer) => (
                <option key={reviewer.userId} value={reviewer.userId}>
                  {reviewer.email}
                </option>
              ))
            )}
          </select>
        </label>
        <button
          type="button"
          onClick={grantProjectAccess}
          disabled={!selectedUserId || isPending}
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("grant")}
        </button>
      </div>

      <div className="mt-4">
        {data.assignments.length === 0 ? (
          <p className="text-sm text-zinc-600">{t("empty")}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {data.assignments.map((assignment) => (
              <li
                key={assignment.assignmentId}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <span className="text-zinc-900">{assignment.email}</span>
                <button
                  type="button"
                  onClick={() => revokeProjectAccess(assignment.userId)}
                  disabled={isPending}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {tenantWideReviewers.length > 0 ? (
        <p className="mt-3 text-sm text-zinc-600">
          {t("tenantWideNote", {
            emails: tenantWideReviewers.map((reviewer) => reviewer.email).join(", "),
          })}
        </p>
      ) : null}
    </section>
  );
}
