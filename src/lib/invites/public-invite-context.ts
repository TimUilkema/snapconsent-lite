import type { SupabaseClient } from "@supabase/supabase-js";

import { mapStructuredSnapshotToFormValues, type PublicConsentInitialValues } from "@/lib/consent/public-consent-prefill";
import { HttpError } from "@/lib/http/errors";
import { hashPublicToken } from "@/lib/tokens/public-token";
import type { StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";

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

type SubjectRelation = {
  full_name: string | null;
  email: string | null;
};

type UpgradeRequestRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  subject_id: string;
  prior_consent_id: string;
  target_template_id: string;
  target_template_key: string;
};

type PriorConsentRow = {
  id: string;
  subject_id: string;
  face_match_opt_in: boolean | null;
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
  subjects: SubjectRelation | SubjectRelation[] | null;
};

export type PublicInviteUpgradeContext = {
  upgradeRequestId: string;
  subjectId: string;
  priorConsentId: string;
  targetTemplateId: string;
  targetTemplateKey: string;
  initialValues: PublicConsentInitialValues;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

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

export async function resolvePublicInviteUpgradeContext(
  supabase: SupabaseClient,
  inviteId: string,
): Promise<PublicInviteUpgradeContext | null> {
  const { data: upgradeRequest, error: upgradeError } = await supabase
    .from("project_consent_upgrade_requests")
    .select("id, tenant_id, project_id, subject_id, prior_consent_id, target_template_id, target_template_key")
    .eq("invite_id", inviteId)
    .eq("status", "pending")
    .maybeSingle();

  if (upgradeError) {
    throw new HttpError(500, "invite_lookup_failed", "Unable to load invite.");
  }

  if (!upgradeRequest) {
    return null;
  }

  const { data: priorConsent, error: priorConsentError } = await supabase
    .from("consents")
    .select("id, subject_id, face_match_opt_in, structured_fields_snapshot, subjects(full_name, email)")
    .eq("tenant_id", (upgradeRequest as UpgradeRequestRow).tenant_id)
    .eq("project_id", (upgradeRequest as UpgradeRequestRow).project_id)
    .eq("id", upgradeRequest.prior_consent_id)
    .maybeSingle();

  if (priorConsentError) {
    throw new HttpError(500, "invite_lookup_failed", "Unable to load invite.");
  }

  if (!priorConsent || priorConsent.subject_id !== upgradeRequest.subject_id) {
    throw new HttpError(410, "invite_unavailable", "Invite is no longer available.");
  }

  const subject = firstRelation((priorConsent as PriorConsentRow).subjects);

  return {
    upgradeRequestId: (upgradeRequest as UpgradeRequestRow).id,
    subjectId: (upgradeRequest as UpgradeRequestRow).subject_id,
    priorConsentId: (upgradeRequest as UpgradeRequestRow).prior_consent_id,
    targetTemplateId: (upgradeRequest as UpgradeRequestRow).target_template_id,
    targetTemplateKey: (upgradeRequest as UpgradeRequestRow).target_template_key,
    initialValues: {
      subjectName: subject?.full_name ?? "",
      subjectEmail: subject?.email ?? "",
      faceMatchOptIn: (priorConsent as PriorConsentRow).face_match_opt_in === true,
      structuredFieldValues: mapStructuredSnapshotToFormValues(
        (priorConsent as PriorConsentRow).structured_fields_snapshot,
      ),
    },
  };
}
