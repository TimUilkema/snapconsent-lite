"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { useTranslations } from "next-intl";

import { CustomRoleManagementSection } from "@/components/members/custom-role-management-section";
import type {
  TenantMemberManagementData,
  TenantMemberRecord,
  TenantPendingInviteRecord,
} from "@/lib/tenant/member-management-service";
import type {
  MemberEffectiveAccessSourceSummary,
  MemberEffectiveAccessSummary,
} from "@/lib/tenant/member-effective-access-service";
import {
  getRoleScopeEffect,
  type RoleAssignmentScopeType,
} from "@/lib/tenant/custom-role-scope-effects";
import {
  CAPABILITY_LABEL_KEYS,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";

type StatusMessage =
  | {
      tone: "success" | "error" | "info";
      text: string;
    }
  | null;

type MemberManagementPanelProps = {
  data: TenantMemberManagementData;
};

type CustomRoleSelectionState = {
  roleId: string;
  scopeType: RoleAssignmentScopeType;
  projectId: string;
  workspaceId: string;
};

type MemberCustomRoleAssignment = TenantMemberManagementData["customRoleAssignments"][number]["assignments"][number];

type MemberManagementPanelViewProps = MemberManagementPanelProps & {
  showAdvancedRoleSettings?: boolean;
  statusMessage: StatusMessage;
  isPending: boolean;
  inviteEmail: string;
  inviteRole: "admin" | "reviewer" | "photographer";
  memberRoles: Record<string, string>;
  customRoleSelections: Record<string, CustomRoleSelectionState>;
  inviteRoles: Record<string, string>;
  effectiveAccessSummaries?: Record<string, MemberEffectiveAccessSummary>;
  effectiveAccessLoadingUserId?: string | null;
  effectiveAccessErrors?: Record<string, string>;
  expandedEffectiveAccessUserId?: string | null;
  onInviteEmailChange: (value: string) => void;
  onInviteRoleChange: (value: "admin" | "reviewer" | "photographer") => void;
  onSubmitInvite: () => void;
  onMemberRoleChange: (userId: string, role: string) => void;
  onUpdateMemberRole: (member: TenantMemberRecord) => void;
  onRemoveMember: (member: TenantMemberRecord) => void;
  onGrantTenantWideReviewerAccess: (member: TenantMemberRecord) => void;
  onRevokeTenantWideReviewerAccess: (member: TenantMemberRecord) => void;
  onCustomRoleSelectionChange: (userId: string, patch: Partial<CustomRoleSelectionState>) => void;
  onAssignCustomRole: (member: TenantMemberRecord) => void;
  onRevokeCustomRole: (
    member: TenantMemberRecord,
    assignmentId: string,
    roleName: string,
  ) => void;
  onPendingInviteRoleChange: (inviteId: string, role: string) => void;
  onResendInvite: (invite: TenantPendingInviteRecord) => void;
  onRevokeInvite: (invite: TenantPendingInviteRecord) => void;
  onToggleAdvancedRoleSettings?: () => void;
  onToggleEffectiveAccess?: (member: TenantMemberRecord) => void;
  onRefreshRoles: () => void;
};

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function defaultCustomRoleSelection(): CustomRoleSelectionState {
  return {
    roleId: "",
    scopeType: "tenant",
    projectId: "",
    workspaceId: "",
  };
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
  const [customRoleSelections, setCustomRoleSelections] = useState<Record<string, CustomRoleSelectionState>>({});
  const [inviteRoles, setInviteRoles] = useState<Record<string, string>>(
    Object.fromEntries(data.pendingInvites.map((invite) => [invite.inviteId, invite.role])),
  );
  const [statusMessage, setStatusMessage] = useState<StatusMessage>(null);
  const [effectiveAccessSummaries, setEffectiveAccessSummaries] = useState<
    Record<string, MemberEffectiveAccessSummary>
  >({});
  const [effectiveAccessLoadingUserId, setEffectiveAccessLoadingUserId] = useState<string | null>(null);
  const [effectiveAccessErrors, setEffectiveAccessErrors] = useState<Record<string, string>>({});
  const [expandedEffectiveAccessUserId, setExpandedEffectiveAccessUserId] = useState<string | null>(null);
  const [showAdvancedRoleSettings, setShowAdvancedRoleSettings] = useState(false);

  async function handleResponse(response: Response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(payload?.message ?? t("errors.fallback"));
    }

    return payload;
  }

  async function handleCustomRoleResponse(response: Response) {
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = payload && typeof payload === "object" && "error" in payload
        ? String(payload.error)
        : "";
      if (error === "custom_role_archived") {
        throw new Error(t("customRoleAssignments.errors.roleArchived"));
      }
      if (error === "system_role_assignment_forbidden") {
        throw new Error(t("customRoleAssignments.errors.systemRoleForbidden"));
      }
      if (error === "member_not_found") {
        throw new Error(t("customRoleAssignments.errors.memberNotFound"));
      }
      if (error === "custom_role_not_found") {
        throw new Error(t("customRoleAssignments.errors.roleNotFound"));
      }
      if (error === "invalid_assignment_scope") {
        throw new Error(t("customRoleAssignments.errors.invalidScope"));
      }
      if (error === "assignment_project_not_found") {
        throw new Error(t("customRoleAssignments.errors.projectNotFound"));
      }
      if (error === "assignment_workspace_not_found") {
        throw new Error(t("customRoleAssignments.errors.workspaceNotFound"));
      }
      if (error === "custom_role_assignment_no_effective_capabilities") {
        throw new Error(t("customRoleAssignments.errors.zeroEffectiveCapabilities"));
      }
      if (error === "custom_role_assignment_conflict") {
        throw new Error(t("customRoleAssignments.errors.conflict"));
      }

      throw new Error(t("customRoleAssignments.errors.fallback"));
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

  function grantTenantWideReviewerAccess(member: TenantMemberRecord) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}/reviewer-access/tenant-wide`, {
          method: "POST",
        });

        await handleResponse(response);
        setSuccessMessage(t("reviewerAccess.tenantWideGranted"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  function revokeTenantWideReviewerAccess(member: TenantMemberRecord) {
    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}/reviewer-access/tenant-wide`, {
          method: "DELETE",
        });

        await handleResponse(response);
        setSuccessMessage(t("reviewerAccess.tenantWideRevoked"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("errors.fallback"));
      }
    });
  }

  function assignCustomRole(member: TenantMemberRecord) {
    const selection = customRoleSelections[member.userId] ?? defaultCustomRoleSelection();
    if (!selection.roleId) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/${member.userId}/custom-roles`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            roleId: selection.roleId,
            scopeType: selection.scopeType,
            projectId: selection.scopeType === "tenant" ? null : selection.projectId,
            workspaceId: selection.scopeType === "workspace" ? selection.workspaceId : null,
          }),
        });

        await handleCustomRoleResponse(response);
        setCustomRoleSelections((current) => ({
          ...current,
          [member.userId]: defaultCustomRoleSelection(),
        }));
        setSuccessMessage(t("customRoleAssignments.assigned"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("customRoleAssignments.errors.fallback"));
      }
    });
  }

  function revokeCustomRole(member: TenantMemberRecord, assignmentId: string, roleName: string) {
    if (!window.confirm(t("customRoleAssignments.removeConfirm", { role: roleName, email: member.email }))) {
      return;
    }

    startTransition(async () => {
      try {
        const response = await fetch(`/api/members/custom-role-assignments/${assignmentId}`, {
          method: "DELETE",
        });

        await handleCustomRoleResponse(response);
        setSuccessMessage(t("customRoleAssignments.revoked"));
        router.refresh();
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : t("customRoleAssignments.errors.fallback"));
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

  async function toggleEffectiveAccess(member: TenantMemberRecord) {
    if (expandedEffectiveAccessUserId === member.userId) {
      setExpandedEffectiveAccessUserId(null);
      return;
    }

    setExpandedEffectiveAccessUserId(member.userId);
    if (effectiveAccessSummaries[member.userId]) {
      return;
    }

    setEffectiveAccessLoadingUserId(member.userId);
    setEffectiveAccessErrors((current) => {
      const next = { ...current };
      delete next[member.userId];
      return next;
    });

    try {
      const response = await fetch(`/api/members/${member.userId}/effective-access`);
      const payload = await handleResponse(response);
      setEffectiveAccessSummaries((current) => ({
        ...current,
        [member.userId]: payload.summary as MemberEffectiveAccessSummary,
      }));
    } catch (error) {
      setEffectiveAccessErrors((current) => ({
        ...current,
        [member.userId]: error instanceof Error ? error.message : t("effectiveAccess.errors.fallback"),
      }));
    } finally {
      setEffectiveAccessLoadingUserId((current) => (current === member.userId ? null : current));
    }
  }

  function toggleAdvancedRoleSettings() {
    if (showAdvancedRoleSettings) {
      setExpandedEffectiveAccessUserId(null);
    }
    setShowAdvancedRoleSettings((current) => !current);
  }

  return (
    <MemberManagementPanelView
      data={data}
      showAdvancedRoleSettings={showAdvancedRoleSettings}
      statusMessage={statusMessage}
      isPending={isPending}
      inviteEmail={inviteEmail}
      inviteRole={inviteRole}
      memberRoles={memberRoles}
      customRoleSelections={customRoleSelections}
      inviteRoles={inviteRoles}
      effectiveAccessSummaries={effectiveAccessSummaries}
      effectiveAccessLoadingUserId={effectiveAccessLoadingUserId}
      effectiveAccessErrors={effectiveAccessErrors}
      expandedEffectiveAccessUserId={expandedEffectiveAccessUserId}
      onInviteEmailChange={setInviteEmail}
      onInviteRoleChange={setInviteRole}
      onSubmitInvite={submitInvite}
      onMemberRoleChange={(userId, role) =>
        setMemberRoles((current) => ({
          ...current,
          [userId]: role,
        }))
      }
      onUpdateMemberRole={updateMemberRole}
      onRemoveMember={removeMember}
      onGrantTenantWideReviewerAccess={grantTenantWideReviewerAccess}
      onRevokeTenantWideReviewerAccess={revokeTenantWideReviewerAccess}
      onCustomRoleSelectionChange={(userId, patch) =>
        setCustomRoleSelections((current) => {
          const next = {
            ...(current[userId] ?? defaultCustomRoleSelection()),
            ...patch,
          };
          if (patch.scopeType === "tenant") {
            next.projectId = "";
            next.workspaceId = "";
          } else if (patch.scopeType === "project") {
            next.workspaceId = "";
          } else if (patch.projectId !== undefined) {
            next.workspaceId = "";
          }

          return {
            ...current,
            [userId]: next,
          };
        })
      }
      onAssignCustomRole={assignCustomRole}
      onRevokeCustomRole={revokeCustomRole}
      onPendingInviteRoleChange={(inviteId, role) =>
        setInviteRoles((current) => ({
          ...current,
          [inviteId]: role,
        }))
      }
      onResendInvite={resendInvite}
      onRevokeInvite={revokeInvite}
      onToggleAdvancedRoleSettings={toggleAdvancedRoleSettings}
      onToggleEffectiveAccess={toggleEffectiveAccess}
      onRefreshRoles={() => router.refresh()}
    />
  );
}

export function MemberManagementPanelView({
  data,
  showAdvancedRoleSettings = false,
  statusMessage,
  isPending,
  inviteEmail,
  inviteRole,
  memberRoles,
  customRoleSelections,
  inviteRoles,
  effectiveAccessSummaries = {},
  effectiveAccessLoadingUserId = null,
  effectiveAccessErrors = {},
  expandedEffectiveAccessUserId = null,
  onInviteEmailChange,
  onInviteRoleChange,
  onSubmitInvite,
  onMemberRoleChange,
  onUpdateMemberRole,
  onRemoveMember,
  onGrantTenantWideReviewerAccess,
  onRevokeTenantWideReviewerAccess,
  onCustomRoleSelectionChange,
  onAssignCustomRole,
  onRevokeCustomRole,
  onPendingInviteRoleChange,
  onResendInvite,
  onRevokeInvite,
  onToggleAdvancedRoleSettings = () => undefined,
  onToggleEffectiveAccess = () => undefined,
  onRefreshRoles,
}: MemberManagementPanelViewProps) {
  const t = useTranslations("members");
  const reviewerAccessByUserId = new Map(
    data.reviewerAccess.map((reviewerAccess) => [reviewerAccess.userId, reviewerAccess] as const),
  );
  const customRoleAssignmentsByUserId = new Map(
    data.customRoleAssignments.map((summary) => [summary.userId, summary.assignments] as const),
  );
  const assignmentProjects = data.customRoleAssignmentTargets.projects;

  function capabilityList(capabilityKeys: TenantCapability[]) {
    return capabilityKeys
      .map((capability) => t(`capabilities.${CAPABILITY_LABEL_KEYS[capability]}`))
      .join(", ");
  }

  function assignmentTargetLabel(assignment: {
    scopeType: RoleAssignmentScopeType;
    projectName: string | null;
    workspaceName: string | null;
  }) {
    if (assignment.scopeType === "tenant") {
      return t("customRoleAssignments.allOrganizationTarget");
    }
    if (assignment.scopeType === "project") {
      return assignment.projectName ?? t("customRoleAssignments.unknownTarget");
    }

    const projectName = assignment.projectName ?? t("customRoleAssignments.unknownTarget");
    const workspaceName = assignment.workspaceName ?? t("customRoleAssignments.unknownTarget");
    return `${projectName} / ${workspaceName}`;
  }

  function accessSummaryItems(member: TenantMemberRecord, assignedCustomRoles: MemberCustomRoleAssignment[]) {
    const items: string[] = [];

    if (assignedCustomRoles.length > 0) {
      items.push(t("accessSummary.customRoleCount", { count: assignedCustomRoles.length }));
    }

    if (member.role === "reviewer") {
      const reviewerAccess = reviewerAccessByUserId.get(member.userId);
      const projectCount = reviewerAccess?.projectAssignments.length ?? 0;

      if (reviewerAccess?.tenantWideAccess.active) {
        items.push(t("accessSummary.reviewAllProjects"));
      } else if (projectCount > 0) {
        items.push(t("accessSummary.reviewProjectCount", { count: projectCount }));
      } else {
        items.push(t("accessSummary.reviewNotGranted"));
      }
    }

    return items;
  }

  function renderAccessSummary(member: TenantMemberRecord, assignedCustomRoles: MemberCustomRoleAssignment[]) {
    const items = accessSummaryItems(member, assignedCustomRoles);

    if (items.length === 0) {
      return <span className="text-zinc-500">{t("accessSummary.none")}</span>;
    }

    return (
      <div className="space-y-1 text-zinc-700">
        {items.map((item) => (
          <div key={item}>{item}</div>
        ))}
      </div>
    );
  }

  function effectiveScopeLabel(scope: MemberEffectiveAccessSummary["effectiveScopes"][number]) {
    if (scope.scopeType === "tenant") {
      return t("effectiveAccess.scope.tenant");
    }

    if (scope.scopeType === "project") {
      return t("effectiveAccess.scope.project", {
        project: scope.projectName ?? t("customRoleAssignments.unknownTarget"),
      });
    }

    return t("effectiveAccess.scope.workspace", {
      project: scope.projectName ?? t("customRoleAssignments.unknownTarget"),
      workspace: scope.workspaceName ?? t("customRoleAssignments.unknownTarget"),
    });
  }

  function effectiveSourceLabel(source: MemberEffectiveAccessSourceSummary) {
    switch (source.sourceType) {
      case "fixed_role":
        return t("effectiveAccess.sources.fixedRole", {
          role: source.role ? t(`roles.${source.role}`) : t("customRoleAssignments.unknownTarget"),
        });
      case "system_reviewer_assignment":
        return source.assignmentScopeType === "tenant"
          ? t("effectiveAccess.sources.reviewerTenant")
          : t("effectiveAccess.sources.reviewerProject", {
              project: source.projectName ?? t("customRoleAssignments.unknownTarget"),
            });
      case "photographer_workspace_assignment":
        return t("effectiveAccess.sources.photographerWorkspace", {
          project: source.projectName ?? t("customRoleAssignments.unknownTarget"),
          workspace: source.workspaceName ?? t("customRoleAssignments.unknownTarget"),
        });
      case "custom_role_assignment":
        return t("effectiveAccess.sources.customRole", {
          role: source.roleName ?? t("customRoleAssignments.unknownTarget"),
        });
      default:
        return t("effectiveAccess.sources.unknown");
    }
  }

  function renderEffectiveAccessDetail(member: TenantMemberRecord) {
    const summary = effectiveAccessSummaries[member.userId];
    const isLoading = effectiveAccessLoadingUserId === member.userId;
    const error = effectiveAccessErrors[member.userId] ?? null;

    if (isLoading) {
      return <p className="text-sm text-zinc-600">{t("effectiveAccess.loading")}</p>;
    }

    if (error) {
      return <p className="text-sm text-red-700">{error}</p>;
    }

    if (!summary) {
      return <p className="text-sm text-zinc-600">{t("effectiveAccess.empty")}</p>;
    }

    return (
      <div className="space-y-4 text-sm">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <div className="font-medium text-zinc-900">{t("effectiveAccess.fixedRole")}</div>
            <div className="text-zinc-600">{t(`roles.${summary.fixedRole}`)}</div>
          </div>
          <div>
            <div className="font-medium text-zinc-900">{t("effectiveAccess.customRoles")}</div>
            <div className="text-zinc-600">
              {t("effectiveAccess.count", { count: summary.customRoleAssignments.length })}
            </div>
          </div>
          <div>
            <div className="font-medium text-zinc-900">{t("effectiveAccess.reviewerAccess")}</div>
            <div className="text-zinc-600">
              {summary.reviewerAccess
                ? t("effectiveAccess.reviewerSummary", {
                    projectCount: summary.reviewerAccess.projectAssignments.length,
                    tenantWide: summary.reviewerAccess.tenantWideAccess.active
                      ? t("effectiveAccess.yes")
                      : t("effectiveAccess.no"),
                  })
                : t("effectiveAccess.none")}
            </div>
          </div>
          <div>
            <div className="font-medium text-zinc-900">{t("effectiveAccess.photographerAssignments")}</div>
            <div className="text-zinc-600">
              {t("effectiveAccess.count", { count: summary.photographerWorkspaceAssignments.length })}
            </div>
          </div>
        </div>

        {summary.warnings.length > 0 ? (
          <div className="space-y-1 border-t border-zinc-200 pt-3 text-xs text-amber-700">
            {summary.warnings.map((warning) => (
              <div key={warning}>{t(`effectiveAccess.warnings.${warning}`)}</div>
            ))}
          </div>
        ) : null}

        <div className="space-y-3 border-t border-zinc-200 pt-3">
          <div className="font-medium text-zinc-900">{t("effectiveAccess.effectiveCapabilities")}</div>
          {summary.effectiveScopes.length === 0 ? (
            <p className="text-zinc-600">{t("effectiveAccess.empty")}</p>
          ) : (
            <div className="space-y-3">
              {summary.effectiveScopes.map((scope) => (
                <div
                  key={`${scope.scopeType}:${scope.projectId ?? ""}:${scope.workspaceId ?? ""}`}
                  className="space-y-2 rounded-md border border-zinc-200 bg-white px-3 py-2"
                >
                  <div className="font-medium text-zinc-900">{effectiveScopeLabel(scope)}</div>
                  {scope.capabilityGroups.length === 0 ? (
                    <div className="text-zinc-600">{t("effectiveAccess.noCapabilities")}</div>
                  ) : (
                    scope.capabilityGroups.map((group) => (
                      <div key={group.groupKey} className="space-y-1">
                        <div className="text-zinc-700">
                          {t(`capabilityGroups.${group.groupKey}`)}
                        </div>
                        <div className="text-zinc-600">
                          {capabilityList(group.capabilityKeys)}
                        </div>
                        <div className="text-xs text-zinc-500">
                          {t("effectiveAccess.sourcesLabel", {
                            sources: group.sources.map(effectiveSourceLabel).join(", "),
                          })}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {summary.ignoredCapabilities.length > 0 ? (
          <div className="space-y-2 border-t border-zinc-200 pt-3">
            <div className="font-medium text-zinc-900">{t("effectiveAccess.ignoredCapabilities")}</div>
            <div className="space-y-1 text-xs text-zinc-600">
              {summary.ignoredCapabilities.map((ignored) => (
                <div key={`${ignored.assignmentId}:${ignored.capabilityKey}:${ignored.reason}`}>
                  {t("effectiveAccess.ignoredCapability", {
                    role: ignored.roleName,
                    capability: t(`capabilities.${CAPABILITY_LABEL_KEYS[ignored.capabilityKey]}`),
                    reason: t(`effectiveAccess.ignoredReasons.${ignored.reason}`),
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
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
              onChange={(event) => onInviteEmailChange(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
              placeholder={t("invite.emailPlaceholder")}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-zinc-800">{t("invite.roleLabel")}</span>
            <select
              value={inviteRole}
              onChange={(event) => onInviteRoleChange(event.target.value as typeof inviteRole)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
            >
              <option value="admin">{t("roles.admin")}</option>
              <option value="reviewer">{t("roles.reviewer")}</option>
              <option value="photographer">{t("roles.photographer")}</option>
            </select>
            <span className="mt-1 block text-xs leading-5 text-zinc-600">
              {t("invite.selectedRoleHelp", {
                role: t(`roles.${inviteRole}`),
                description: t(`roleDescriptions.${inviteRole}`),
              })}
            </span>
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

      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-zinc-900">{t("advancedRoleSettings.title")}</h2>
            <p className="text-sm text-zinc-600">{t("advancedRoleSettings.description")}</p>
          </div>
          <button
            type="button"
            onClick={onToggleAdvancedRoleSettings}
            aria-expanded={showAdvancedRoleSettings}
            aria-controls="members-advanced-role-settings"
            className="self-start rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
          >
            {showAdvancedRoleSettings ? t("advancedRoleSettings.hide") : t("advancedRoleSettings.show")}
          </button>
        </div>
      </section>

      {showAdvancedRoleSettings ? (
        <div id="members-advanced-role-settings" className="space-y-4">
          <CustomRoleManagementSection data={data.roleEditor} onRefresh={onRefreshRoles} />
        </div>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white px-4 py-4">
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-zinc-900">{t("membersTable.title")}</h2>
          <p className="text-sm text-zinc-600">{t("membersTable.subtitle")}</p>
          <p className="text-sm text-zinc-600">{t("membersTable.removalExplanation")}</p>
          {showAdvancedRoleSettings ? (
            <p className="text-sm text-zinc-600">{t("customRoleAssignments.note")}</p>
          ) : null}
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left text-zinc-600">
                <th className="py-2 pr-4 font-medium">{t("membersTable.columns.email")}</th>
                <th className="py-2 pr-4 font-medium">{t("membersTable.columns.role")}</th>
                {showAdvancedRoleSettings ? (
                  <>
                    <th className="py-2 pr-4 font-medium">{t("membersTable.columns.reviewerAccess")}</th>
                    <th className="py-2 pr-4 font-medium">{t("customRoleAssignments.column")}</th>
                  </>
                ) : (
                  <th className="py-2 pr-4 font-medium">{t("accessSummary.column")}</th>
                )}
                <th className="py-2 pr-4 font-medium">{t("membersTable.columns.joined")}</th>
                <th className="py-2 font-medium">{t("membersTable.columns.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data.members.map((member) => {
                const assignedCustomRoles = customRoleAssignmentsByUserId.get(member.userId) ?? [];
                const selection = customRoleSelections[member.userId] ?? defaultCustomRoleSelection();
                const selectedRole = data.assignableCustomRoles.find(
                  (role) => role.roleId === selection.roleId,
                ) ?? null;
                const selectedProject = assignmentProjects.find(
                  (project) => project.projectId === selection.projectId,
                ) ?? null;
                const scopeEffect = selectedRole
                  ? getRoleScopeEffect(selectedRole.capabilityKeys, selection.scopeType)
                  : null;
                const requiresProject = selection.scopeType === "project" || selection.scopeType === "workspace";
                const requiresWorkspace = selection.scopeType === "workspace";
                const isAssignmentBlocked = Boolean(
                  isPending
                  || !selection.roleId
                  || (requiresProject && !selection.projectId)
                  || (requiresWorkspace && !selection.workspaceId)
                  || scopeEffect?.hasZeroEffectiveCapabilities,
                );

                return (
                <Fragment key={member.userId}>
                <tr className="border-b border-zinc-100 align-top last:border-b-0">
                  <td className="py-3 pr-4 text-zinc-900">{member.email}</td>
                  <td className="py-3 pr-4">
                    {member.canEdit ? (
                      <select
                        value={memberRoles[member.userId] ?? member.role}
                        onChange={(event) =>
                          onMemberRoleChange(member.userId, event.target.value)
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
                  {showAdvancedRoleSettings ? (
                    <>
                      <td className="py-3 pr-4">
                        {member.role === "reviewer" ? (
                          <div className="space-y-2">
                            <div className="text-zinc-700">
                              {reviewerAccessByUserId.get(member.userId)?.tenantWideAccess.active
                                ? t("reviewerAccess.tenantWideActive")
                                : t("reviewerAccess.noTenantWide")}
                            </div>
                            <div className="text-zinc-600">
                              {t("reviewerAccess.projectCount", {
                                count:
                                  reviewerAccessByUserId.get(member.userId)?.projectAssignments.length ?? 0,
                              })}
                            </div>
                            {reviewerAccessByUserId.get(member.userId)?.tenantWideAccess.active ? (
                              <button
                                type="button"
                                onClick={() => onRevokeTenantWideReviewerAccess(member)}
                                disabled={isPending}
                                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {t("reviewerAccess.revokeTenantWide")}
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => onGrantTenantWideReviewerAccess(member)}
                                disabled={isPending}
                                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                {t("reviewerAccess.grantTenantWide")}
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-zinc-500">{t("reviewerAccess.notReviewer")}</span>
                        )}
                      </td>
                      <td className="min-w-72 py-3 pr-4">
                        <div className="space-y-3">
                          {assignedCustomRoles.length === 0 ? (
                            <div className="text-zinc-500">
                              {t("customRoleAssignments.noAssignedRoles")}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              {assignedCustomRoles.map((assignment) => (
                                <div
                                  key={assignment.assignmentId}
                                  className="flex items-center justify-between gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1.5"
                                >
                                  <div className="min-w-0">
                                    <div className="truncate font-medium text-zinc-900">
                                      {assignment.role.name}
                                    </div>
                                    <div className="text-xs text-zinc-600">
                                      {t(`customRoleAssignments.scope.${assignment.scopeType}`)}
                                      {" - "}
                                      {assignmentTargetLabel(assignment)}
                                    </div>
                                    {assignment.hasScopeWarnings ? (
                                      <div className="text-xs text-amber-700">
                                        {t("customRoleAssignments.scopeWarning")}
                                      </div>
                                    ) : null}
                                    {assignment.role.archivedAt ? (
                                      <div className="text-xs text-zinc-600">
                                        {t("customRoleAssignments.archivedAssignedRole", {
                                          role: assignment.role.name,
                                        })}
                                      </div>
                                    ) : null}
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      onRevokeCustomRole(
                                        member,
                                        assignment.assignmentId,
                                        assignment.role.name,
                                      )
                                    }
                                    disabled={isPending}
                                    className="shrink-0 rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    {t("customRoleAssignments.remove")}
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                          {data.assignableCustomRoles.length === 0 ? (
                            <div className="text-xs leading-5 text-zinc-600">
                              {t("customRoleAssignments.createRoleFirst")}
                            </div>
                          ) : (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <select
                                  value={selection.roleId}
                                  onChange={(event) =>
                                    onCustomRoleSelectionChange(member.userId, { roleId: event.target.value })
                                  }
                                  disabled={isPending}
                                  className="min-w-44 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  <option value="">{t("customRoleAssignments.selectPlaceholder")}</option>
                                  {data.assignableCustomRoles.map((role) => (
                                    <option key={role.roleId} value={role.roleId}>
                                      {role.name}
                                    </option>
                                  ))}
                                </select>
                                <select
                                  value={selection.scopeType}
                                  onChange={(event) =>
                                    onCustomRoleSelectionChange(member.userId, {
                                      scopeType: event.target.value as RoleAssignmentScopeType,
                                    })
                                  }
                                  disabled={isPending}
                                  className="min-w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
                                  aria-label={t("customRoleAssignments.scopeLabel")}
                                >
                                  <option value="tenant">{t("customRoleAssignments.scope.tenant")}</option>
                                  <option value="project">{t("customRoleAssignments.scope.project")}</option>
                                  <option value="workspace">{t("customRoleAssignments.scope.workspace")}</option>
                                </select>
                                {requiresProject ? (
                                  <select
                                    value={selection.projectId}
                                    onChange={(event) =>
                                      onCustomRoleSelectionChange(member.userId, { projectId: event.target.value })
                                    }
                                    disabled={isPending}
                                    className="min-w-44 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
                                    aria-label={t("customRoleAssignments.projectLabel")}
                                  >
                                    <option value="">{t("customRoleAssignments.projectPlaceholder")}</option>
                                    {assignmentProjects.map((project) => (
                                      <option key={project.projectId} value={project.projectId}>
                                        {project.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                                {requiresWorkspace ? (
                                  <select
                                    value={selection.workspaceId}
                                    onChange={(event) =>
                                      onCustomRoleSelectionChange(member.userId, { workspaceId: event.target.value })
                                    }
                                    disabled={isPending || !selectedProject}
                                    className="min-w-44 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 disabled:cursor-not-allowed disabled:opacity-60"
                                    aria-label={t("customRoleAssignments.workspaceLabel")}
                                  >
                                    <option value="">{t("customRoleAssignments.workspacePlaceholder")}</option>
                                    {(selectedProject?.workspaces ?? []).map((workspace) => (
                                      <option key={workspace.workspaceId} value={workspace.workspaceId}>
                                        {workspace.name}
                                      </option>
                                    ))}
                                  </select>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => onAssignCustomRole(member)}
                                  disabled={isAssignmentBlocked}
                                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {t("customRoleAssignments.assignRole")}
                                </button>
                              </div>
                              {scopeEffect?.hasZeroEffectiveCapabilities ? (
                                <div className="text-xs leading-5 text-red-700">
                                  {t("customRoleAssignments.zeroEffectiveCapabilities")}
                                </div>
                              ) : scopeEffect?.hasScopeWarnings ? (
                                <div className="text-xs leading-5 text-amber-700">
                                  <div>{t("customRoleAssignments.scopeWarning")}</div>
                                  <div>
                                    {t("customRoleAssignments.effectiveCapabilities", {
                                      capabilities: capabilityList(scopeEffect.effectiveCapabilityKeys),
                                    })}
                                  </div>
                                  <div>
                                    {t("customRoleAssignments.ignoredCapabilities", {
                                      capabilities: capabilityList(scopeEffect.ignoredCapabilityKeys),
                                    })}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </td>
                    </>
                  ) : (
                    <td className="py-3 pr-4">{renderAccessSummary(member, assignedCustomRoles)}</td>
                  )}
                  <td className="py-3 pr-4 text-zinc-600">{formatDateTime(member.createdAt)}</td>
                  <td className="py-3">
                    <div className="flex flex-wrap gap-2">
                      {showAdvancedRoleSettings ? (
                        <button
                          type="button"
                          onClick={() => onToggleEffectiveAccess(member)}
                          disabled={effectiveAccessLoadingUserId === member.userId}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {expandedEffectiveAccessUserId === member.userId
                            ? t("effectiveAccess.hide")
                            : t("effectiveAccess.show")}
                        </button>
                      ) : null}
                      {member.canEdit ? (
                        <>
                        <button
                          type="button"
                          onClick={() => onUpdateMemberRole(member)}
                          disabled={isPending}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("membersTable.saveRole")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveMember(member)}
                          disabled={isPending}
                          className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("membersTable.remove")}
                        </button>
                        </>
                      ) : (
                        <span className="text-zinc-500">{t("membersTable.ownerProtectedExplanation")}</span>
                      )}
                    </div>
                  </td>
                </tr>
                {showAdvancedRoleSettings && expandedEffectiveAccessUserId === member.userId ? (
                  <tr className="border-b border-zinc-100">
                    <td colSpan={6} className="bg-zinc-50 px-4 py-4">
                      {renderEffectiveAccessDetail(member)}
                    </td>
                  </tr>
                ) : null}
                </Fragment>
                );
              })}
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
                          onPendingInviteRoleChange(invite.inviteId, event.target.value)
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
                          onClick={() => onResendInvite(invite)}
                          disabled={isPending}
                          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {t("pendingInvites.resend")}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRevokeInvite(invite)}
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
