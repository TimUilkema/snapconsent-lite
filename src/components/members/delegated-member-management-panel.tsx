"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import type {
  OrganizationUserDirectoryData,
  OrganizationUserDirectoryMemberRecord,
  OrganizationUserDirectoryPendingInviteRecord,
} from "@/lib/tenant/member-management-service";
import type { ManageableMembershipRole } from "@/lib/tenant/role-capabilities";

type StatusMessage =
  | {
      tone: "success" | "error";
      text: string;
    }
  | null;

type DelegatedMemberManagementPanelProps = {
  data: OrganizationUserDirectoryData;
};

type DelegatedMemberManagementPanelViewProps = {
  data: OrganizationUserDirectoryData;
  statusMessage: StatusMessage;
  isPending: boolean;
  inviteEmail: string;
  inviteRole: ManageableMembershipRole;
  inviteRoles: Record<string, ManageableMembershipRole>;
  memberRoles: Record<string, ManageableMembershipRole>;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: ManageableMembershipRole) => void;
  onSubmitInvite: () => void;
  onPendingInviteRoleChange: (inviteId: string, role: ManageableMembershipRole) => void;
  onResendInvite: (invite: OrganizationUserDirectoryPendingInviteRecord) => void;
  onRevokeInvite: (invite: OrganizationUserDirectoryPendingInviteRecord) => void;
  onMemberRoleChange: (userId: string, role: ManageableMembershipRole) => void;
  onUpdateMemberRole: (member: OrganizationUserDirectoryMemberRecord) => void;
  onRemoveMember: (member: OrganizationUserDirectoryMemberRecord) => void;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function mapDelegatedError(error: string | undefined, fallback: string, t: ReturnType<typeof useTranslations>) {
  switch (error) {
    case "organization_user_invite_forbidden":
      return t("delegated.inviteForbidden");
    case "tenant_membership_invite_forbidden":
      return t("delegated.inviteMutationForbidden");
    case "organization_user_role_change_forbidden":
      return t("delegated.roleChangeForbidden");
    case "organization_user_remove_forbidden":
      return t("delegated.removeForbidden");
    case "organization_user_target_forbidden":
      return t("delegated.targetForbidden");
    case "organization_user_self_target_forbidden":
      return t("delegated.selfTargetForbidden");
    case "invalid_membership_role":
      return t("delegated.invalidRole");
    case "owner_membership_immutable":
      return t("delegated.targetForbidden");
    default:
      return fallback;
  }
}

export function DelegatedMemberManagementPanelView({
  data,
  statusMessage,
  isPending,
  inviteEmail,
  inviteRole,
  inviteRoles,
  memberRoles,
  onInviteEmailChange,
  onInviteRoleChange,
  onSubmitInvite,
  onPendingInviteRoleChange,
  onResendInvite,
  onRevokeInvite,
  onMemberRoleChange,
  onUpdateMemberRole,
  onRemoveMember,
}: DelegatedMemberManagementPanelViewProps) {
  const t = useTranslations("members");
  const canInvite = data.access.canInviteOrganizationUsers && data.access.allowedInviteRoles.length > 0;
  const canMutateMembers = data.access.canChangeOrganizationUserRoles || data.access.canRemoveOrganizationUsers;
  const hasVisibleDirectory = data.access.canViewOrganizationUsers;
  const hasAnyRows = data.members.length > 0 || data.pendingInvites.length > 0;
  const allowedInviteRoles = useMemo(
    () => data.access.allowedInviteRoles,
    [data.access.allowedInviteRoles],
  );

  return (
    <div className="space-y-6">
      {statusMessage ? (
        <p
          className={`rounded-lg border px-3 py-2 text-sm ${
            statusMessage.tone === "error"
              ? "border-red-200 bg-red-50 text-red-700"
              : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {statusMessage.text}
        </p>
      ) : null}

      <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
        {canInvite
          ? t("delegated.inviteHelper")
          : canMutateMembers
            ? t("delegated.mutationHelper")
            : t("delegated.readOnly")}
      </p>

      {canInvite ? (
        <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-900">{t("invite.title")}</h2>
            <p className="text-sm text-zinc-600">{t("delegated.inviteSubtitle")}</p>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-800">{t("invite.emailLabel")}</span>
              <input
                type="email"
                value={inviteEmail}
                onChange={(event) => onInviteEmailChange(event.target.value)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                placeholder={t("invite.emailPlaceholder")}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-zinc-800">{t("invite.roleLabel")}</span>
              <select
                value={inviteRole}
                onChange={(event) => onInviteRoleChange(event.target.value as ManageableMembershipRole)}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              >
                {allowedInviteRoles.map((role) => (
                  <option key={role} value={role}>{t(`roles.${role}`)}</option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onSubmitInvite}
              disabled={isPending}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? t("invite.submitting") : t("invite.submit")}
            </button>
          </div>
        </section>
      ) : null}

      {hasVisibleDirectory ? (
        <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-900">{t("membersTable.title")}</h2>
            <p className="text-sm text-zinc-600">{t("delegated.membersSubtitle")}</p>
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
                  <tr key={member.userId} className="border-b border-zinc-100 last:border-b-0">
                    <td className="py-3 pr-4 text-zinc-900">{member.email}</td>
                    <td className="py-3 pr-4 text-zinc-700">
                      {member.canChangeRole ? (
                        <select
                          value={memberRoles[member.userId] ?? member.role}
                          onChange={(event) =>
                            onMemberRoleChange(member.userId, event.target.value as ManageableMembershipRole)
                          }
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                        >
                          {member.allowedRoleOptions.map((role) => (
                            <option key={role} value={role}>{t(`roles.${role}`)}</option>
                          ))}
                        </select>
                      ) : (
                        t(`roles.${member.role}`)
                      )}
                    </td>
                    <td className="py-3 pr-4 text-zinc-600">{formatDateTime(member.createdAt)}</td>
                    <td className="py-3">
                      {member.canChangeRole || member.canRemove ? (
                        <div className="flex flex-wrap gap-2">
                          {member.canChangeRole ? (
                            <button
                              type="button"
                              onClick={() => onUpdateMemberRole(member)}
                              disabled={isPending}
                              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("membersTable.saveRole")}
                            </button>
                          ) : null}
                          {member.canRemove ? (
                            <button
                              type="button"
                              onClick={() => onRemoveMember(member)}
                              disabled={isPending}
                              className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {t("membersTable.remove")}
                            </button>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-zinc-500">{t("delegated.readOnlyAction")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900">{t("pendingInvites.title")}</h2>
          <p className="text-sm text-zinc-600">
            {hasVisibleDirectory ? t("delegated.pendingInvitesSubtitle") : t("delegated.ownInvitesSubtitle")}
          </p>
        </div>
        {data.pendingInvites.length === 0 ? (
          <p className="mt-4 text-sm text-zinc-600">
            {hasAnyRows ? t("pendingInvites.empty") : t("delegated.empty")}
          </p>
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
                      {invite.canResend ? (
                        <select
                          value={inviteRoles[invite.inviteId] ?? invite.role}
                          onChange={(event) =>
                            onPendingInviteRoleChange(
                              invite.inviteId,
                              event.target.value as ManageableMembershipRole,
                            )
                          }
                          className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                        >
                          {invite.allowedRoleOptions.map((role) => (
                            <option key={role} value={role}>{t(`roles.${role}`)}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-zinc-700">{t(`roles.${invite.role}`)}</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-zinc-600">{formatDateTime(invite.expiresAt)}</td>
                    <td className="py-3">
                      {invite.canResend || invite.canRevoke ? (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => onResendInvite(invite)}
                            disabled={isPending || !invite.canResend}
                            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {t("pendingInvites.resend")}
                          </button>
                          <button
                            type="button"
                            onClick={() => onRevokeInvite(invite)}
                            disabled={isPending || !invite.canRevoke}
                            className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {t("pendingInvites.revoke")}
                          </button>
                        </div>
                      ) : (
                        <span className="text-zinc-500">{t("delegated.readOnlyAction")}</span>
                      )}
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

export function DelegatedMemberManagementPanel({ data }: DelegatedMemberManagementPanelProps) {
  const t = useTranslations("members");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<ManageableMembershipRole>(
    data.access.allowedInviteRoles[0] ?? "reviewer",
  );
  const [inviteRoles, setInviteRoles] = useState<Record<string, ManageableMembershipRole>>(
    Object.fromEntries(data.pendingInvites.map((invite) => [invite.inviteId, invite.role])),
  );
  const [memberRoles, setMemberRoles] = useState<Record<string, ManageableMembershipRole>>(
    Object.fromEntries(data.members.map((member) => [member.userId, member.role as ManageableMembershipRole])),
  );

  async function handleResponse(response: Response, fallback: string) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : undefined;
      const message = payload && typeof payload === "object" && "message" in payload
        ? String(payload.message)
        : fallback;
      throw new Error(mapDelegatedError(error, message, t));
    }

    return payload;
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

        const payload = await handleResponse(response, t("errors.fallback"));
        setInviteEmail("");
        setStatusMessage({
          tone: "success",
          text: payload.outcome === "already_member" ? t("invite.alreadyMember") : t("invite.success"),
        });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("errors.fallback"),
        });
      }
    });
  }

  function resendInvite(invite: OrganizationUserDirectoryPendingInviteRecord) {
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

        await handleResponse(response, t("delegated.resendForbidden"));
        setStatusMessage({ tone: "success", text: t("pendingInvites.resent") });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("errors.fallback"),
        });
      }
    });
  }

  function revokeInvite(invite: OrganizationUserDirectoryPendingInviteRecord) {
    if (!window.confirm(t("pendingInvites.revokeConfirm", { email: invite.email }))) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/invites/${invite.inviteId}/revoke`, {
          method: "POST",
        });

        await handleResponse(response, t("delegated.revokeForbidden"));
        setStatusMessage({ tone: "success", text: t("pendingInvites.revoked") });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("errors.fallback"),
        });
      }
    });
  }

  function updateMemberRole(member: OrganizationUserDirectoryMemberRecord) {
    const role = memberRoles[member.userId] ?? member.role;

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ role }),
        });

        await handleResponse(response, t("delegated.roleChangeFallback"));
        setStatusMessage({ tone: "success", text: t("delegated.roleChanged") });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("errors.fallback"),
        });
      }
    });
  }

  function removeMember(member: OrganizationUserDirectoryMemberRecord) {
    if (!window.confirm(t("membersTable.removeConfirm", { email: member.email }))) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}`, {
          method: "DELETE",
        });

        await handleResponse(response, t("delegated.removeFallback"));
        setStatusMessage({ tone: "success", text: t("delegated.removed") });
        router.refresh();
      } catch (error) {
        setStatusMessage({
          tone: "error",
          text: error instanceof Error ? error.message : t("errors.fallback"),
        });
      }
    });
  }

  return (
    <DelegatedMemberManagementPanelView
      data={data}
      statusMessage={statusMessage}
      isPending={isPending}
      inviteEmail={inviteEmail}
      inviteRole={inviteRole}
      inviteRoles={inviteRoles}
      memberRoles={memberRoles}
      onInviteEmailChange={setInviteEmail}
      onInviteRoleChange={setInviteRole}
      onSubmitInvite={submitInvite}
      onPendingInviteRoleChange={(inviteId, role) =>
        setInviteRoles((current) => ({
          ...current,
          [inviteId]: role,
        }))
      }
      onResendInvite={resendInvite}
      onRevokeInvite={revokeInvite}
      onMemberRoleChange={(userId, role) =>
        setMemberRoles((current) => ({
          ...current,
          [userId]: role,
        }))
      }
      onUpdateMemberRole={updateMemberRole}
      onRemoveMember={removeMember}
    />
  );
}
