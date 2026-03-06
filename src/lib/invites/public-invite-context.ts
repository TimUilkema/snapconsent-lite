import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { hashPublicToken } from "@/lib/tokens/public-token";

export type PublicInviteContext = {
  inviteId: string;
  tenantId: string;
  projectId: string;
  createdBy: string;
  status: string;
  expiresAt: string | null;
  usedCount: number;
  maxUses: number;
  consentTemplateId: string | null;
};

function isInviteExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() <= Date.now();
}

export async function resolvePublicInviteContext(
  supabase: SupabaseClient,
  token: string,
): Promise<PublicInviteContext> {
  const tokenHash = hashPublicToken(token);
  const { data, error } = await supabase
    .from("subject_invites")
    .select("id, tenant_id, project_id, created_by, status, expires_at, used_count, max_uses, consent_template_id")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "invite_lookup_failed", "Unable to validate invite.");
  }

  if (!data) {
    throw new HttpError(404, "invite_not_found", "Invite is invalid.");
  }

  if (
    data.status !== "active" ||
    isInviteExpired(data.expires_at) ||
    data.used_count >= data.max_uses ||
    !data.consent_template_id
  ) {
    throw new HttpError(410, "invite_unavailable", "Invite is no longer available.");
  }

  return {
    inviteId: data.id,
    tenantId: data.tenant_id,
    projectId: data.project_id,
    createdBy: data.created_by,
    status: data.status,
    expiresAt: data.expires_at,
    usedCount: data.used_count,
    maxUses: data.max_uses,
    consentTemplateId: data.consent_template_id,
  };
}
