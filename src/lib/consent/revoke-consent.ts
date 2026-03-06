import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type RevokeResult = {
  consentId: string;
  revoked: boolean;
  alreadyRevoked: boolean;
};

export async function revokeConsentByToken(
  supabase: SupabaseClient,
  token: string,
  reason: string,
): Promise<RevokeResult> {
  const { data, error } = await supabase.rpc("revoke_public_consent", {
    p_token: token,
    p_reason: reason,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new HttpError(404, "revoke_not_found", "Revoke link is invalid.");
    }

    if (error.code === "22023") {
      throw new HttpError(410, "revoke_expired", "Revoke link has expired.");
    }

    throw new HttpError(500, "revoke_failed", "Unable to revoke consent.");
  }

  const row = data?.[0];

  if (!row) {
    throw new HttpError(500, "revoke_failed", "Unable to revoke consent.");
  }

  return {
    consentId: row.consent_id,
    revoked: row.revoked,
    alreadyRevoked: row.already_revoked,
  };
}
