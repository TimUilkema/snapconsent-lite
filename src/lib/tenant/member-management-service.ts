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

export type TenantMemberManagementData = {
  members: TenantMemberRecord[];
  pendingInvites: TenantPendingInviteRecord[];
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

  return {
    members,
    pendingInvites: ((inviteRows ?? []) as PendingInviteRow[]).map(mapPendingInvite),
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
  await assertTenantMemberManager(input.supabase, input.tenantId, input.userId);

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
  await assertTenantMemberManager(input.supabase, input.tenantId, input.userId);

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
  await assertTenantMemberManager(input.supabase, input.tenantId, input.userId);
  return revokeTenantMembershipInvite(input.supabase, input.inviteId);
}

export async function updateTenantMemberRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  targetUserId: string;
  role: ManageableMembershipRole;
}): Promise<TenantMemberRecord> {
  await assertTenantMemberManager(input.supabase, input.tenantId, input.userId);
  assertManageableRole(input.role);

  const { data: existingRow, error: existingError } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, "tenant_member_update_failed", "Unable to update workspace membership.");
  }

  if (!existingRow) {
    throw new HttpError(404, "tenant_member_not_found", "Workspace member not found.");
  }

  if (existingRow.role === "owner") {
    throw new HttpError(403, "owner_membership_immutable", "Owner memberships cannot be changed.");
  }

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
  await assertTenantMemberManager(input.supabase, input.tenantId, input.userId);

  const { data: existingRow, error: existingError } = await input.supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId)
    .maybeSingle();

  if (existingError) {
    throw new HttpError(500, "tenant_member_remove_failed", "Unable to remove workspace membership.");
  }

  if (!existingRow) {
    throw new HttpError(404, "tenant_member_not_found", "Workspace member not found.");
  }

  if (existingRow.role === "owner") {
    throw new HttpError(403, "owner_membership_immutable", "Owner memberships cannot be removed.");
  }

  const { error: deleteError } = await input.supabase
    .from("memberships")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId);

  if (deleteError) {
    throw new HttpError(500, "tenant_member_remove_failed", "Unable to remove workspace membership.");
  }
}
