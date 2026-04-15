import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { enqueueReconcileProjectJob } from "@/lib/matching/auto-match-jobs";
import { enqueueRecurringProjectReplayForProfile } from "@/lib/matching/project-recurring-sources";

type PublicRecurringRevokeTokenRpcRow = {
  consent_id: string;
  profile_name: string;
  profile_email: string;
  revoked_at: string | null;
  expires_at: string;
  consumed_at: string | null;
  status: "available" | "revoked" | "expired";
};

export type PublicRecurringRevokeToken = {
  consentId: string;
  profileName: string;
  profileEmail: string;
  revokedAt: string | null;
  expiresAt: string;
  consumedAt: string | null;
  status: "available" | "revoked" | "expired";
};

export type RevokeRecurringConsentResult = {
  consentId: string;
  revoked: boolean;
  alreadyRevoked: boolean;
};

type RecurringConsentScopeRow = {
  tenant_id: string;
  profile_id: string;
  project_id: string | null;
  consent_kind: "baseline" | "project";
};

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loadRecurringConsentScope(consentId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("recurring_profile_consents")
    .select("tenant_id, profile_id, project_id, consent_kind")
    .eq("id", consentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_revoke_lookup_failed", "Unable to validate recurring revoke link.");
  }

  return (data as RecurringConsentScopeRow | null) ?? null;
}

export async function getPublicRecurringRevokeToken(
  supabase: SupabaseClient,
  token: string,
): Promise<PublicRecurringRevokeToken | null> {
  const { data, error } = await supabase.rpc("get_public_recurring_profile_revoke_token", {
    p_token: token,
  });

  if (error) {
    throw new HttpError(500, "recurring_revoke_lookup_failed", "Unable to validate recurring revoke link.");
  }

  const row = (data?.[0] as PublicRecurringRevokeTokenRpcRow | undefined) ?? null;
  if (!row) {
    return null;
  }

  return {
    consentId: row.consent_id,
    profileName: row.profile_name,
    profileEmail: row.profile_email,
    revokedAt: row.revoked_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
    status: row.status,
  };
}

export async function revokeRecurringProfileConsentByToken(
  supabase: SupabaseClient,
  token: string,
  reason: string,
): Promise<RevokeRecurringConsentResult> {
  const { data, error } = await supabase.rpc("revoke_public_recurring_profile_consent", {
    p_token: token,
    p_reason: reason,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new HttpError(404, "recurring_revoke_not_found", "Recurring revoke link is invalid.");
    }

    if (error.code === "22023") {
      throw new HttpError(410, "recurring_revoke_expired", "Recurring revoke link has expired.");
    }

    throw new HttpError(500, "recurring_revoke_failed", "Unable to revoke recurring consent.");
  }

  const row = data?.[0];
  if (!row) {
    throw new HttpError(500, "recurring_revoke_failed", "Unable to revoke recurring consent.");
  }

  const consentScope = await loadRecurringConsentScope(row.consent_id);
  if (consentScope?.consent_kind === "baseline" && row.revoked === true) {
    await enqueueRecurringProjectReplayForProfile(undefined, {
      tenantId: consentScope.tenant_id,
      profileId: consentScope.profile_id,
      reason: "baseline_recurring_consent_revoked",
    });
  } else if (
    consentScope?.consent_kind === "project"
    && consentScope.project_id
    && row.revoked === true
    && row.already_revoked !== true
  ) {
    await enqueueReconcileProjectJob({
      tenantId: consentScope.tenant_id,
      projectId: consentScope.project_id,
      windowKey: `project_recurring_consent:${consentScope.profile_id}`,
      payload: {
        replayKind: "project_recurring_consent",
        profileId: consentScope.profile_id,
        consentId: row.consent_id,
        reason: "project_recurring_consent_revoked",
      },
      mode: "repair_requeue",
      requeueReason: "project_recurring_consent_revoked",
    });
  }

  return {
    consentId: row.consent_id,
    revoked: row.revoked,
    alreadyRevoked: row.already_revoked,
  };
}
