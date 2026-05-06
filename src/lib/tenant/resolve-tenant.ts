import { cookies } from "next/headers";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { isPendingOrgInviteTokenUsable } from "@/lib/tenant/pending-org-invite";
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
  authenticatedUserId?: string;
  missingMembershipBehavior?: "setup_required" | "bootstrap";
  loadMemberships?: (
    supabase: SupabaseClient,
    authenticatedUserId: string,
  ) => Promise<TenantMembershipLookupResult>;
  loadEnsuredTenantId?: (supabase: SupabaseClient) => Promise<TenantRpcResult>;
  loadAuthenticatedUserId?: (supabase: SupabaseClient) => Promise<string | null>;
  loadTenantCookies?: () => Promise<TenantCookieValues>;
  validatePendingOrgInviteToken?: (supabase: SupabaseClient, token: string) => Promise<boolean>;
};

async function loadCurrentUserMemberships(
  supabase: SupabaseClient,
  authenticatedUserId: string,
): Promise<TenantMembershipLookupResult> {
  const { data, error } = await supabase
    .from("memberships")
    .select("tenant_id, created_at")
    .eq("user_id", authenticatedUserId)
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

async function loadAuthenticatedUserId(supabase: SupabaseClient): Promise<string | null> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  return !error && user ? user.id : null;
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

function throwOrganizationSetupRequired() {
  throw new HttpError(
    409,
    "organization_setup_required",
    "Set up your organization before continuing.",
  );
}

async function resolveTenantIdWithRecovery(
  supabase: SupabaseClient,
  dependencies: ResolveTenantDependencies = {},
): Promise<string | null> {
  const loadMemberships = dependencies.loadMemberships ?? loadCurrentUserMemberships;
  const ensureTenantForCurrentUser = dependencies.loadEnsuredTenantId ?? loadEnsuredTenantId;
  const loadCurrentUserId = dependencies.loadAuthenticatedUserId ?? loadAuthenticatedUserId;
  const readCookies = dependencies.loadTenantCookies ?? loadTenantCookies;
  const validatePendingOrgInviteToken =
    dependencies.validatePendingOrgInviteToken ?? isPendingOrgInviteTokenUsable;

  const cookieValues = await readCookies();
  const authenticatedUserId = dependencies.authenticatedUserId ?? await loadCurrentUserId(supabase);
  if (!authenticatedUserId) {
    return null;
  }

  const currentMembershipLookup = await loadMemberships(supabase, authenticatedUserId);
  if (currentMembershipLookup.memberships.length > 0) {
    return selectActiveTenantId(currentMembershipLookup.memberships, cookieValues.activeTenantId);
  }

  let lastError = currentMembershipLookup.error;

  if (
    cookieValues.pendingOrgInviteToken &&
    await validatePendingOrgInviteToken(supabase, cookieValues.pendingOrgInviteToken)
  ) {
    throwPendingOrgInviteAcceptanceRequired();
  }

  if ((dependencies.missingMembershipBehavior ?? "setup_required") !== "bootstrap") {
    if (lastError) {
      throw new HttpError(500, "tenant_lookup_failed", "Unable to resolve tenant.");
    }

    throwOrganizationSetupRequired();
  }

  const ensuredTenant = await ensureTenantForCurrentUser(supabase);
  if (ensuredTenant.tenantId) {
    return ensuredTenant.tenantId;
  }

  lastError = ensuredTenant.error ?? lastError;

  const retriedMembershipLookup = await loadMemberships(supabase, authenticatedUserId);
  if (retriedMembershipLookup.memberships.length > 0) {
    return selectActiveTenantId(retriedMembershipLookup.memberships, cookieValues.activeTenantId);
  }

  lastError = retriedMembershipLookup.error ?? lastError;

  if (
    cookieValues.pendingOrgInviteToken &&
    await validatePendingOrgInviteToken(supabase, cookieValues.pendingOrgInviteToken)
  ) {
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
