import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getTenantMembershipRole, type MembershipRole } from "@/lib/tenant/permissions";

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

  return {
    role,
    canViewProfiles: true,
    canManageProfiles: role === "owner" || role === "admin",
  };
}
