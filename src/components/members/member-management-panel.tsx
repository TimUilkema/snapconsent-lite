"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type {
  TenantMemberManagementData,
  TenantMemberRecord,
  TenantPendingInviteRecord,
} from "@/lib/tenant/member-management-service";

type StatusMessage =
  | {
      tone: "success" | "error" | "info";
      text: string;
    }
  | null;

type MemberManagementPanelProps = {
  data: TenantMemberManagementData;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export function MemberManagementPanel({ data }: MemberManagementPanelProps) {
  const t = useTranslations("members");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"admin" | "reviewer" | "photographer">("photographer");
  const [memberRoles, setMemberRoles] = useState<Record<string, string>>(
    Object.fromEntries(data.members.map((member) => [member.userId, member.role])),
  );
  const [inviteRoles, setInviteRoles] = useState<Record<string, string>>(
    Object.fromEntries(data.pendingInvites.map((invite) => [invite.inviteId, invite.role])),
  );
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);

  async function handleResponse(response: Response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message ?? t("errors.fallback"));
    }

    return payload;
  }

  function setErrorMessage(message: string) {
    setStatusMessage({
      tone: "error",
      text: message,
    });
  }

  function setSuccessMessage(message: string) {
    setStatusMessage({
      tone: "success",
      text: message,
    });
  }

  function submitInvite() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/members/invites", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            email: inviteEmail,
            role: inviteRole,
          }),
        });

        const payload = await handleResponse(response);
        setInviteEmail("");
        setSuccessMessage(
          payload.outcome === "already_member" ? t("invite.alreadyMember") : t("invite.success"),
        );
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  function updateMemberRole(member: TenantMemberRecord) {
    const nextRole = memberRoles[member.userId] ?? member.role;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: nextRole,
          }),
        });

        await handleResponse(response);
        setSuccessMessage(t("membersTable.roleUpdated"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  function removeMember(member: TenantMemberRecord) {
    if (!window.confirm(t("membersTable.removeConfirm", { email: member.email }))) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}`, {
          method: "DELETE",
        });

        await handleResponse(response);
        setSuccessMessage(t("membersTable.removed"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  function resendInvite(invite: TenantPendingInviteRecord) {
    const nextRole = inviteRoles[invite.inviteId] ?? invite.role;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/invites/${invite.inviteId}/resend`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            role: nextRole,
          }),
        });

        await handleResponse(response);
        setSuccessMessage(t("pendingInvites.resent"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  function revokeInvite(invite: TenantPendingInviteRecord) {
    if (!window.confirm(t("pendingInvites.revokeConfirm", { email: invite.email }))) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/invites/${invite.inviteId}/revoke`, {
          method: "POST",
        });

        await handleResponse(response);
        setSuccessMessage(t("pendingInvites.revoked"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  return (
    <div className="space-y-6">
      {statusMessage ? (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${
            statusMessage.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : statusMessage.tone === "info"
                ? "border-zinc-200 bg-zinc-50 text-zinc-700"
                : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {statusMessage.text}
        </p>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900">{t("invite.title")}</h2>
          <p className="text-sm text-zinc-600">{t("invite.subtitle")}</p>
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-800">{t("invite.emailLabel")}</span>
            <input
              type="email"
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              placeholder={t("invite.emailPlaceholder")}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-800">{t("invite.roleLabel")}</span>
            <select
              value={inviteRole}
              onChange={(event) => setInviteRole(event.target.value as typeof inviteRole)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="admin">{t("roles.admin")}</option>
              <option value="reviewer">{t("roles.reviewer")}</option>
              <option value="photographer">{t("roles.photographer")}</option>
            </select>
          </label>
          <button
            type="button"
            onClick={submitInvite}
            disabled={isPending}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isPending ? t("invite.submitting") : t("invite.submit")}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900">{t("membersTable.title")}</h2>
          <p className="text-sm text-zinc-600">{t("membersTable.subtitle")}</p>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-600">
                <th className="py-2 pr-4 font-medium">{t("membersTable.columns.email")}</th>
                <th className="py-2 pr-4 font-medium">{t("membersTable.columns.role")}</th>
                <th className="py-2 pr-4 font-medium">{t("membersTable.columns.joined")}</th>
                <th className="py-2 font-medium">{t("membersTable.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => (
                <tr key={member.userId} className="border-b border-zinc-100 align-top last:border-b-0">
                  <td className="py-3 pr-4 text-zinc-900">{member.email}</td>
                  <td className="py-3 pr-4">
                    {member.canEdit ? (
                      <select
                        value={memberRoles[member.userId] ?? member.role}
                        onChange={(event) =>
                          setMemberRoles((current) => ({
                            ...current,
                            [member.userId]: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                      >
                        <option value="admin">{t("roles.admin")}</option>
                        <option value="reviewer">{t("roles.reviewer")}</option>
                        <option value="photographer">{t("roles.photographer")}</option>
                      </select>
                    ) : (
                      <span className="text-zinc-900">{t("roles.owner")}</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 text-zinc-600">{formatDateTime(member.createdAt)}</td>
                  <td className="py-3">
                    {member.canEdit ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateMemberRole(member)}
                          disabled={isPending}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("membersTable.saveRole")}
                        </button>
                        <button
                          type="button"
                          onClick={() => removeMember(member)}
                          disabled={isPending}
                          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("membersTable.remove")}
                        </button>
                      </div>
                    ) : (
                      <span className="text-zinc-500">{t("membersTable.ownerNote")}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900">{t("pendingInvites.title")}</h2>
          <p className="text-sm text-zinc-600">{t("pendingInvites.subtitle")}</p>
        </div>
        {data.pendingInvites.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600">{t("pendingInvites.empty")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-zinc-600">
                  <th className="py-2 pr-4 font-medium">{t("pendingInvites.columns.email")}</th>
                  <th className="py-2 pr-4 font-medium">{t("pendingInvites.columns.role")}</th>
                  <th className="py-2 pr-4 font-medium">{t("pendingInvites.columns.expires")}</th>
                  <th className="py-2 font-medium">{t("pendingInvites.columns.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingInvites.map((invite) => (
                  <tr key={invite.inviteId} className="border-b border-zinc-100 align-top last:border-b-0">
                    <td className="py-3 pr-4 text-zinc-900">{invite.email}</td>
                    <td className="py-3 pr-4">
                      <select
                        value={inviteRoles[invite.inviteId] ?? invite.role}
                        onChange={(event) =>
                          setInviteRoles((current) => ({
                            ...current,
                            [invite.inviteId]: event.target.value,
                          }))
                        }
                        className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                      >
                        <option value="admin">{t("roles.admin")}</option>
                        <option value="reviewer">{t("roles.reviewer")}</option>
                        <option value="photographer">{t("roles.photographer")}</option>
                      </select>
                    </td>
                    <td className="py-3 pr-4 text-zinc-600">{formatDateTime(invite.expiresAt)}</td>
                    <td className="py-3">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => resendInvite(invite)}
                          disabled={isPending}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("pendingInvites.resend")}
                        </button>
                        <button
                          type="button"
                          onClick={() => revokeInvite(invite)}
                          disabled={isPending}
                          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("pendingInvites.revoke")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
