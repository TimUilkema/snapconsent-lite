import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import type { MembershipRole } from "@/lib/tenant/role-capabilities";

export async function getTenantMembershipRole(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "membership_lookup_failed", "Unable to validate workspace access.");
  }

  return (data?.role as MembershipRole | undefined) ?? null;
}

export async function resolveTenantMembership(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const role = await getTenantMembershipRole(supabase, tenantId, userId);
  if (!role) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  return {
    role,
  };
}
