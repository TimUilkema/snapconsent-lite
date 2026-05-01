import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getTenantMembershipRole, type MembershipRole } from "@/lib/tenant/permissions";
import { roleHasCapability } from "@/lib/tenant/role-capabilities";
import { userHasAnyTenantCustomRoleCapabilities } from "@/lib/tenant/tenant-custom-role-capabilities";

export type ProfilesAccess = {
  role: MembershipRole;
  canViewProfiles: boolean;
  canManageProfiles: boolean;
};

export async function resolveProfilesAccess(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<ProfilesAccess> {
  const role = await getTenantMembershipRole(supabase, tenantId, userId);
  if (!role) {
    throw new HttpError(403, "no_tenant_membership", "Workspace membership is required.");
  }

  const fixedRoleCanView = roleHasCapability(role, "profiles.view");
  const fixedRoleCanManage = roleHasCapability(role, "profiles.manage");
  const customRoleCapabilities: Set<string> = fixedRoleCanView && fixedRoleCanManage
    ? new Set()
    : await userHasAnyTenantCustomRoleCapabilities({
        supabase,
        tenantId,
        userId,
        capabilityKeys: ["profiles.view", "profiles.manage"],
      });
  const customRoleCanManage = customRoleCapabilities.has("profiles.manage");
  const canManageProfiles = fixedRoleCanManage || customRoleCanManage;

  return {
    role,
    canViewProfiles: fixedRoleCanView || canManageProfiles || customRoleCapabilities.has("profiles.view"),
    canManageProfiles,
  };
}
