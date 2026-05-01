import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  userHasAnyTenantCustomRoleCapabilities,
} from "@/lib/tenant/tenant-custom-role-capabilities";
import {
  MANAGEABLE_MEMBERSHIP_ROLES,
  type ManageableMembershipRole,
  type MembershipRole,
} from "@/lib/tenant/role-capabilities";
import { resolveTenantMembership } from "@/lib/tenant/tenant-membership";

export type OrganizationUserAccess = {
  membership: {
    role: MembershipRole;
  };
  isFixedOwnerAdmin: boolean;
  canViewOrganizationUsers: boolean;
  canInviteOrganizationUsers: boolean;
  canChangeOrganizationUserRoles: boolean;
  canRemoveOrganizationUsers: boolean;
  canManageAllPendingInvites: boolean;
  allowedInviteRoles: ManageableMembershipRole[];
};

const FIXED_OWNER_ADMIN_INVITE_ROLES = MANAGEABLE_MEMBERSHIP_ROLES;
const DELEGATED_INVITE_ROLES = ["reviewer", "photographer"] as const satisfies readonly ManageableMembershipRole[];
const DELEGATED_MUTATION_ROLES = ["reviewer", "photographer"] as const satisfies readonly ManageableMembershipRole[];

export type OrganizationUserTargetMembership = {
  user_id: string;
  role: MembershipRole;
};

export type OrganizationUserTargetDenialReason =
  | "missing_capability"
  | "self_target"
  | "target_role_forbidden"
  | "next_role_forbidden";

export type OrganizationUserRoleChangeTargetDecision = {
  allowed: boolean;
  reason: OrganizationUserTargetDenialReason | null;
  allowedRoleOptions: ManageableMembershipRole[];
};

export type OrganizationUserRemoveTargetDecision = {
  allowed: boolean;
  reason: OrganizationUserTargetDenialReason | null;
};

export function hasAnyOrganizationUserAccess(access: Pick<
  OrganizationUserAccess,
  | "canViewOrganizationUsers"
  | "canInviteOrganizationUsers"
  | "canChangeOrganizationUserRoles"
  | "canRemoveOrganizationUsers"
>) {
  return (
    access.canViewOrganizationUsers
    || access.canInviteOrganizationUsers
    || access.canChangeOrganizationUserRoles
    || access.canRemoveOrganizationUsers
  );
}

function isDelegatedMutationRole(role: MembershipRole | ManageableMembershipRole): role is ManageableMembershipRole {
  return role === "reviewer" || role === "photographer";
}

export async function resolveOrganizationUserAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  adminSupabase?: SupabaseClient;
}): Promise<OrganizationUserAccess> {
  const membership = await resolveTenantMembership(input.supabase, input.tenantId, input.userId);
  const isFixedOwnerAdmin = membership.role === "owner" || membership.role === "admin";

  if (isFixedOwnerAdmin) {
    return {
      membership,
      isFixedOwnerAdmin: true,
      canViewOrganizationUsers: true,
      canInviteOrganizationUsers: true,
      canChangeOrganizationUserRoles: true,
      canRemoveOrganizationUsers: true,
      canManageAllPendingInvites: true,
      allowedInviteRoles: [...FIXED_OWNER_ADMIN_INVITE_ROLES],
    };
  }

  const capabilities = await userHasAnyTenantCustomRoleCapabilities({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    capabilityKeys: [
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
    adminSupabase: input.adminSupabase,
  });
  const canChangeOrganizationUserRoles = capabilities.has("organization_users.change_roles");
  const canRemoveOrganizationUsers = capabilities.has("organization_users.remove");
  const canViewOrganizationUsers = (
    capabilities.has("organization_users.manage")
    || canChangeOrganizationUserRoles
    || canRemoveOrganizationUsers
  );
  const canInviteOrganizationUsers = capabilities.has("organization_users.invite");

  return {
    membership,
    isFixedOwnerAdmin: false,
    canViewOrganizationUsers,
    canInviteOrganizationUsers,
    canChangeOrganizationUserRoles,
    canRemoveOrganizationUsers,
    canManageAllPendingInvites: false,
    allowedInviteRoles: canInviteOrganizationUsers ? [...DELEGATED_INVITE_ROLES] : [],
  };
}

export function canChangeOrganizationUserRoleTarget(input: {
  access: OrganizationUserAccess;
  actorUserId: string;
  targetMembership: OrganizationUserTargetMembership;
  nextRole: ManageableMembershipRole;
}): OrganizationUserRoleChangeTargetDecision {
  if (input.access.isFixedOwnerAdmin) {
    if (input.targetMembership.role === "owner") {
      return {
        allowed: false,
        reason: "target_role_forbidden",
        allowedRoleOptions: [],
      };
    }

    return {
      allowed: MANAGEABLE_MEMBERSHIP_ROLES.includes(input.nextRole),
      reason: MANAGEABLE_MEMBERSHIP_ROLES.includes(input.nextRole) ? null : "next_role_forbidden",
      allowedRoleOptions: [...MANAGEABLE_MEMBERSHIP_ROLES],
    };
  }

  if (!input.access.canChangeOrganizationUserRoles) {
    return {
      allowed: false,
      reason: "missing_capability",
      allowedRoleOptions: [],
    };
  }

  if (input.targetMembership.user_id === input.actorUserId) {
    return {
      allowed: false,
      reason: "self_target",
      allowedRoleOptions: [],
    };
  }

  if (!isDelegatedMutationRole(input.targetMembership.role)) {
    return {
      allowed: false,
      reason: "target_role_forbidden",
      allowedRoleOptions: [],
    };
  }

  if (!isDelegatedMutationRole(input.nextRole)) {
    return {
      allowed: false,
      reason: "next_role_forbidden",
      allowedRoleOptions: [...DELEGATED_MUTATION_ROLES],
    };
  }

  return {
    allowed: true,
    reason: null,
    allowedRoleOptions: [...DELEGATED_MUTATION_ROLES],
  };
}

export function canRemoveOrganizationUserTarget(input: {
  access: OrganizationUserAccess;
  actorUserId: string;
  targetMembership: OrganizationUserTargetMembership;
}): OrganizationUserRemoveTargetDecision {
  if (input.access.isFixedOwnerAdmin) {
    return {
      allowed: input.targetMembership.role !== "owner",
      reason: input.targetMembership.role === "owner" ? "target_role_forbidden" : null,
    };
  }

  if (!input.access.canRemoveOrganizationUsers) {
    return {
      allowed: false,
      reason: "missing_capability",
    };
  }

  if (input.targetMembership.user_id === input.actorUserId) {
    return {
      allowed: false,
      reason: "self_target",
    };
  }

  if (!isDelegatedMutationRole(input.targetMembership.role)) {
    return {
      allowed: false,
      reason: "target_role_forbidden",
    };
  }

  return {
    allowed: true,
    reason: null,
  };
}

function throwRoleChangeDecision(input: {
  decision: OrganizationUserRoleChangeTargetDecision;
  access: OrganizationUserAccess;
  targetMembership: OrganizationUserTargetMembership;
}) {
  if (input.decision.allowed) {
    return;
  }

  if (input.access.isFixedOwnerAdmin && input.targetMembership.role === "owner") {
    throw new HttpError(403, "owner_membership_immutable", "Owner memberships cannot be changed.");
  }

  if (input.decision.reason === "self_target") {
    throw new HttpError(
      403,
      "organization_user_self_target_forbidden",
      "You cannot change your own organization role.",
    );
  }

  if (input.decision.reason === "next_role_forbidden") {
    throw new HttpError(400, "invalid_membership_role", "The selected membership role is invalid.");
  }

  if (input.decision.reason === "target_role_forbidden") {
    throw new HttpError(
      403,
      "organization_user_target_forbidden",
      "You cannot change that organization user's role.",
    );
  }

  throw new HttpError(
    403,
    "organization_user_role_change_forbidden",
    "You do not have access to change organization user roles.",
  );
}

function throwRemoveDecision(input: {
  decision: OrganizationUserRemoveTargetDecision;
  access: OrganizationUserAccess;
  targetMembership: OrganizationUserTargetMembership;
}) {
  if (input.decision.allowed) {
    return;
  }

  if (input.access.isFixedOwnerAdmin && input.targetMembership.role === "owner") {
    throw new HttpError(403, "owner_membership_immutable", "Owner memberships cannot be removed.");
  }

  if (input.decision.reason === "self_target") {
    throw new HttpError(
      403,
      "organization_user_self_target_forbidden",
      "You cannot remove yourself from the organization.",
    );
  }

  if (input.decision.reason === "target_role_forbidden") {
    throw new HttpError(
      403,
      "organization_user_target_forbidden",
      "You cannot remove that organization user.",
    );
  }

  throw new HttpError(
    403,
    "organization_user_remove_forbidden",
    "You do not have access to remove organization users.",
  );
}

export async function assertCanChangeOrganizationUserRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  targetMembership: OrganizationUserTargetMembership;
  nextRole: ManageableMembershipRole;
}) {
  const access = await resolveOrganizationUserAccess(input);
  const decision = canChangeOrganizationUserRoleTarget({
    access,
    actorUserId: input.userId,
    targetMembership: input.targetMembership,
    nextRole: input.nextRole,
  });
  throwRoleChangeDecision({
    decision,
    access,
    targetMembership: input.targetMembership,
  });

  return {
    access,
    decision,
  };
}

export async function assertCanRemoveOrganizationUser(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  targetMembership: OrganizationUserTargetMembership;
}) {
  const access = await resolveOrganizationUserAccess(input);
  const decision = canRemoveOrganizationUserTarget({
    access,
    actorUserId: input.userId,
    targetMembership: input.targetMembership,
  });
  throwRemoveDecision({
    decision,
    access,
    targetMembership: input.targetMembership,
  });

  return {
    access,
    decision,
  };
}

export async function assertCanViewOrganizationUsers(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const access = await resolveOrganizationUserAccess(input);
  if (!access.canViewOrganizationUsers) {
    throw new HttpError(
      403,
      "organization_user_view_forbidden",
      "You do not have access to organization users.",
    );
  }

  return access;
}

export async function assertCanInviteOrganizationUsers(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  targetRole?: ManageableMembershipRole | null;
}) {
  const access = await resolveOrganizationUserAccess(input);
  if (!access.canInviteOrganizationUsers) {
    throw new HttpError(
      403,
      "organization_user_invite_forbidden",
      "You do not have access to invite organization users.",
    );
  }

  if (
    input.targetRole
    && !access.allowedInviteRoles.includes(input.targetRole)
  ) {
    throw new HttpError(
      403,
      "organization_user_invite_forbidden",
      "You do not have access to invite users with that role.",
    );
  }

  return access;
}

export async function assertCanChangeOrganizationUserRoles(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const access = await resolveOrganizationUserAccess(input);
  if (!access.canChangeOrganizationUserRoles) {
    throw new HttpError(
      403,
      "organization_user_role_change_forbidden",
      "You do not have access to change organization user roles.",
    );
  }

  return access;
}

export async function assertCanRemoveOrganizationUsers(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const access = await resolveOrganizationUserAccess(input);
  if (!access.canRemoveOrganizationUsers) {
    throw new HttpError(
      403,
      "organization_user_remove_forbidden",
      "You do not have access to remove organization users.",
    );
  }

  return access;
}
