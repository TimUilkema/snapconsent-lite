import type { SupabaseClient } from "@supabase/supabase-js";

import type { ManageableMembershipRole } from "@/lib/tenant/permissions";
import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";

type PublicTenantMembershipInviteRow = {
  invite_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role: ManageableMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  can_accept: boolean;
};

type TenantMembershipInviteMutationRow = {
  outcome: "invited" | "resent" | "already_member";
  invite_id: string | null;
  tenant_id: string;
  tenant_name: string;
  email: string;
  normalized_email: string;
  role: ManageableMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired" | null;
  expires_at: string | null;
  last_sent_at: string | null;
  invite_token: string | null;
};

type TenantMembershipInviteRevokeRow = {
  outcome: "revoked" | "accepted" | "expired";
  invite_id: string;
  tenant_id: string;
  email: string;
  role: ManageableMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  revoked_at: string | null;
};

type TenantMembershipInviteAcceptRow = {
  outcome: "accepted" | "already_member";
  invite_id: string;
  tenant_id: string;
  tenant_name: string;
  email: string;
  role: ManageableMembershipRole;
  accepted_at: string | null;
};

export type PublicTenantMembershipInvite = {
  inviteId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  role: ManageableMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  canAccept: boolean;
};

export type TenantMembershipInviteMutationResult = {
  outcome: "invited" | "resent" | "already_member";
  inviteId: string | null;
  tenantId: string;
  tenantName: string;
  email: string;
  normalizedEmail: string;
  role: ManageableMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired" | null;
  expiresAt: string | null;
  lastSentAt: string | null;
  inviteToken: string | null;
};

export type TenantMembershipInviteRevokeResult = {
  outcome: "revoked" | "accepted" | "expired";
  inviteId: string;
  tenantId: string;
  email: string;
  role: ManageableMembershipRole;
  status: "pending" | "accepted" | "revoked" | "expired";
  revokedAt: string | null;
};

export type TenantMembershipInviteAcceptResult = {
  outcome: "accepted" | "already_member";
  inviteId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  role: ManageableMembershipRole;
  acceptedAt: string | null;
};

function mapMutationRow(row: TenantMembershipInviteMutationRow): TenantMembershipInviteMutationResult {
  return {
    outcome: row.outcome,
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    email: row.email,
    normalizedEmail: row.normalized_email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    lastSentAt: row.last_sent_at,
    inviteToken: row.invite_token,
  };
}

function mapMutationError(error: unknown, fallbackCode: string) {
  const normalized = normalizePostgrestError(error, fallbackCode);

  switch (normalized.message) {
    case "unauthenticated":
      return new HttpError(401, "unauthenticated", "Authentication required.");
    case "tenant_member_management_forbidden":
      return new HttpError(403, "tenant_member_management_forbidden", "Only workspace owners and admins can manage members.");
    case "organization_user_invite_forbidden":
    case "tenant_membership_invite_forbidden":
      return new HttpError(403, normalized.message, "You do not have access to manage this organization invite.");
    case "invalid_invite_email":
      return new HttpError(400, "invalid_invite_email", "Enter a valid email address.");
    case "invalid_membership_role":
      return new HttpError(400, "invalid_membership_role", "The selected membership role is invalid.");
    case "invalid_invite_expiry":
      return new HttpError(400, "invalid_invite_expiry", "The invite expiry is invalid.");
    case "tenant_not_found":
    case "tenant_membership_invite_not_found":
      return new HttpError(404, normalized.message, "Membership invite not found.");
    case "tenant_membership_invite_not_pending":
      return new HttpError(409, "tenant_membership_invite_not_pending", "Membership invite is no longer pending.");
    case "tenant_membership_invite_expired":
      return new HttpError(410, "tenant_membership_invite_expired", "Membership invite has expired.");
    case "tenant_membership_invite_revoked":
      return new HttpError(410, "tenant_membership_invite_revoked", "Membership invite was revoked.");
    case "tenant_membership_invite_unavailable":
      return new HttpError(409, "tenant_membership_invite_unavailable", "Membership invite is no longer available.");
    case "invite_email_mismatch":
      return new HttpError(409, "invite_email_mismatch", "This invite must be accepted with the invited email address.");
    default:
      return new HttpError(500, fallbackCode, "Unable to process the membership invite.");
  }
}

function mapAcceptRow(row: TenantMembershipInviteAcceptRow): TenantMembershipInviteAcceptResult {
  return {
    outcome: row.outcome,
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    email: row.email,
    role: row.role,
    acceptedAt: row.accepted_at,
  };
}

export function deriveInviterDisplayName(email: string | null | undefined) {
  const normalized = String(email ?? "").trim();
  if (!normalized) {
    return "SnapConsent";
  }

  const localPart = normalized.split("@")[0]?.trim();
  if (!localPart) {
    return normalized;
  }

  return localPart;
}

export async function getPublicTenantMembershipInvite(
  supabase: SupabaseClient,
  token: string,
): Promise<PublicTenantMembershipInvite | null> {
  const { data, error } = await supabase.rpc("get_public_tenant_membership_invite", {
    p_token: token,
  });

  if (error) {
    throw mapMutationError(error, "tenant_membership_invite_lookup_failed");
  }

  const row = (data?.[0] ?? null) as PublicTenantMembershipInviteRow | null;
  if (!row) {
    return null;
  }

  return {
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    canAccept: row.can_accept,
  };
}

export async function createOrRefreshTenantMembershipInvite(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    email: string;
    role: ManageableMembershipRole;
    expiresAt?: string | null;
  },
): Promise<TenantMembershipInviteMutationResult> {
  const { data, error } = await supabase.rpc("create_or_refresh_tenant_membership_invite", {
    p_tenant_id: input.tenantId,
    p_email: input.email,
    p_role: input.role,
    p_expires_at: input.expiresAt ?? null,
  });

  if (error) {
    throw mapMutationError(error, "tenant_membership_invite_create_failed");
  }

  const row = (data?.[0] ?? null) as TenantMembershipInviteMutationRow | null;
  if (!row) {
    throw new HttpError(500, "tenant_membership_invite_create_failed", "Unable to process the membership invite.");
  }

  return mapMutationRow(row);
}

export async function refreshTenantMembershipInvite(
  supabase: SupabaseClient,
  input: {
    inviteId: string;
    role?: ManageableMembershipRole | null;
    expiresAt?: string | null;
  },
): Promise<TenantMembershipInviteMutationResult> {
  const { data, error } = await supabase.rpc("refresh_tenant_membership_invite", {
    p_invite_id: input.inviteId,
    p_role: input.role ?? null,
    p_expires_at: input.expiresAt ?? null,
  });

  if (error) {
    throw mapMutationError(error, "tenant_membership_invite_resend_failed");
  }

  const row = (data?.[0] ?? null) as TenantMembershipInviteMutationRow | null;
  if (!row) {
    throw new HttpError(500, "tenant_membership_invite_resend_failed", "Unable to process the membership invite.");
  }

  return mapMutationRow(row);
}

export async function revokeTenantMembershipInvite(
  supabase: SupabaseClient,
  inviteId: string,
): Promise<TenantMembershipInviteRevokeResult> {
  const { data, error } = await supabase.rpc("revoke_tenant_membership_invite", {
    p_invite_id: inviteId,
  });

  if (error) {
    throw mapMutationError(error, "tenant_membership_invite_revoke_failed");
  }

  const row = (data?.[0] ?? null) as TenantMembershipInviteRevokeRow | null;
  if (!row) {
    throw new HttpError(500, "tenant_membership_invite_revoke_failed", "Unable to process the membership invite.");
  }

  return {
    outcome: row.outcome,
    inviteId: row.invite_id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    status: row.status,
    revokedAt: row.revoked_at,
  };
}

export async function acceptTenantMembershipInvite(
  supabase: SupabaseClient,
  token: string,
): Promise<TenantMembershipInviteAcceptResult> {
  const { data, error } = await supabase.rpc("accept_tenant_membership_invite", {
    p_token: token,
  });

  if (error) {
    throw mapMutationError(error, "tenant_membership_invite_accept_failed");
  }

  const row = (data?.[0] ?? null) as TenantMembershipInviteAcceptRow | null;
  if (!row) {
    throw new HttpError(500, "tenant_membership_invite_accept_failed", "Unable to process the membership invite.");
  }

  return mapAcceptRow(row);
}
