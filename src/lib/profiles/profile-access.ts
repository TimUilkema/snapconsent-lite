import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type MembershipRole = "owner" | "admin" | "photographer";

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
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "membership_lookup_failed", "Unable to validate workspace access.");
  }

  const role = (data?.role as MembershipRole | undefined) ?? null;
  if (!role) {
    throw new HttpError(403, "no_tenant_membership", "Workspace membership is required.");
  }

  return {
    role,
    canViewProfiles: true,
    canManageProfiles: role === "owner" || role === "admin",
  };
}
