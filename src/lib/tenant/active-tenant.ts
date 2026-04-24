import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import type { MembershipRole } from "@/lib/tenant/permissions";

type MembershipRow = {
  tenant_id: string;
  role: MembershipRole;
  created_at: string;
};

type TenantRow = {
  id: string;
  name: string;
};

export type CurrentUserTenantMembership = {
  tenantId: string;
  tenantName: string;
  role: MembershipRole;
  createdAt: string;
};

export async function listCurrentUserTenantMemberships(
  supabase: SupabaseClient,
): Promise<CurrentUserTenantMembership[]> {
  const { data: membershipRows, error: membershipError } = await supabase
    .from("memberships")
    .select("tenant_id, role, created_at")
    .order("created_at", { ascending: true });

  if (membershipError) {
    throw new HttpError(500, "tenant_membership_lookup_failed", "Unable to load workspace memberships.");
  }

  const memberships = (membershipRows ?? []) as MembershipRow[];
  if (memberships.length === 0) {
    return [];
  }

  const tenantIds = [...new Set(memberships.map((membership) => membership.tenant_id))];
  const { data: tenantRows, error: tenantError } = await supabase
    .from("tenants")
    .select("id, name")
    .in("id", tenantIds);

  if (tenantError) {
    throw new HttpError(500, "tenant_membership_lookup_failed", "Unable to load workspace memberships.");
  }

  const tenantNameById = new Map(
    ((tenantRows ?? []) as TenantRow[]).map((tenant) => [tenant.id, tenant.name] as const),
  );

  return memberships.map((membership) => {
    const tenantName = tenantNameById.get(membership.tenant_id);
    if (!tenantName) {
      throw new HttpError(500, "tenant_membership_lookup_failed", "Unable to load workspace memberships.");
    }

    return {
      tenantId: membership.tenant_id,
      tenantName,
      role: membership.role,
      createdAt: membership.created_at,
    };
  });
}

export async function currentUserHasTenantMembership(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "tenant_membership_lookup_failed", "Unable to validate workspace access.");
  }

  return !!data;
}
