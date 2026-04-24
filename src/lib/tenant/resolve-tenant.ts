import { cookies } from "next/headers";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  ACTIVE_TENANT_COOKIE_NAME,
  PENDING_ORG_INVITE_COOKIE_NAME,
} from "@/lib/tenant/tenant-cookies";

type TenantRpcResult = {
  tenantId: string | null;
  error: PostgrestError | null;
};

type MembershipRow = {
  tenant_id: string;
  created_at: string;
};

type TenantMembershipLookupResult = {
  memberships: MembershipRow[];
  error: PostgrestError | null;
};

type TenantCookieValues = {
  activeTenantId: string | null;
  pendingOrgInviteToken: string | null;
};

type ResolveTenantDependencies = {
  loadMemberships?: (supabase: SupabaseClient) => Promise<TenantMembershipLookupResult>;
  loadEnsuredTenantId?: (supabase: SupabaseClient) => Promise<TenantRpcResult>;
  hasAuthenticatedUser?: (supabase: SupabaseClient) => Promise<boolean>;
  loadTenantCookies?: () => Promise<TenantCookieValues>;
};

async function loadCurrentUserMemberships(supabase: SupabaseClient): Promise<TenantMembershipLookupResult> {
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id, created_at")
    .order("created_at", { ascending: true });

  return {
    memberships: ((data ?? []) as MembershipRow[]).map((row) => ({
      tenant_id: row.tenant_id,
      created_at: row.created_at,
    })),
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

async function loadTenantCookies(): Promise<TenantCookieValues> {
  try {
    const cookieStore = await cookies();

    return {
      activeTenantId: cookieStore.get(ACTIVE_TENANT_COOKIE_NAME)?.value ?? null,
      pendingOrgInviteToken: cookieStore.get(PENDING_ORG_INVITE_COOKIE_NAME)?.value ?? null,
    };
  } catch {
    // Some shared library callers run outside a Next.js request scope.
    return {
      activeTenantId: null,
      pendingOrgInviteToken: null,
    };
  }
}

function selectActiveTenantId(memberships: MembershipRow[], activeTenantId: string | null) {
  if (memberships.length === 0) {
    return null;
  }

  if (memberships.length === 1) {
    return memberships[0]!.tenant_id;
  }

  if (activeTenantId && memberships.some((membership) => membership.tenant_id === activeTenantId)) {
    return activeTenantId;
  }

  throw new HttpError(409, "active_tenant_required", "Select a workspace before continuing.");
}

function throwPendingOrgInviteAcceptanceRequired() {
  throw new HttpError(
    409,
    "pending_org_invite_acceptance_required",
    "Accept your organization invitation before continuing.",
  );
}

async function resolveTenantIdWithRecovery(
  supabase: SupabaseClient,
  dependencies: ResolveTenantDependencies = {},
): Promise<string | null> {
  const loadMemberships = dependencies.loadMemberships ?? loadCurrentUserMemberships;
  const ensureTenantForCurrentUser = dependencies.loadEnsuredTenantId ?? loadEnsuredTenantId;
  const loadAuthState = dependencies.hasAuthenticatedUser ?? hasAuthenticatedUser;
  const readCookies = dependencies.loadTenantCookies ?? loadTenantCookies;

  const cookieValues = await readCookies();
  const currentMembershipLookup = await loadMemberships(supabase);
  if (currentMembershipLookup.memberships.length > 0) {
    return selectActiveTenantId(currentMembershipLookup.memberships, cookieValues.activeTenantId);
  }

  let lastError = currentMembershipLookup.error;

  if (cookieValues.pendingOrgInviteToken) {
    throwPendingOrgInviteAcceptanceRequired();
  }

  const ensuredTenant = await ensureTenantForCurrentUser(supabase);
  if (ensuredTenant.tenantId) {
    return ensuredTenant.tenantId;
  }

  lastError = ensuredTenant.error ?? lastError;

  const retriedMembershipLookup = await loadMemberships(supabase);
  if (retriedMembershipLookup.memberships.length > 0) {
    return selectActiveTenantId(retriedMembershipLookup.memberships, cookieValues.activeTenantId);
  }

  lastError = retriedMembershipLookup.error ?? lastError;

  if (!(await loadAuthState(supabase))) {
    return null;
  }

  if (cookieValues.pendingOrgInviteToken) {
    throwPendingOrgInviteAcceptanceRequired();
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

export async function resolveTenantId(
  supabase: SupabaseClient,
  dependencies?: ResolveTenantDependencies,
): Promise<string | null> {
  return resolveTenantIdWithRecovery(supabase, dependencies);
}

export async function ensureTenantId(
  supabase: SupabaseClient,
  dependencies?: ResolveTenantDependencies,
): Promise<string> {
  const tenantId = await resolveTenantIdWithRecovery(supabase, dependencies);
  if (!tenantId) {
    throw new HttpError(
      403,
      "tenant_bootstrap_failed",
      "Unable to set up your workspace membership. Sign out and sign in again, then retry.",
    );
  }

  return tenantId;
}
