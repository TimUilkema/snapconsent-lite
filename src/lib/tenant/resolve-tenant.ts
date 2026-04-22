import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type TenantRpcResult = {
  tenantId: string | null;
  error: PostgrestError | null;
};

async function loadCurrentTenantId(supabase: SupabaseClient): Promise<TenantRpcResult> {
  const { data, error } = await supabase.rpc("current_tenant_id");

  return {
    tenantId: data ?? null,
    error,
  };
}

async function loadEnsuredTenantId(supabase: SupabaseClient): Promise<TenantRpcResult> {
  const { data, error } = await supabase.rpc("ensure_tenant_for_current_user");

  return {
    tenantId: data ?? null,
    error,
  };
}

async function hasAuthenticatedUser(supabase: SupabaseClient): Promise<boolean> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return !error && !!user;
}

async function resolveTenantIdWithRecovery(supabase: SupabaseClient): Promise<string | null> {
  const currentTenant = await loadCurrentTenantId(supabase);
  if (currentTenant.tenantId) {
    return currentTenant.tenantId;
  }

  let lastError = currentTenant.error;

  // Recover from the first-request auth/cookie transition by falling back to
  // the same bootstrap RPC the protected layout already relies on.
  const ensuredTenant = await loadEnsuredTenantId(supabase);
  if (ensuredTenant.tenantId) {
    return ensuredTenant.tenantId;
  }

  lastError = ensuredTenant.error ?? lastError;

  const retriedTenant = await loadCurrentTenantId(supabase);
  if (retriedTenant.tenantId) {
    return retriedTenant.tenantId;
  }

  lastError = retriedTenant.error ?? lastError;

  if (!(await hasAuthenticatedUser(supabase))) {
    return null;
  }

  if (lastError) {
    throw new HttpError(500, "tenant_lookup_failed", "Unable to resolve tenant.");
  }

  throw new HttpError(
    403,
    "tenant_bootstrap_failed",
    "Unable to set up your workspace membership. Sign out and sign in again, then retry.",
  );
}

export async function resolveTenantId(supabase: SupabaseClient): Promise<string | null> {
  return resolveTenantIdWithRecovery(supabase);
}

export async function ensureTenantId(supabase: SupabaseClient): Promise<string> {
  const tenantId = await resolveTenantIdWithRecovery(supabase);
  if (!tenantId) {
    throw new HttpError(
      403,
      "tenant_bootstrap_failed",
      "Unable to set up your workspace membership. Sign out and sign in again, then retry.",
    );
  }

  return tenantId;
}
