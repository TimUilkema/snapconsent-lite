import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { createInviteWithIdempotency } from "@/lib/idempotency/invite-idempotency";
import { getVisiblePublishedTemplateById } from "@/lib/templates/template-service";
import { deriveInviteToken } from "@/lib/tokens/public-token";
import { buildInvitePath } from "@/lib/url/paths";

type IdempotencyRow<T> = {
  response_json: T;
};

type ConsentRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_id: string | null;
  subject_id: string;
  invite_id: string | null;
  revoked_at: string | null;
  structured_fields_snapshot: {
    templateSnapshot?: {
      templateId?: unknown;
      templateKey?: unknown;
      versionNumber?: unknown;
    };
  } | null;
};

type SubjectInviteRow = {
  id: string;
  consent_template_id: string | null;
};

type TemplateIdentityRow = {
  id: string;
  template_key: string;
  version_number: number;
};

type UpgradeRequestInviteRow = {
  id: string;
  status: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number;
};

type UpgradeRequestTemplateRow = {
  id: string;
  name: string;
  version: string;
};

type UpgradeRequestRow = {
  id: string;
  prior_consent_id: string;
  target_template_id: string;
  target_template_key: string;
  invite_id: string | null;
  status: "pending" | "signed" | "cancelled" | "expired" | "superseded";
  invite: UpgradeRequestInviteRow | UpgradeRequestInviteRow[] | null;
  target_template: UpgradeRequestTemplateRow | UpgradeRequestTemplateRow[] | null;
};

type CreateProjectConsentUpgradeRequestInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  consentId: string;
  targetTemplateId: string;
  idempotencyKey: string;
};

export type ProjectConsentUpgradeRequestPayload = {
  request: {
    id: string;
    projectId: string;
    priorConsentId: string;
    subjectId: string;
    targetTemplateId: string;
    targetTemplateKey: string;
    targetTemplateName: string;
    targetTemplateVersion: string;
    status: "pending";
    inviteId: string;
    invitePath: string;
    expiresAt: string | null;
  };
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateUuid(value: string, code: string, message: string) {
  const normalized = value.trim();
  if (!isUuid(normalized)) {
    throw new HttpError(404, code, message);
  }

  return normalized;
}

function validateIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
  }

  return normalized;
}

function isInviteExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }

  return new Date(expiresAt).getTime() <= Date.now();
}

function isShareableInvite(invite: UpgradeRequestInviteRow | null) {
  if (!invite) {
    return false;
  }

  return invite.status === "active" && !isInviteExpired(invite.expires_at) && invite.used_count < invite.max_uses;
}

function classifyInactiveUpgradeStatus(invite: UpgradeRequestInviteRow | null) {
  if (!invite) {
    return "cancelled" as const;
  }

  if (invite.status === "revoked") {
    return "cancelled" as const;
  }

  return "expired" as const;
}

function deriveUpgradeInvitePath(tenantId: string, projectId: string, upgradeRequestId: string) {
  return buildInvitePath(
    deriveInviteToken({
      tenantId,
      projectId,
      idempotencyKey: upgradeRequestId,
    }),
  );
}

async function readIdempotencyPayload<T>(
  supabase: SupabaseClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to process this request right now.");
  }

  return ((data as IdempotencyRow<T> | null)?.response_json ?? null) as T | null;
}

async function writeIdempotencyPayload(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  operation: string,
  idempotencyKey: string,
  payload: unknown,
) {
  const { error } = await supabase.from("idempotency_keys").upsert(
    {
      tenant_id: tenantId,
      operation,
      idempotency_key: idempotencyKey,
      response_json: payload,
      created_by: userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist request state.");
  }
}

async function loadConsentRow(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
): Promise<ConsentRow> {
  const { data, error } = await supabase
    .from("consents")
    .select("id, tenant_id, project_id, workspace_id, subject_id, invite_id, revoked_at, structured_fields_snapshot")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", consentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "consent_lookup_failed", "Unable to load consent.");
  }

  if (!data) {
    throw new HttpError(404, "consent_not_found", "Consent not found.");
  }

  return data as ConsentRow;
}

async function loadInviteTemplateId(
  supabase: SupabaseClient,
  tenantId: string,
  inviteId: string | null,
): Promise<string | null> {
  if (!inviteId) {
    return null;
  }

  const { data, error } = await supabase
    .from("subject_invites")
    .select("id, consent_template_id")
    .eq("tenant_id", tenantId)
    .eq("id", inviteId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "invite_lookup_failed", "Unable to load invite.");
  }

  return ((data as SubjectInviteRow | null)?.consent_template_id ?? null) as string | null;
}

async function loadTemplateIdentityById(
  supabase: SupabaseClient,
  templateId: string,
): Promise<TemplateIdentityRow | null> {
  const { data, error } = await supabase
    .from("consent_templates")
    .select("id, template_key, version_number")
    .eq("id", templateId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "template_lookup_failed", "Unable to load consent templates.");
  }

  return (data as TemplateIdentityRow | null) ?? null;
}

async function resolveSourceTemplateIdentity(
  supabase: SupabaseClient,
  consent: ConsentRow,
): Promise<TemplateIdentityRow | null> {
  const inviteTemplateId = await loadInviteTemplateId(supabase, consent.tenant_id, consent.invite_id);
  if (inviteTemplateId) {
    const inviteTemplate = await loadTemplateIdentityById(supabase, inviteTemplateId);
    if (inviteTemplate) {
      return inviteTemplate;
    }
  }

  const snapshot = consent.structured_fields_snapshot?.templateSnapshot;
  const snapshotTemplateId =
    typeof snapshot?.templateId === "string" && isUuid(snapshot.templateId) ? snapshot.templateId : null;
  if (snapshotTemplateId) {
    const snapshotTemplate = await loadTemplateIdentityById(supabase, snapshotTemplateId);
    if (snapshotTemplate) {
      return snapshotTemplate;
    }
  }

  const snapshotTemplateKey =
    typeof snapshot?.templateKey === "string" && snapshot.templateKey.trim().length > 0
      ? snapshot.templateKey.trim()
      : null;
  const snapshotVersionNumber =
    typeof snapshot?.versionNumber === "number" && Number.isInteger(snapshot.versionNumber)
      ? snapshot.versionNumber
      : null;

  if (!snapshotTemplateKey || snapshotVersionNumber === null) {
    return null;
  }

  return {
    id: snapshotTemplateId ?? "",
    template_key: snapshotTemplateKey,
    version_number: snapshotVersionNumber,
  };
}

async function listPendingUpgradeRequestsForFamily(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string,
  subjectId: string,
  templateKey: string,
): Promise<UpgradeRequestRow[]> {
  const { data, error } = await supabase
    .from("project_consent_upgrade_requests")
    .select(
      "id, prior_consent_id, target_template_id, target_template_key, invite_id, status, invite:subject_invites(id, status, expires_at, used_count, max_uses), target_template:consent_templates(id, name, version)",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("workspace_id", workspaceId)
    .eq("subject_id", subjectId)
    .eq("status", "pending")
    .eq("target_template_key", templateKey)
    .order("created_at", { ascending: false });

  if (error) {
    throw new HttpError(
      500,
      "project_consent_upgrade_request_lookup_failed",
      "Unable to load project consent upgrade requests.",
    );
  }

  return (data as UpgradeRequestRow[] | null) ?? [];
}

function toUpgradePayload(input: {
  tenantId: string;
  projectId: string;
  subjectId: string;
  priorConsentId: string;
  row: UpgradeRequestRow;
}) {
  const invite = firstRelation(input.row.invite);
  const targetTemplate = firstRelation(input.row.target_template);
  if (!invite?.id || !targetTemplate) {
    throw new HttpError(
      500,
      "project_consent_upgrade_request_create_failed",
      "Unable to create a consent upgrade request.",
    );
  }

  return {
    request: {
      id: input.row.id,
      projectId: input.projectId,
      priorConsentId: input.priorConsentId,
      subjectId: input.subjectId,
      targetTemplateId: input.row.target_template_id,
      targetTemplateKey: input.row.target_template_key,
      targetTemplateName: targetTemplate.name,
      targetTemplateVersion: targetTemplate.version,
      status: "pending" as const,
      inviteId: invite.id,
      invitePath: deriveUpgradeInvitePath(input.tenantId, input.projectId, input.row.id),
      expiresAt: invite.expires_at ?? null,
    },
  } satisfies ProjectConsentUpgradeRequestPayload;
}

export async function createProjectConsentUpgradeRequest(
  input: CreateProjectConsentUpgradeRequestInput,
): Promise<{
  status: number;
  payload: ProjectConsentUpgradeRequestPayload;
}> {
  const projectId = validateUuid(input.projectId, "project_not_found", "Project not found.");
  const consentId = validateUuid(input.consentId, "consent_not_found", "Consent not found.");
  const targetTemplateId = validateUuid(input.targetTemplateId, "template_not_found", "Template not found.");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const operation = `create_project_consent_upgrade_request:${projectId}:${consentId}:${targetTemplateId}`;

  const existingIdempotencyPayload = await readIdempotencyPayload<ProjectConsentUpgradeRequestPayload>(
    input.supabase,
    input.tenantId,
    operation,
    idempotencyKey,
  );

  if (existingIdempotencyPayload) {
    return {
      status: 200,
      payload: existingIdempotencyPayload,
    };
  }

  const priorConsent = await loadConsentRow(input.supabase, input.tenantId, projectId, consentId);
  const workspaceId = priorConsent.workspace_id?.trim() ?? "";
  if (!workspaceId) {
    throw new HttpError(409, "workspace_scope_missing", "Consent is missing a workspace assignment.");
  }
  if (priorConsent.revoked_at) {
    throw new HttpError(409, "consent_revoked", "Revoked consents cannot receive new assignments.");
  }

  const sourceTemplate = await resolveSourceTemplateIdentity(input.supabase, priorConsent);
  if (!sourceTemplate || sourceTemplate.template_key.trim().length === 0) {
    throw new HttpError(
      409,
      "consent_upgrade_source_template_missing",
      "The signed consent is missing an upgradeable template version.",
    );
  }

  const targetTemplate = await getVisiblePublishedTemplateById(
    input.supabase,
    input.tenantId,
    targetTemplateId,
  );
  if (!targetTemplate) {
    throw new HttpError(
      409,
      "project_template_unavailable",
      "The selected published template is not available for this project.",
    );
  }

  if (targetTemplate.templateKey !== sourceTemplate.template_key) {
    throw new HttpError(
      409,
      "consent_upgrade_template_family_mismatch",
      "Select a newer published version from the same consent template family.",
    );
  }

  if (targetTemplate.id === sourceTemplate.id || targetTemplate.versionNumber <= sourceTemplate.version_number) {
    throw new HttpError(
      409,
      "consent_upgrade_template_not_newer",
      "Select a newer published version before requesting an updated consent.",
    );
  }

  const pendingRequests = await listPendingUpgradeRequestsForFamily(
    input.supabase,
    input.tenantId,
    projectId,
    workspaceId,
    priorConsent.subject_id,
    targetTemplate.templateKey,
  );

  for (const pendingRequest of pendingRequests) {
    const invite = firstRelation(pendingRequest.invite);
    const isShareable = isShareableInvite(invite);

    if (pendingRequest.target_template_id === targetTemplate.id && isShareable) {
      const payload = toUpgradePayload({
        tenantId: input.tenantId,
        projectId,
        subjectId: priorConsent.subject_id,
        priorConsentId: pendingRequest.prior_consent_id,
        row: pendingRequest,
      });

      await writeIdempotencyPayload(
        input.supabase,
        input.tenantId,
        input.userId,
        operation,
        idempotencyKey,
        payload,
      );

      return {
        status: 200,
        payload,
      };
    }

    const nextStatus =
      pendingRequest.target_template_id === targetTemplate.id
        ? classifyInactiveUpgradeStatus(invite)
        : "superseded";

    const { error: updateError } = await input.supabase
      .from("project_consent_upgrade_requests")
      .update({ status: nextStatus })
      .eq("tenant_id", input.tenantId)
      .eq("workspace_id", workspaceId)
      .eq("id", pendingRequest.id)
      .eq("status", "pending");

    if (updateError) {
      throw new HttpError(
        500,
        "project_consent_upgrade_request_create_failed",
        "Unable to create a consent upgrade request.",
      );
    }
  }

  const requestId = randomUUID();
  const inviteResult = await createInviteWithIdempotency({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId,
    workspaceId,
    userId: input.userId,
    idempotencyKey: requestId,
    consentTemplateId: targetTemplate.id,
  });

  const { data, error } = await input.supabase
    .from("project_consent_upgrade_requests")
    .insert({
      id: requestId,
      tenant_id: input.tenantId,
      project_id: projectId,
      workspace_id: workspaceId,
      subject_id: priorConsent.subject_id,
      prior_consent_id: priorConsent.id,
      target_template_id: targetTemplate.id,
      target_template_key: targetTemplate.templateKey,
      invite_id: inviteResult.payload.inviteId,
      status: "pending",
      created_by_user_id: input.userId,
    })
    .select(
      "id, prior_consent_id, target_template_id, target_template_key, invite_id, status, invite:subject_invites(id, status, expires_at, used_count, max_uses), target_template:consent_templates(id, name, version)",
    )
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      const pendingRows = await listPendingUpgradeRequestsForFamily(
        input.supabase,
        input.tenantId,
        projectId,
        workspaceId,
        priorConsent.subject_id,
        targetTemplate.templateKey,
      );
      const existingPending = pendingRows.find(
        (row) => row.target_template_id === targetTemplate.id && isShareableInvite(firstRelation(row.invite)),
      );
      if (existingPending) {
        const payload = toUpgradePayload({
          tenantId: input.tenantId,
          projectId,
          subjectId: priorConsent.subject_id,
          priorConsentId: existingPending.prior_consent_id,
          row: existingPending,
        });

        await writeIdempotencyPayload(
          input.supabase,
          input.tenantId,
          input.userId,
          operation,
          idempotencyKey,
          payload,
        );

        return {
          status: 200,
          payload,
        };
      }
    }

    throw new HttpError(
      500,
      "project_consent_upgrade_request_create_failed",
      "Unable to create a consent upgrade request.",
    );
  }

  const payload = toUpgradePayload({
    tenantId: input.tenantId,
    projectId,
    subjectId: priorConsent.subject_id,
    priorConsentId: priorConsent.id,
    row: data as UpgradeRequestRow,
  });

  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status: 201,
    payload,
  };
}
