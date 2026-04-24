import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";

export const FACE_MATCH_JOB_TYPES = [
  "photo_uploaded",
  "consent_headshot_ready",
  "reconcile_project",
  "materialize_asset_faces",
  "compare_materialized_pair",
  "compare_recurring_profile_materialized_pair",
] as const;

export type FaceMatchJobType = (typeof FACE_MATCH_JOB_TYPES)[number];

type EnqueueFaceMatchJobInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  jobType: FaceMatchJobType;
  dedupeKey: string;
  scopeAssetId?: string | null;
  scopeConsentId?: string | null;
  payload?: Record<string, unknown> | null;
  maxAttempts?: number;
  runAfter?: string | null;
  supabase?: SupabaseClient;
};

type RequeueFaceMatchJobInput = EnqueueFaceMatchJobInput & {
  requeueReason: string;
};

type EnqueueResultRow = {
  job_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  enqueued: boolean;
};

export type EnqueueFaceMatchJobResult = {
  jobId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  enqueued: boolean;
};

type RequeueResultRow = {
  job_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  enqueued: boolean;
  requeued: boolean;
  already_processing: boolean;
  already_queued: boolean;
};

export type RepairFaceMatchJobResult = {
  jobId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  enqueued: boolean;
  requeued: boolean;
  alreadyProcessing: boolean;
  alreadyQueued: boolean;
};

export type FaceMatchJobDispatchMode = "enqueue" | "repair_requeue";

type ExistingFaceMatchJobRow = {
  id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  lease_expires_at: string | null;
  locked_at: string | null;
  updated_at: string;
  created_at: string;
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

function getInternalSupabaseClient(supabase?: SupabaseClient) {
  return supabase ?? createServiceRoleClient();
}

function normalizeUuid(value: string) {
  return String(value).trim();
}

function normalizeDedupeSegment(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized.length > 0 ? normalized : "na";
}

async function loadExistingFaceMatchJobByDedupeKey(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  dedupeKey: string,
) {
  let query = supabase
    .from("face_match_jobs")
    .select("id, status, attempt_count, max_attempts, run_after, lease_expires_at, locked_at, updated_at, created_at")
    .eq("tenant_id", normalizeUuid(tenantId))
    .eq("project_id", normalizeUuid(projectId))
    .eq("dedupe_key", String(dedupeKey).trim());

  const normalizedWorkspaceId = String(workspaceId ?? "").trim();
  if (normalizedWorkspaceId) {
    query = query.eq("workspace_id", normalizedWorkspaceId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new HttpError(500, "face_match_job_lookup_failed", "Unable to inspect existing face-match job.");
  }

  return (data as ExistingFaceMatchJobRow | null) ?? null;
}

function coerceIsoToMillis(value: string | null | undefined) {
  const millis = Date.parse(String(value ?? ""));
  return Number.isFinite(millis) ? millis : null;
}

function isExistingJobActivelyProcessing(job: ExistingFaceMatchJobRow) {
  if (job.status !== "processing") {
    return false;
  }

  const nowMillis = Date.now();
  const expiryMillis =
    coerceIsoToMillis(job.lease_expires_at) ??
    coerceIsoToMillis(job.locked_at) ??
    coerceIsoToMillis(job.updated_at) ??
    coerceIsoToMillis(job.created_at);

  return expiryMillis !== null && expiryMillis > nowMillis;
}

async function recoverDuplicateEnqueueRace(
  supabase: SupabaseClient,
  input: EnqueueFaceMatchJobInput,
): Promise<EnqueueFaceMatchJobResult | null> {
  const existing = await loadExistingFaceMatchJobByDedupeKey(
    supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    input.dedupeKey,
  );
  if (!existing) {
    return null;
  }

  return {
    jobId: existing.id,
    status: existing.status,
    attemptCount: existing.attempt_count,
    maxAttempts: existing.max_attempts,
    runAfter: existing.run_after,
    enqueued: false,
  };
}

async function recoverDuplicateRequeueRace(
  supabase: SupabaseClient,
  input: RequeueFaceMatchJobInput,
): Promise<RepairFaceMatchJobResult | null> {
  const existing = await loadExistingFaceMatchJobByDedupeKey(
    supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    input.dedupeKey,
  );
  if (!existing) {
    return null;
  }

  return {
    jobId: existing.id,
    status: existing.status,
    attemptCount: existing.attempt_count,
    maxAttempts: existing.max_attempts,
    runAfter: existing.run_after,
    enqueued: false,
    requeued: false,
    alreadyProcessing: isExistingJobActivelyProcessing(existing),
    alreadyQueued: existing.status === "queued",
  };
}

async function attachWorkspaceScopeToJob(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  jobId: string,
  workspaceId: string | null | undefined,
) {
  const normalizedWorkspaceId = String(workspaceId ?? "").trim();
  if (!normalizedWorkspaceId) {
    return;
  }

  const { error } = await supabase
    .from("face_match_jobs")
    .update({ workspace_id: normalizedWorkspaceId })
    .eq("tenant_id", normalizeUuid(tenantId))
    .eq("project_id", normalizeUuid(projectId))
    .eq("id", normalizeUuid(jobId));

  if (error) {
    throw new HttpError(500, "face_match_enqueue_failed", "Unable to scope face-match job.");
  }
}

export function buildPhotoUploadedDedupeKey(assetId: string) {
  return `photo_uploaded:${normalizeDedupeSegment(assetId)}`;
}

export function buildConsentHeadshotReadyDedupeKey(consentId: string, headshotAssetId?: string | null) {
  return `consent_headshot_ready:${normalizeDedupeSegment(consentId)}:${normalizeDedupeSegment(headshotAssetId)}`;
}

export function buildReconcileProjectDedupeKey(projectId: string, windowKey: string) {
  return `reconcile_project:${normalizeDedupeSegment(projectId)}:${normalizeDedupeSegment(windowKey)}`;
}

export function buildMaterializeAssetFacesDedupeKey(assetId: string, materializerVersion: string) {
  return `materialize_asset_faces:${normalizeDedupeSegment(assetId)}:${normalizeDedupeSegment(materializerVersion)}`;
}

export function buildCompareMaterializedPairDedupeKey(
  consentId: string,
  assetId: string,
  headshotMaterializationId: string,
  assetMaterializationId: string,
  compareVersion: string,
) {
  return `compare_materialized_pair:${normalizeDedupeSegment(consentId)}:${normalizeDedupeSegment(assetId)}:${normalizeDedupeSegment(headshotMaterializationId)}:${normalizeDedupeSegment(assetMaterializationId)}:${normalizeDedupeSegment(compareVersion)}`;
}

export function buildCompareRecurringProfileMaterializedPairDedupeKey(
  projectProfileParticipantId: string,
  assetId: string,
  recurringSelectionFaceId: string,
  assetMaterializationId: string,
  compareVersion: string,
) {
  return `compare_recurring_profile_materialized_pair:${normalizeDedupeSegment(projectProfileParticipantId)}:${normalizeDedupeSegment(assetId)}:${normalizeDedupeSegment(recurringSelectionFaceId)}:${normalizeDedupeSegment(assetMaterializationId)}:${normalizeDedupeSegment(compareVersion)}`;
}

export async function enqueueFaceMatchJob(
  input: EnqueueFaceMatchJobInput,
): Promise<EnqueueFaceMatchJobResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("enqueue_face_match_job", {
    p_tenant_id: normalizeUuid(input.tenantId),
    p_project_id: normalizeUuid(input.projectId),
    p_workspace_id: input.workspaceId ? normalizeUuid(input.workspaceId) : null,
    p_job_type: input.jobType,
    p_dedupe_key: String(input.dedupeKey).trim(),
    p_scope_asset_id: input.scopeAssetId ? normalizeUuid(input.scopeAssetId) : null,
    p_scope_consent_id: input.scopeConsentId ? normalizeUuid(input.scopeConsentId) : null,
    p_payload: input.payload ?? {},
    p_max_attempts: input.maxAttempts ?? 5,
    p_run_after: input.runAfter ?? null,
  });

  if (error) {
    const normalized = normalizePostgrestError(error, "face_match_enqueue_failed");
    if (normalized.code === "23505") {
      const recovered = await recoverDuplicateEnqueueRace(supabase, input);
      if (recovered) {
        return recovered;
      }
    }

    throw new HttpError(500, "face_match_enqueue_failed", "Unable to enqueue face-match job.");
  }

  const row = (data?.[0] ?? null) as EnqueueResultRow | null;
  if (!row) {
    throw new HttpError(500, "face_match_enqueue_failed", "Unable to enqueue face-match job.");
  }

  await attachWorkspaceScopeToJob(
    supabase,
    input.tenantId,
    input.projectId,
    row.job_id,
    input.workspaceId,
  );

  return {
    jobId: row.job_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    enqueued: row.enqueued,
  };
}

export async function requeueFaceMatchJob(
  input: RequeueFaceMatchJobInput,
): Promise<RepairFaceMatchJobResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("requeue_face_match_job", {
    p_tenant_id: normalizeUuid(input.tenantId),
    p_project_id: normalizeUuid(input.projectId),
    p_workspace_id: input.workspaceId ? normalizeUuid(input.workspaceId) : null,
    p_job_type: input.jobType,
    p_dedupe_key: String(input.dedupeKey).trim(),
    p_scope_asset_id: input.scopeAssetId ? normalizeUuid(input.scopeAssetId) : null,
    p_scope_consent_id: input.scopeConsentId ? normalizeUuid(input.scopeConsentId) : null,
    p_payload: input.payload ?? {},
    p_max_attempts: input.maxAttempts ?? 5,
    p_run_after: input.runAfter ?? null,
    p_requeue_reason: String(input.requeueReason).trim(),
  });

  if (error) {
    const normalized = normalizePostgrestError(error, "face_match_requeue_failed");
    if (normalized.code === "23505") {
      const recovered = await recoverDuplicateRequeueRace(supabase, input);
      if (recovered) {
        return recovered;
      }
    }

    throw new HttpError(500, "face_match_requeue_failed", `Unable to requeue face-match job: ${normalized.code}`);
  }

  const row = (data?.[0] ?? null) as RequeueResultRow | null;
  if (!row) {
    throw new HttpError(500, "face_match_requeue_failed", "Unable to requeue face-match job.");
  }

  await attachWorkspaceScopeToJob(
    supabase,
    input.tenantId,
    input.projectId,
    row.job_id,
    input.workspaceId,
  );

  return {
    jobId: row.job_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    enqueued: row.enqueued,
    requeued: row.requeued,
    alreadyProcessing: row.already_processing,
    alreadyQueued: row.already_queued,
  };
}

type EnqueuePhotoUploadedInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetId: string;
  payload?: Record<string, unknown> | null;
  mode?: FaceMatchJobDispatchMode;
  requeueReason?: string | null;
  supabase?: SupabaseClient;
};

export async function enqueuePhotoUploadedJob(input: EnqueuePhotoUploadedInput) {
  const dedupeKey = buildPhotoUploadedDedupeKey(input.assetId);
  const request = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId ?? null,
    jobType: "photo_uploaded",
    dedupeKey,
    scopeAssetId: input.assetId,
    payload: input.payload ?? null,
    supabase: input.supabase,
  };

  if (input.mode === "repair_requeue") {
    return requeueFaceMatchJob({
      ...request,
      requeueReason: String(input.requeueReason ?? "repair:photo_uploaded"),
    });
  }

  return enqueueFaceMatchJob(request);
}

type EnqueueConsentHeadshotReadyInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  consentId: string;
  headshotAssetId?: string | null;
  payload?: Record<string, unknown> | null;
  mode?: FaceMatchJobDispatchMode;
  requeueReason?: string | null;
  supabase?: SupabaseClient;
};

export async function enqueueConsentHeadshotReadyJob(input: EnqueueConsentHeadshotReadyInput) {
  const dedupeKey = buildConsentHeadshotReadyDedupeKey(input.consentId, input.headshotAssetId ?? null);
  const request = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId ?? null,
    jobType: "consent_headshot_ready",
    dedupeKey,
    scopeConsentId: input.consentId,
    payload: {
      headshotAssetId: input.headshotAssetId ?? null,
      ...(input.payload ?? {}),
    },
    supabase: input.supabase,
  };

  if (input.mode === "repair_requeue") {
    return requeueFaceMatchJob({
      ...request,
      requeueReason: String(input.requeueReason ?? "repair:consent_headshot_ready"),
    });
  }

  return enqueueFaceMatchJob(request);
}

type EnqueueReconcileProjectInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  windowKey: string;
  payload?: Record<string, unknown> | null;
  mode?: FaceMatchJobDispatchMode;
  requeueReason?: string | null;
  supabase?: SupabaseClient;
};

export async function enqueueReconcileProjectJob(input: EnqueueReconcileProjectInput) {
  const dedupeKey = buildReconcileProjectDedupeKey(input.projectId, input.windowKey);
  const request = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId ?? null,
    jobType: "reconcile_project",
    dedupeKey,
    payload: input.payload ?? null,
    supabase: input.supabase,
  };

  if (input.mode === "repair_requeue") {
    return requeueFaceMatchJob({
      ...request,
      requeueReason: String(input.requeueReason ?? "repair:reconcile_project"),
    });
  }

  return enqueueFaceMatchJob(request);
}

type EnqueueMaterializeAssetFacesInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetId: string;
  materializerVersion: string;
  payload?: Record<string, unknown> | null;
  mode?: FaceMatchJobDispatchMode;
  requeueReason?: string | null;
  supabase?: SupabaseClient;
};

export async function enqueueMaterializeAssetFacesJob(input: EnqueueMaterializeAssetFacesInput) {
  const dedupeKey = buildMaterializeAssetFacesDedupeKey(input.assetId, input.materializerVersion);
  const request = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId ?? null,
    jobType: "materialize_asset_faces",
    dedupeKey,
    scopeAssetId: input.assetId,
    payload: {
      materializerVersion: input.materializerVersion,
      ...(input.payload ?? {}),
    },
    supabase: input.supabase,
  };

  if (input.mode === "repair_requeue") {
    return requeueFaceMatchJob({
      ...request,
      requeueReason: String(input.requeueReason ?? "repair:materialize_asset_faces"),
    });
  }

  return enqueueFaceMatchJob(request);
}

type EnqueueCompareMaterializedPairInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  consentId: string;
  assetId: string;
  headshotMaterializationId: string;
  assetMaterializationId: string;
  compareVersion: string;
  payload?: Record<string, unknown> | null;
  mode?: FaceMatchJobDispatchMode;
  requeueReason?: string | null;
  supabase?: SupabaseClient;
};

export async function enqueueCompareMaterializedPairJob(input: EnqueueCompareMaterializedPairInput) {
  const dedupeKey = buildCompareMaterializedPairDedupeKey(
    input.consentId,
    input.assetId,
    input.headshotMaterializationId,
    input.assetMaterializationId,
    input.compareVersion,
  );

  const request = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId ?? null,
    jobType: "compare_materialized_pair",
    dedupeKey,
    scopeAssetId: input.assetId,
    scopeConsentId: input.consentId,
    payload: {
      headshotMaterializationId: input.headshotMaterializationId,
      assetMaterializationId: input.assetMaterializationId,
      compareVersion: input.compareVersion,
      ...(input.payload ?? {}),
    },
    supabase: input.supabase,
  };

  if (input.mode === "repair_requeue") {
    return requeueFaceMatchJob({
      ...request,
      requeueReason: String(input.requeueReason ?? "repair:compare_materialized_pair"),
    });
  }

  return enqueueFaceMatchJob(request);
}

type EnqueueCompareRecurringProfileMaterializedPairInput = {
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  projectProfileParticipantId: string;
  profileId: string;
  recurringHeadshotId: string;
  recurringHeadshotMaterializationId: string;
  recurringSelectionFaceId: string;
  assetId: string;
  assetMaterializationId: string;
  compareVersion: string;
  payload?: Record<string, unknown> | null;
  mode?: FaceMatchJobDispatchMode;
  requeueReason?: string | null;
  supabase?: SupabaseClient;
};

export async function enqueueCompareRecurringProfileMaterializedPairJob(
  input: EnqueueCompareRecurringProfileMaterializedPairInput,
) {
  const dedupeKey = buildCompareRecurringProfileMaterializedPairDedupeKey(
    input.projectProfileParticipantId,
    input.assetId,
    input.recurringSelectionFaceId,
    input.assetMaterializationId,
    input.compareVersion,
  );

  const request = {
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId ?? null,
    jobType: "compare_recurring_profile_materialized_pair" as const,
    dedupeKey,
    scopeAssetId: input.assetId,
    payload: {
      projectProfileParticipantId: input.projectProfileParticipantId,
      profileId: input.profileId,
      recurringHeadshotId: input.recurringHeadshotId,
      recurringHeadshotMaterializationId: input.recurringHeadshotMaterializationId,
      recurringSelectionFaceId: input.recurringSelectionFaceId,
      assetMaterializationId: input.assetMaterializationId,
      compareVersion: input.compareVersion,
      ...(input.payload ?? {}),
    },
    supabase: input.supabase,
  };

  if (input.mode === "repair_requeue") {
    return requeueFaceMatchJob({
      ...request,
      requeueReason: String(
        input.requeueReason ?? "repair:compare_recurring_profile_materialized_pair",
      ),
    });
  }

  return enqueueFaceMatchJob(request);
}
