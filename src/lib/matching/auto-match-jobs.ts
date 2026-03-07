import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

export const FACE_MATCH_JOB_TYPES = [
  "photo_uploaded",
  "consent_headshot_ready",
  "reconcile_project",
] as const;

export type FaceMatchJobType = (typeof FACE_MATCH_JOB_TYPES)[number];

type EnqueueFaceMatchJobInput = {
  tenantId: string;
  projectId: string;
  jobType: FaceMatchJobType;
  dedupeKey: string;
  scopeAssetId?: string | null;
  scopeConsentId?: string | null;
  payload?: Record<string, unknown> | null;
  maxAttempts?: number;
  runAfter?: string | null;
  supabase?: SupabaseClient;
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

export function buildPhotoUploadedDedupeKey(assetId: string) {
  return `photo_uploaded:${normalizeDedupeSegment(assetId)}`;
}

export function buildConsentHeadshotReadyDedupeKey(consentId: string, headshotAssetId?: string | null) {
  return `consent_headshot_ready:${normalizeDedupeSegment(consentId)}:${normalizeDedupeSegment(headshotAssetId)}`;
}

export function buildReconcileProjectDedupeKey(projectId: string, windowKey: string) {
  return `reconcile_project:${normalizeDedupeSegment(projectId)}:${normalizeDedupeSegment(windowKey)}`;
}

export async function enqueueFaceMatchJob(
  input: EnqueueFaceMatchJobInput,
): Promise<EnqueueFaceMatchJobResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("enqueue_face_match_job", {
    p_tenant_id: normalizeUuid(input.tenantId),
    p_project_id: normalizeUuid(input.projectId),
    p_job_type: input.jobType,
    p_dedupe_key: String(input.dedupeKey).trim(),
    p_scope_asset_id: input.scopeAssetId ? normalizeUuid(input.scopeAssetId) : null,
    p_scope_consent_id: input.scopeConsentId ? normalizeUuid(input.scopeConsentId) : null,
    p_payload: input.payload ?? {},
    p_max_attempts: input.maxAttempts ?? 5,
    p_run_after: input.runAfter ?? null,
  });

  if (error) {
    throw new HttpError(500, "face_match_enqueue_failed", "Unable to enqueue face-match job.");
  }

  const row = (data?.[0] ?? null) as EnqueueResultRow | null;
  if (!row) {
    throw new HttpError(500, "face_match_enqueue_failed", "Unable to enqueue face-match job.");
  }

  return {
    jobId: row.job_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    enqueued: row.enqueued,
  };
}

type EnqueuePhotoUploadedInput = {
  tenantId: string;
  projectId: string;
  assetId: string;
  payload?: Record<string, unknown> | null;
  supabase?: SupabaseClient;
};

export async function enqueuePhotoUploadedJob(input: EnqueuePhotoUploadedInput) {
  const dedupeKey = buildPhotoUploadedDedupeKey(input.assetId);
  return enqueueFaceMatchJob({
    tenantId: input.tenantId,
    projectId: input.projectId,
    jobType: "photo_uploaded",
    dedupeKey,
    scopeAssetId: input.assetId,
    payload: input.payload ?? null,
    supabase: input.supabase,
  });
}

type EnqueueConsentHeadshotReadyInput = {
  tenantId: string;
  projectId: string;
  consentId: string;
  headshotAssetId?: string | null;
  payload?: Record<string, unknown> | null;
  supabase?: SupabaseClient;
};

export async function enqueueConsentHeadshotReadyJob(input: EnqueueConsentHeadshotReadyInput) {
  const dedupeKey = buildConsentHeadshotReadyDedupeKey(input.consentId, input.headshotAssetId ?? null);
  return enqueueFaceMatchJob({
    tenantId: input.tenantId,
    projectId: input.projectId,
    jobType: "consent_headshot_ready",
    dedupeKey,
    scopeConsentId: input.consentId,
    payload: input.payload ?? null,
    supabase: input.supabase,
  });
}

type EnqueueReconcileProjectInput = {
  tenantId: string;
  projectId: string;
  windowKey: string;
  payload?: Record<string, unknown> | null;
  supabase?: SupabaseClient;
};

export async function enqueueReconcileProjectJob(input: EnqueueReconcileProjectInput) {
  const dedupeKey = buildReconcileProjectDedupeKey(input.projectId, input.windowKey);
  return enqueueFaceMatchJob({
    tenantId: input.tenantId,
    projectId: input.projectId,
    jobType: "reconcile_project",
    dedupeKey,
    payload: input.payload ?? null,
    supabase: input.supabase,
  });
}
