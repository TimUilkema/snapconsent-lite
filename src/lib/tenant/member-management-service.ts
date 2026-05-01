import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { deliverTenantMembershipInviteEmail } from "@/lib/email/outbound/tenant-membership-invite-delivery";
import { HttpError } from "@/lib/http/errors";
import {
  createOrRefreshTenantMembershipInvite,
  deriveInviterDisplayName,
  refreshTenantMembershipInvite,
  revokeTenantMembershipInvite,
  type TenantMembershipInviteMutationResult,
  type TenantMembershipInviteRevokeResult,
} from "@/lib/tenant/membership-invites";
import {
  MANAGEABLE_MEMBERSHIP_ROLES,
  type ManageableMembershipRole,
  resolveTenantPermissions,
} from "@/lib/tenant/permissions";
import {
  assertCanChangeOrganizationUserRole,
  assertCanChangeOrganizationUserRoles,
  assertCanInviteOrganizationUsers,
  assertCanRemoveOrganizationUser,
  assertCanRemoveOrganizationUsers,
  canChangeOrganizationUserRoleTarget,
  canRemoveOrganizationUserTarget,
  resolveOrganizationUserAccess,
  type OrganizationUserAccess,
} from "@/lib/tenant/organization-user-access";
import {
  listReviewerAccessSummary,
  revokeActiveReviewerAssignmentsForMember,
  type ReviewerAccessSummary,
} from "@/lib/tenant/reviewer-access-service";
import {
  listRoleEditorData,
  type RoleEditorData,
} from "@/lib/tenant/custom-role-service";
import {
  resolveCustomRoleAssignmentSummary,
  type AssignableCustomRole,
  type CustomRoleAssignmentTargetData,
  type MemberCustomRoleAssignmentSummary,
} from "@/lib/tenant/custom-role-assignment-service";

type MembershipRow = {
  tenant_id: string;
  user_id: string;
  role: "owner" | "admin" | "reviewer" | "photographer";
  created_at: string;
};

type PendingInviteRow = {
  id: string;
  email: string;
  normalized_email: string;
  role: ManageableMembershipRole;
  status: "pending";
  expires_at: string;
  last_sent_at: string;
  created_at: string;
  invited_by_user_id: string;
};

export type TenantMemberRecord = {
  userId: string;
  email: string;
  role: "owner" | "admin" | "reviewer" | "photographer";
  createdAt: string;
  canEdit: boolean;
};

export type TenantPendingInviteRecord = {
  inviteId: string;
  email: string;
  normalizedEmail: string;
  role: ManageableMembershipRole;
  expiresAt: string;
  lastSentAt: string;
  createdAt: string;
};

export type OrganizationUserDirectoryMemberRecord = {
  userId: string;
  email: string;
  role: "owner" | "admin" | "reviewer" | "photographer";
  createdAt: string;
  canChangeRole: boolean;
  allowedRoleOptions: ManageableMembershipRole[];
  canRemove: boolean;
};

export type OrganizationUserDirectoryPendingInviteRecord = TenantPendingInviteRecord & {
  canResend: boolean;
  canRevoke: boolean;
  allowedRoleOptions: ManageableMembershipRole[];
};

export type OrganizationUserDirectoryData = {
  access: Pick<
    OrganizationUserAccess,
    | "isFixedOwnerAdmin"
    | "canViewOrganizationUsers"
    | "canInviteOrganizationUsers"
    | "canChangeOrganizationUserRoles"
    | "canRemoveOrganizationUsers"
    | "canManageAllPendingInvites"
    | "allowedInviteRoles"
  >;
  members: OrganizationUserDirectoryMemberRecord[];
  pendingInvites: OrganizationUserDirectoryPendingInviteRecord[];
};

export type TenantMemberManagementData = {
  members: TenantMemberRecord[];
  pendingInvites: TenantPendingInviteRecord[];
  reviewerAccess: ReviewerAccessSummary[];
  roleEditor: RoleEditorData;
  assignableCustomRoles: AssignableCustomRole[];
  customRoleAssignments: MemberCustomRoleAssignmentSummary[];
  customRoleAssignmentTargets: CustomRoleAssignmentTargetData;
};

export type TenantMemberInviteMutationResponse = TenantMembershipInviteMutationResult & {
  deliveryStatus: "not_sent" | "sent" | "queued";
  deliveryJobId: string | null;
};

function roleSortOrder(role: TenantMemberRecord["role"]) {
  switch (role) {
    case "owner":
      return 0;
    case "admin":
      return 1;
    case "reviewer":
      return 2;
    case "photographer":
      return 3;
    default:
      return 9;
  }
}

function assertManageableRole(role: string): asserts role is ManageableMembershipRole {
  if (MANAGEABLE_MEMBERSHIP_ROLES.includes(role as ManageableMembershipRole)) {
    return;
  }

  throw new HttpError(400, "invalid_membership_role", "The selected membership role is invalid.");
}

async function assertTenantMemberManager(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const permissions = await resolveTenantPermissions(supabase, tenantId, userId);
  if (!permissions.canManageMembers) {
    throw new HttpError(403, "tenant_member_management_forbidden", "Only workspace owners and admins can manage members.");
  }

  return permissions;
}

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loadUserEmailMap(userIds: string[]) {
  if (userIds.length === 0) {
    return new Map<string, string>();
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace members.");
  }

  const wantedUserIds = new Set(userIds);
  const result = new Map<string, string>();

  data.users.forEach((user) => {
    if (wantedUserIds.has(user.id)) {
      result.set(user.id, user.email?.trim().toLowerCase() ?? "unknown@email");
    }
  });

  return result;
}

function mapPendingInvite(row: PendingInviteRow): TenantPendingInviteRecord {
  return {
    inviteId: row.id,
    email: row.email,
    normalizedEmail: row.normalized_email,
    role: row.role,
    expiresAt: row.expires_at,
    lastSentAt: row.last_sent_at,
    createdAt: row.created_at,
  };
}

function canMutatePendingInvite(input: {
  access: OrganizationUserAccess;
  invite: PendingInviteRow;
  userId: string;
}) {
  if (input.access.canManageAllPendingInvites) {
    return true;
  }

  return (
    input.access.canInviteOrganizationUsers
    && input.invite.invited_by_user_id === input.userId
    && input.invite.role !== "admin"
  );
}

function mapOrganizationUserPendingInvite(input: {
  access: OrganizationUserAccess;
  row: PendingInviteRow;
  userId: string;
}): OrganizationUserDirectoryPendingInviteRecord {
  const canMutate = canMutatePendingInvite({
    access: input.access,
    invite: input.row,
    userId: input.userId,
  });

  return {
    ...mapPendingInvite(input.row),
    canResend: canMutate,
    canRevoke: canMutate,
    allowedRoleOptions: canMutate ? [...input.access.allowedInviteRoles] : [],
  };
}

function mapOrganizationUserDirectoryMember(input: {
  access: OrganizationUserAccess;
  row: MembershipRow;
  actorUserId: string;
  email: string;
}): OrganizationUserDirectoryMemberRecord {
  const roleChangeDecision = canChangeOrganizationUserRoleTarget({
    access: input.access,
    actorUserId: input.actorUserId,
    targetMembership: input.row,
    nextRole: input.row.role === "reviewer" ? "photographer" : "reviewer",
  });
  const removeDecision = canRemoveOrganizationUserTarget({
    access: input.access,
    actorUserId: input.actorUserId,
    targetMembership: input.row,
  });

  return {
    userId: input.row.user_id,
    email: input.email,
    role: input.row.role,
    createdAt: input.row.created_at,
    canChangeRole: roleChangeDecision.allowed,
    allowedRoleOptions: roleChangeDecision.allowedRoleOptions,
    canRemove: removeDecision.allowed,
  };
}

async function deliverInviteEmail(
  result: TenantMembershipInviteMutationResult,
  inviterEmail: string,
) {
  if (result.outcome === "already_member" || !result.inviteId || !result.inviteToken || !result.expiresAt || !result.lastSentAt) {
    return {
      deliveryStatus: "not_sent" as const,
      deliveryJobId: null,
    };
  }

  const delivery = await deliverTenantMembershipInviteEmail({
    tenantId: result.tenantId,
    payload: {
      inviteId: result.inviteId,
      tenantId: result.tenantId,
      tenantName: result.tenantName,
      invitedEmail: result.email,
      role: result.role,
      inviteToken: result.inviteToken,
      expiresAtIso: result.expiresAt,
      lastSentAtIso: result.lastSentAt,
      inviterDisplayName: deriveInviterDisplayName(inviterEmail),
    },
  });

  return {
    deliveryStatus: delivery.deliveryStatus,
    deliveryJobId: delivery.jobId,
  };
}

export async function getTenantMemberManagementData(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}): Promise<TenantMemberManagementData> {
  await assertTenantMemberManager(input.supabase, input.tenantId, input.userId);

  const { data: membershipRows, error: membershipError } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace members.");
  }

  const { data: inviteRows, error: inviteError } = await input.supabase
    .from("tenant_membership_invites")
    .select("id, email, normalized_email, role, status, expires_at, last_sent_at, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (inviteError) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace invites.");
  }

  const rows = ((membershipRows ?? []) as MembershipRow[]).filter((row) => row.tenant_id === input.tenantId);
  const emailMap = await loadUserEmailMap(rows.map((row) => row.user_id));

  const members = rows
    .map((row) => ({
      userId: row.user_id,
      email: emailMap.get(row.user_id) ?? "unknown@email",
      role: row.role,
      createdAt: row.created_at,
      canEdit: row.role !== "owner",
    }))
    .sort((left, right) => {
      const roleDiff = roleSortOrder(left.role) - roleSortOrder(right.role);
      if (roleDiff !== 0) {
        return roleDiff;
      }

      return left.email.localeCompare(right.email);
    });

  const reviewerAccess = await listReviewerAccessSummary({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });
  const roleEditor = await listRoleEditorData({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });
  const customRoleAssignmentSummary = await resolveCustomRoleAssignmentSummary({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  return {
    members,
    pendingInvites: ((inviteRows ?? []) as PendingInviteRow[]).map(mapPendingInvite),
    reviewerAccess: reviewerAccess.reviewers,
    roleEditor,
    assignableCustomRoles: customRoleAssignmentSummary.assignableRoles,
    customRoleAssignments: customRoleAssignmentSummary.members,
    customRoleAssignmentTargets: customRoleAssignmentSummary.targets,
  };
}

export async function getOrganizationUserDirectoryData(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}): Promise<OrganizationUserDirectoryData> {
  // Delegated organization-user data intentionally omits role editor, custom-role assignment, and reviewer access administration state.
  const access = await resolveOrganizationUserAccess({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  if (
    !access.canViewOrganizationUsers
    && !access.canInviteOrganizationUsers
    && !access.canChangeOrganizationUserRoles
    && !access.canRemoveOrganizationUsers
  ) {
    throw new HttpError(
      403,
      "organization_user_access_forbidden",
      "You do not have access to organization users.",
    );
  }

  let members: OrganizationUserDirectoryMemberRecord[] = [];
  if (access.canViewOrganizationUsers) {
    const { data: membershipRows, error: membershipError } = await input.supabase
      .from("memberships")
      .select("tenant_id, user_id, role, created_at")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: true });

    if (membershipError) {
      throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace members.");
    }

    const rows = ((membershipRows ?? []) as MembershipRow[]).filter((row) => row.tenant_id === input.tenantId);
    const emailMap = await loadUserEmailMap(rows.map((row) => row.user_id));
    members = rows
      .map((row) => mapOrganizationUserDirectoryMember({
        access,
        row,
        actorUserId: input.userId,
        email: emailMap.get(row.user_id) ?? "unknown@email",
      }))
      .sort((left, right) => {
        const roleDiff = roleSortOrder(left.role) - roleSortOrder(right.role);
        if (roleDiff !== 0) {
          return roleDiff;
        }

        return left.email.localeCompare(right.email);
      });
  }

  let inviteQuery = input.supabase
    .from("tenant_membership_invites")
    .select("id, email, normalized_email, role, status, expires_at, last_sent_at, created_at, invited_by_user_id")
    .eq("tenant_id", input.tenantId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (!access.canViewOrganizationUsers) {
    inviteQuery = inviteQuery
      .eq("invited_by_user_id", input.userId)
      .in("role", ["reviewer", "photographer"]);
  }

  const { data: inviteRows, error: inviteError } = await inviteQuery;

  if (inviteError) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace invites.");
  }

  return {
    access: {
      isFixedOwnerAdmin: access.isFixedOwnerAdmin,
      canViewOrganizationUsers: access.canViewOrganizationUsers,
      canInviteOrganizationUsers: access.canInviteOrganizationUsers,
      canChangeOrganizationUserRoles: access.canChangeOrganizationUserRoles,
      canRemoveOrganizationUsers: access.canRemoveOrganizationUsers,
      canManageAllPendingInvites: access.canManageAllPendingInvites,
      allowedInviteRoles: access.allowedInviteRoles,
    },
    members,
    pendingInvites: ((inviteRows ?? []) as PendingInviteRow[]).map((row) =>
      mapOrganizationUserPendingInvite({
        access,
        row,
        userId: input.userId,
      }),
    ),
  };
}

export async function createTenantMemberInvite(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  inviterEmail: string;
  email: string;
  role: ManageableMembershipRole;
}): Promise<TenantMemberInviteMutationResponse> {
  await assertCanInviteOrganizationUsers({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    targetRole: input.role,
  });

  const result = await createOrRefreshTenantMembershipInvite(input.supabase, {
    tenantId: input.tenantId,
    email: input.email,
    role: input.role,
  });

  const delivery = await deliverInviteEmail(result, input.inviterEmail);

  return {
    ...result,
    deliveryStatus: delivery.deliveryStatus,
    deliveryJobId: delivery.deliveryJobId,
  };
}

export async function resendTenantMemberInvite(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  inviterEmail: string;
  inviteId: string;
  role?: ManageableMembershipRole | null;
}): Promise<TenantMemberInviteMutationResponse> {
  await assertCanInviteOrganizationUsers({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    targetRole: input.role ?? null,
  });

  const result = await refreshTenantMembershipInvite(input.supabase, {
    inviteId: input.inviteId,
    role: input.role ?? null,
  });

  const delivery = await deliverInviteEmail(result, input.inviterEmail);

  return {
    ...result,
    deliveryStatus: delivery.deliveryStatus,
    deliveryJobId: delivery.deliveryJobId,
  };
}

export async function revokeTenantMemberInvite(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  inviteId: string;
}): Promise<TenantMembershipInviteRevokeResult> {
  await assertCanInviteOrganizationUsers({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });
  return revokeTenantMembershipInvite(input.supabase, input.inviteId);
}

export async function updateTenantMemberRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  targetUserId: string;
  role: ManageableMembershipRole;
}): Promise<TenantMemberRecord> {
  assertManageableRole(input.role);
  await assertCanChangeOrganizationUserRoles({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const { data: existingRow, error: existingError } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, "tenant_member_update_failed", "Unable to update workspace membership.");
  }

  const targetMembership = (existingRow as MembershipRow | null) ?? null;
  if (!targetMembership) {
    throw new HttpError(404, "tenant_member_not_found", "Workspace member not found.");
  }

  await assertCanChangeOrganizationUserRole({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    targetMembership,
    nextRole: input.role,
  });

  const { data: updatedRow, error: updateError } = await input.supabase
    .from("memberships")
    .update({
      role: input.role,
    })
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId)
    .select("tenant_id, user_id, role, created_at")
    .single();

  if (updateError || !updatedRow) {
    throw new HttpError(500, "tenant_member_update_failed", "Unable to update workspace membership.");
  }

  if (targetMembership.role === "reviewer" && updatedRow.role !== "reviewer") {
    await revokeActiveReviewerAssignmentsForMember({
      tenantId: input.tenantId,
      actorUserId: input.userId,
      targetUserId: input.targetUserId,
    });
  }

  const emailMap = await loadUserEmailMap([updatedRow.user_id]);
  return {
    userId: updatedRow.user_id,
    email: emailMap.get(updatedRow.user_id) ?? "unknown@email",
    role: updatedRow.role,
    createdAt: updatedRow.created_at,
    canEdit: updatedRow.role !== "owner",
  };
}

export async function removeTenantMember(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  targetUserId: string;
}) {
  await assertCanRemoveOrganizationUsers({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const { data: existingRow, error: existingError } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, "tenant_member_remove_failed", "Unable to remove workspace membership.");
  }

  const targetMembership = (existingRow as MembershipRow | null) ?? null;
  if (!targetMembership) {
    throw new HttpError(404, "tenant_member_not_found", "Workspace member not found.");
  }

  await assertCanRemoveOrganizationUser({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    targetMembership,
  });

  const { error: deleteError } = await input.supabase
    .from("memberships")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId);

  if (deleteError) {
    throw new HttpError(500, "tenant_member_remove_failed", "Unable to remove workspace membership.");
  }
}
