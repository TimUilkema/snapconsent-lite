import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import type { CorrectionRequestProvenance } from "@/lib/projects/project-workflow-service";
import { deriveInviteToken, hashPublicToken } from "@/lib/tokens/public-token";
import { buildInvitePath } from "@/lib/url/paths";

type InvitePayload = {
  inviteId: string;
  invitePath: string;
  expiresAt: string | null;
  consentTemplateId: string;
};

type CreateInviteInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  userId: string;
  idempotencyKey: string;
  consentTemplateId: string;
  correctionProvenance?: CorrectionRequestProvenance | null;
};

function getExpiryDateIso() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString();
}

export async function createInviteWithIdempotency(input: CreateInviteInput) {
  const workspaceId = input.workspaceId?.trim() || null;
  const correctionOperationSuffix = input.correctionProvenance
    ? `:correction:${input.correctionProvenance.correctionSourceReleaseIdSnapshot}:${input.correctionProvenance.correctionOpenedAtSnapshot}`
    : "";
  const operation = workspaceId
    ? `create_project_invite:${input.projectId}:${workspaceId}${correctionOperationSuffix}`
    : `create_project_invite:${input.projectId}${correctionOperationSuffix}`;

  const { data: existingIdempotency, error: idempotencyReadError } = await input.supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", input.tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (idempotencyReadError) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to create invite right now.");
  }

  const inviteToken = deriveInviteToken({
    tenantId: input.tenantId,
    projectId: input.projectId,
    idempotencyKey: `${input.idempotencyKey}${correctionOperationSuffix}`,
  });

  const invitePath = buildInvitePath(inviteToken);

  if (existingIdempotency?.response_json) {
    const payload = existingIdempotency.response_json as InvitePayload;
    return {
      status: 200,
      payload: {
        inviteId: payload.inviteId,
        invitePath: payload.invitePath || invitePath,
        expiresAt: payload.expiresAt,
        consentTemplateId: payload.consentTemplateId,
      },
    };
  }

  const { data: template, error: templateError } = await input.supabase
    .from("consent_templates")
    .select("id, tenant_id")
    .eq("id", input.consentTemplateId)
    .eq("status", "published")
    .maybeSingle();

  if (templateError) {
    throw new HttpError(500, "template_lookup_failed", "Unable to create invite.");
  }

  if (!template) {
    throw new HttpError(400, "invalid_template", "Consent template is not available.");
  }

  if (template.tenant_id !== null && template.tenant_id !== input.tenantId) {
    throw new HttpError(403, "template_forbidden", "Consent template is not available.");
  }

  const expiresAt = getExpiryDateIso();
  const tokenHash = hashPublicToken(inviteToken);
  const inviteInsert = {
    tenant_id: input.tenantId,
    project_id: input.projectId,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    created_by: input.userId,
    token_hash: tokenHash,
    status: "active",
    expires_at: expiresAt,
    max_uses: 1,
    consent_template_id: input.consentTemplateId,
    request_source: input.correctionProvenance?.requestSource ?? "normal",
    correction_opened_at_snapshot: input.correctionProvenance?.correctionOpenedAtSnapshot ?? null,
    correction_source_release_id_snapshot: input.correctionProvenance?.correctionSourceReleaseIdSnapshot ?? null,
  };

  const { data: invite, error: inviteError } = await input.supabase
    .from("subject_invites")
    .upsert(inviteInsert, { onConflict: "token_hash" })
    .select("id, expires_at")
    .single();

  if (inviteError || !invite) {
    throw new HttpError(500, "invite_create_failed", "Unable to create invite.");
  }

  const idempotencyPayload: InvitePayload = {
    inviteId: invite.id,
    invitePath,
    expiresAt: invite.expires_at,
    consentTemplateId: input.consentTemplateId,
  };

  const { error: idempotencyWriteError } = await input.supabase.from("idempotency_keys").upsert(
    {
      tenant_id: input.tenantId,
      operation,
      idempotency_key: input.idempotencyKey,
      response_json: idempotencyPayload,
      created_by: input.userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (idempotencyWriteError) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist invite idempotency.");
  }

  return {
    status: 201,
    payload: {
      inviteId: invite.id,
      invitePath,
      expiresAt: invite.expires_at,
      consentTemplateId: input.consentTemplateId,
    },
  };
}
