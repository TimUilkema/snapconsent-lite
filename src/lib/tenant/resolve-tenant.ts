import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

export async function resolveTenantId(supabase: SupabaseClient): Promise<string | null> {
  const { data, error } = await supabase.rpc("current_tenant_id");

  if (error) {
    throw new HttpError(500, "tenant_lookup_failed", "Unable to resolve tenant.");
  }

  return data ?? null;
}

export async function ensureTenantId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.rpc("ensure_tenant_for_current_user");

  if (error || !data) {
    throw new HttpError(
      403,
      "tenant_bootstrap_failed",
      "Unable to set up your workspace membership. Sign out and sign in again, then retry.",
    );
  }

  return data;
}
