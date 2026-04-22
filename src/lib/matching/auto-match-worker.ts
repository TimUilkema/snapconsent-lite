import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";
import {
  getAutoMatchCompareVersion,
  getAutoMatchConfidenceThreshold,
  getAutoMatchJobLeaseSeconds,
  getAutoMatchMaterializerVersion,
  getAutoMatchMaxComparisonsPerJob,
  getAutoMatchPipelineMode,
  getAutoMatchPersistFaceEvidence,
  getAutoMatchPersistResults,
  getAutoMatchResultsMaxPerJob,
  getAutoMatchReviewMinConfidence,
  getAutoMatchWorkerConcurrency,
} from "@/lib/matching/auto-match-config";
import {
  enqueueMaterializeAssetFacesJob,
  type FaceMatchJobType,
} from "@/lib/matching/auto-match-jobs";
import {
  claimFaceMatchFanoutContinuations,
  completeFaceMatchFanoutContinuationBatch,
  createOrResetFanoutContinuationsForMaterializedAsset,
  enqueueFaceMatchFanoutContinuation,
  failFaceMatchFanoutContinuation,
  getPhotoFanoutBoundary,
  loadConsentEligibility,
  processClaimedFanoutContinuation,
  supersedeRecurringProfileFanoutContinuations,
  type ClaimedFanoutContinuationRow,
} from "@/lib/matching/auto-match-fanout-continuations";
import { resolveAutoEligibleProjectRecurringSource } from "@/lib/matching/project-recurring-sources";
import {
  ensureAssetFaceMaterialization,
  loadConsentHeadshotMaterialization,
  loadCurrentProjectConsentHeadshots,
  loadCurrentAssetFaceMaterialization,
  shouldForceRematerializeCurrentMaterialization,
  type AssetFaceMaterializationFaceRow,
  type AssetFaceMaterializationRow,
} from "@/lib/matching/face-materialization";
import { ensureMaterializedFaceCompare } from "@/lib/matching/materialized-face-compare";
import { ensureRecurringProfileMaterializedFaceCompare } from "@/lib/matching/recurring-materialized-face-compare";
import { reconcilePhotoFaceCanonicalStateForAsset } from "@/lib/matching/consent-photo-matching";
import {
  getAutoMatcher,
  type AutoMatcher,
  type AutoMatcherCandidate,
  type AutoMatcherFaceBox,
  type AutoMatcherMatch,
  type AutoMatcherProviderMetadata,
} from "@/lib/matching/auto-matcher";
import { MatcherProviderError } from "@/lib/matching/provider-errors";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

type ClaimedFaceMatchJobRow = {
  job_id: string;
  tenant_id: string;
  project_id: string;
  scope_asset_id: string | null;
  scope_consent_id: string | null;
  job_type: FaceMatchJobType;
  dedupe_key: string;
  payload: Record<string, unknown> | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  lock_token: string | null;
  lease_expires_at: string | null;
  reclaimed: boolean;
  started_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

type CompleteFaceMatchJobRow = {
  job_id: string;
  status: string | null;
  completed_at: string | null;
  updated_at: string;
  outcome: "completed" | "lost_lease" | "missing" | "not_processing";
};

type FailFaceMatchJobRow = {
  job_id: string;
  status: string | null;
  attempt_count: number | null;
  max_attempts: number | null;
  run_after: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  updated_at: string;
  outcome: "retried" | "dead" | "lost_lease" | "missing" | "not_processing";
};

type RunAutoMatchWorkerInput = {
  workerId: string;
  batchSize?: number;
  confidenceThreshold?: number;
  reviewMinConfidence?: number;
  persistResults?: boolean;
  persistFaceEvidence?: boolean;
  resultsMaxPerJob?: number | null;
  maxComparisonsPerJob?: number | null;
  matcher?: AutoMatcher;
  supabase?: SupabaseClient;
};

export type RunAutoMatchWorkerResult = {
  claimed: number;
  workerConcurrency: number;
  succeeded: number;
  retried: number;
  dead: number;
  skippedIneligible: number;
  scoredPairs: number;
  candidatePairs: number;
};

type EligibleConsentWithHeadshot = {
  consentId: string;
  headshotAssetId: string;
  headshotStorageBucket: string;
  headshotStoragePath: string;
};

type ResolveJobCandidatesResult = {
  eligible: boolean;
  candidates: AutoMatcherCandidate[];
};

type ProcessClaimedFaceMatchJobResult = {
  skippedIneligible: boolean;
  scoredPairs: number;
  candidatePairs: number;
  lostLease?: boolean;
};

type ExecuteClaimedFaceMatchJobResult = {
  outcome: "succeeded" | "skipped_ineligible" | "retried" | "dead" | "lost_lease";
  scoredPairs: number;
  candidatePairs: number;
};

type MaterializeAssetFacesPayload = {
  materializerVersion: string;
  repairRequested: boolean;
};

type CompareMaterializedPairPayload = {
  headshotMaterializationId: string;
  assetMaterializationId: string;
  compareVersion: string;
};

type CompareRecurringProfileMaterializedPairPayload = {
  projectProfileParticipantId: string;
  profileId: string;
  recurringHeadshotId: string;
  recurringHeadshotMaterializationId: string;
  recurringSelectionFaceId: string;
  assetMaterializationId: string;
  compareVersion: string;
};

type ReconcileProjectPayload = {
  replayKind: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  reason: string | null;
};

const MAX_BATCH_SIZE = 200;
const MAX_MATCH_CANDIDATES = 750;
const MIN_MATCH_CANDIDATES = 1;
const MAX_RESULTS_PER_JOB = 5_000;

type MatchResultDecision =
  | "auto_link_upserted"
  | "candidate_upserted"
  | "below_review_band"
  | "skipped_manual"
  | "skipped_suppressed";

function isDevelopmentLoggingEnabled() {
  return process.env.NODE_ENV !== "production";
}

function logWorkerDevelopment(event: string, fields: Record<string, unknown>) {
  if (!isDevelopmentLoggingEnabled()) {
    return;
  }

  console.info(`[matching][worker] ${event}`, fields);
}

function logWorkerOperational(event: string, fields: Record<string, unknown>) {
  console.info(`[matching][worker] ${event}`, fields);
}

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

function toSafeErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "message" in error) {
    return normalizePostgrestError(error, "face_match_worker_error").message;
  }

  if (error instanceof HttpError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown worker error.";
}

function toSafeErrorCode(error: unknown) {
  if (error && typeof error === "object" && ("code" in error || "message" in error)) {
    return normalizePostgrestError(error, "face_match_worker_error").code;
  }

  if (error instanceof MatcherProviderError) {
    return error.code;
  }

  if (error instanceof HttpError) {
    return error.code;
  }

  return "face_match_worker_error";
}

function isRetryableError(error: unknown) {
  if (error instanceof MatcherProviderError) {
    return error.retryable;
  }

  if (error instanceof HttpError) {
    return error.status >= 500;
  }

  return true;
}

function toContinuationSafeErrorMessage(error: unknown) {
  return toSafeErrorMessage(error);
}

function toContinuationSafeErrorCode(error: unknown) {
  return toSafeErrorCode(error);
}

function isRetryableContinuationError(error: unknown) {
  if (error instanceof MatcherProviderError) {
    return error.retryable;
  }

  if (error instanceof HttpError) {
    return error.status >= 500;
  }

  return isRetryableError(error);
}

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return 25;
  }

  const parsed = Math.floor(value ?? 25);
  if (parsed <= 0) {
    return 25;
  }

  return Math.min(parsed, MAX_BATCH_SIZE);
}

function normalizeThreshold(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return getAutoMatchConfidenceThreshold();
  }

  return Math.max(0, Math.min(1, Number(value)));
}

function normalizeReviewMinConfidence(value: number | undefined, confidenceThreshold: number) {
  const normalized =
    Number.isFinite(value) ? Math.max(0, Math.min(1, Number(value))) : getAutoMatchReviewMinConfidence();
  return Math.min(normalized, confidenceThreshold);
}

function normalizeMaxComparisons(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    const configured = getAutoMatchMaxComparisonsPerJob();
    if (!Number.isFinite(configured)) {
      return MAX_MATCH_CANDIDATES;
    }
    return Math.max(MIN_MATCH_CANDIDATES, Math.min(MAX_MATCH_CANDIDATES, Number(configured)));
  }

  const parsed = Math.floor(Number(value));
  if (parsed <= 0) {
    return MIN_MATCH_CANDIDATES;
  }

  return Math.min(parsed, MAX_MATCH_CANDIDATES);
}

function normalizePersistResults(value: boolean | undefined) {
  if (typeof value === "boolean") {
    return value;
  }

  return getAutoMatchPersistResults();
}

function normalizePersistFaceEvidence(value: boolean | undefined) {
  if (typeof value === "boolean") {
    return value;
  }

  return getAutoMatchPersistFaceEvidence();
}

function normalizeResultsMaxPerJob(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    const configured = getAutoMatchResultsMaxPerJob();
    if (!Number.isFinite(configured)) {
      return null;
    }
    return Math.min(MAX_RESULTS_PER_JOB, Math.floor(Number(configured)));
  }

  const normalized = Math.floor(Number(value));
  if (normalized <= 0) {
    return null;
  }

  return Math.min(normalized, MAX_RESULTS_PER_JOB);
}

function normalizeVersionToken(value: unknown, fallback: string) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function parseBooleanFlag(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return ["1", "true", "yes", "on"].includes(normalized);
}

function parseMaterializeAssetFacesPayload(payload: Record<string, unknown> | null | undefined): MaterializeAssetFacesPayload {
  return {
    materializerVersion: normalizeVersionToken(payload?.materializerVersion, getAutoMatchMaterializerVersion()),
    repairRequested: parseBooleanFlag(payload?.repairRequested),
  };
}

function parseCompareMaterializedPairPayload(payload: Record<string, unknown> | null | undefined): CompareMaterializedPairPayload {
  const headshotMaterializationId = String(payload?.headshotMaterializationId ?? "").trim();
  const assetMaterializationId = String(payload?.assetMaterializationId ?? "").trim();
  const compareVersion = normalizeVersionToken(payload?.compareVersion, getAutoMatchCompareVersion());

  if (!headshotMaterializationId || !assetMaterializationId) {
    throw new HttpError(
      400,
      "face_match_invalid_payload",
      "Compare materialized pair jobs require headshot and asset materialization ids.",
    );
  }

  return {
    headshotMaterializationId,
    assetMaterializationId,
    compareVersion,
  };
}

function parseCompareRecurringProfileMaterializedPairPayload(
  payload: Record<string, unknown> | null | undefined,
): CompareRecurringProfileMaterializedPairPayload {
  const projectProfileParticipantId = String(payload?.projectProfileParticipantId ?? "").trim();
  const profileId = String(payload?.profileId ?? "").trim();
  const recurringHeadshotId = String(payload?.recurringHeadshotId ?? "").trim();
  const recurringHeadshotMaterializationId = String(payload?.recurringHeadshotMaterializationId ?? "").trim();
  const recurringSelectionFaceId = String(payload?.recurringSelectionFaceId ?? "").trim();
  const assetMaterializationId = String(payload?.assetMaterializationId ?? "").trim();
  const compareVersion = normalizeVersionToken(payload?.compareVersion, getAutoMatchCompareVersion());

  if (
    !projectProfileParticipantId
    || !profileId
    || !recurringHeadshotId
    || !recurringHeadshotMaterializationId
    || !recurringSelectionFaceId
    || !assetMaterializationId
  ) {
    throw new HttpError(
      400,
      "face_match_invalid_payload",
      "Recurring compare jobs require participant, source, selection, and asset materialization ids.",
    );
  }

  return {
    projectProfileParticipantId,
    profileId,
    recurringHeadshotId,
    recurringHeadshotMaterializationId,
    recurringSelectionFaceId,
    assetMaterializationId,
    compareVersion,
  };
}

function parseReconcileProjectPayload(payload: Record<string, unknown> | null | undefined): ReconcileProjectPayload {
  const replayKind = String(payload?.replayKind ?? "").trim();
  const projectProfileParticipantId = String(payload?.projectProfileParticipantId ?? "").trim();
  const profileId = String(payload?.profileId ?? "").trim();
  const reason = String(payload?.reason ?? "").trim();

  return {
    replayKind: replayKind.length > 0 ? replayKind : null,
    projectProfileParticipantId: projectProfileParticipantId.length > 0 ? projectProfileParticipantId : null,
    profileId: profileId.length > 0 ? profileId : null,
    reason: reason.length > 0 ? reason : null,
  };
}

function parseMaterializedFaceBox(faceBox: Record<string, unknown>): AutoMatcherFaceBox | null {
  const xMin = Number(faceBox.x_min);
  const yMin = Number(faceBox.y_min);
  const xMax = Number(faceBox.x_max);
  const yMax = Number(faceBox.y_max);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin) || !Number.isFinite(xMax) || !Number.isFinite(yMax)) {
    return null;
  }

  const probability = Number(faceBox.probability);
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    probability: Number.isFinite(probability) ? probability : null,
  };
}

function toAutoMatcherProviderMetadata(
  provider: string,
  providerMode: string,
  providerPluginVersions: Record<string, unknown> | null,
): AutoMatcherProviderMetadata {
  return {
    provider,
    providerMode,
    providerPluginVersions,
  };
}

function buildMaterializedMatchFromCompare(input: {
  assetId: string;
  consentId: string;
  confidence: number;
  providerMetadata: AutoMatcherProviderMetadata;
  headshotFace: AssetFaceMaterializationFaceRow | null;
  winningAssetFace: AssetFaceMaterializationFaceRow | null;
}): AutoMatcherMatch {
  const faces =
    input.headshotFace && input.winningAssetFace
      ? [
          {
            similarity: input.confidence,
            sourceFaceBox: parseMaterializedFaceBox(input.headshotFace.face_box),
            targetFaceBox: parseMaterializedFaceBox(input.winningAssetFace.face_box),
            sourceEmbedding: input.headshotFace.embedding,
            targetEmbedding: input.winningAssetFace.embedding,
            providerFaceIndex: input.winningAssetFace.provider_face_index,
          },
        ]
      : undefined;

  return {
    assetId: input.assetId,
    consentId: input.consentId,
    confidence: input.confidence,
    faces,
    providerMetadata: input.providerMetadata,
  };
}

function normalizeWorkerConcurrency(claimedJobCount: number) {
  if (claimedJobCount <= 0) {
    return 0;
  }

  return Math.min(getAutoMatchWorkerConcurrency(), claimedJobCount);
}

async function mapWithConcurrency<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  handler: (item: TInput, index: number) => Promise<TOutput>,
) {
  if (inputs.length === 0) {
    return [] as TOutput[];
  }

  const normalizedConcurrency = Math.max(1, Math.min(concurrency, inputs.length));
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= inputs.length) {
        return;
      }

      results[current] = await handler(inputs[current], current);
    }
  }

  await Promise.all(Array.from({ length: normalizedConcurrency }, () => runWorker()));
  return results;
}

async function claimFaceMatchJobs(
  supabase: SupabaseClient,
  workerId: string,
  batchSize: number,
): Promise<ClaimedFaceMatchJobRow[]> {
  const { data, error } = await supabase.rpc("claim_face_match_jobs", {
    p_locked_by: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: getAutoMatchJobLeaseSeconds(),
  });

  if (error) {
    throw new HttpError(500, "face_match_claim_failed", "Unable to claim face-match jobs.");
  }

  return (data as ClaimedFaceMatchJobRow[] | null) ?? [];
}

async function completeFaceMatchJob(supabase: SupabaseClient, jobId: string, lockToken: string | null) {
  if (!lockToken) {
    throw new HttpError(409, "face_match_complete_conflict", "Face-match job lock token is missing.");
  }

  const { data, error } = await supabase.rpc("complete_face_match_job", {
    p_job_id: jobId,
    p_lock_token: lockToken,
  });

  if (error) {
    throw new HttpError(500, "face_match_complete_failed", "Unable to complete face-match job.");
  }

  const row = (data?.[0] ?? null) as CompleteFaceMatchJobRow | null;
  if (!row) {
    throw new HttpError(409, "face_match_complete_conflict", "Face-match job completion returned no row.");
  }

  return row;
}

async function failFaceMatchJob(
  supabase: SupabaseClient,
  jobId: string,
  lockToken: string | null,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
) {
  if (!lockToken) {
    throw new HttpError(409, "face_match_fail_conflict", "Face-match job lock token is missing.");
  }

  const { data, error } = await supabase.rpc("fail_face_match_job", {
    p_job_id: jobId,
    p_lock_token: lockToken,
    p_error_code: errorCode,
    p_error_message: errorMessage,
    p_retryable: retryable,
    p_retry_delay_seconds: null,
  });

  if (error) {
    throw new HttpError(500, "face_match_fail_failed", "Unable to update failed face-match job.");
  }

  const row = (data?.[0] ?? null) as FailFaceMatchJobRow | null;
  if (!row) {
    throw new HttpError(409, "face_match_fail_conflict", "Face-match job failure update returned no row.");
  }

  return row;
}

async function loadEligibleConsentIdsWithHeadshots(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<EligibleConsentWithHeadshot[]> {
  const currentHeadshots = await loadCurrentProjectConsentHeadshots(supabase, tenantId, projectId, {
    optInOnly: true,
    notRevokedOnly: true,
    limit: MAX_MATCH_CANDIDATES,
  });
  if (currentHeadshots.length === 0) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const headshotRows = await runChunkedRead(
    currentHeadshots.map((row) => row.headshotAssetId),
    async (headshotIdChunk) => {
      // safe-in-filter: worker headshot storage lookup is bounded and chunked by shared helper.
      const { data, error } = await supabase
        .from("assets")
        .select("id, storage_bucket, storage_path")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("asset_type", "headshot")
        .eq("status", "uploaded")
        .is("archived_at", null)
        .or(`retention_expires_at.is.null,retention_expires_at.gt.${nowIso}`)
        // safe-in-filter: headshot validation is batch-bounded and chunked by shared helper.
        .in("id", headshotIdChunk);

      if (error) {
        throw new HttpError(500, "face_match_headshot_lookup_failed", "Unable to validate consent headshots.");
      }

      return (data ?? []) as Array<{
        id: string;
        storage_bucket: string | null;
        storage_path: string | null;
      }>;
    },
  );

  const headshotById = new Map(
    headshotRows.map((headshot) => [
      headshot.id,
      {
        storageBucket: headshot.storage_bucket,
        storagePath: headshot.storage_path,
      },
    ]),
  );

  return currentHeadshots.flatMap((row) => {
    const headshot = headshotById.get(row.headshotAssetId);
    if (!headshot?.storageBucket || !headshot.storagePath) {
      return [];
    }

    return [{
      consentId: row.consentId,
      headshotAssetId: row.headshotAssetId,
      headshotStorageBucket: headshot.storageBucket,
      headshotStoragePath: headshot.storagePath,
    }];
  });
}

async function loadEligibleHeadshotForConsent(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
  ) {
    const { data: consent, error: consentError } = await supabase
      .from("consents")
      .select("id, face_match_opt_in, revoked_at, superseded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("id", consentId)
      .maybeSingle();

  if (consentError) {
    throw new HttpError(500, "face_match_consent_lookup_failed", "Unable to load consent.");
  }

  if (!consent || !consent.face_match_opt_in || consent.revoked_at || consent.superseded_at) {
    return null;
  }

  const eligibleConsents = await loadEligibleConsentIdsWithHeadshots(supabase, tenantId, projectId);
  return eligibleConsents.find((row) => row.consentId === consentId) ?? null;
}

async function loadEligiblePhotoAsset(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
) {
  const { data: asset, error } = await supabase
    .from("assets")
    .select("id, storage_bucket, storage_path")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", assetId)
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_match_asset_lookup_failed", "Unable to load photo asset.");
  }

  if (!asset?.storage_bucket || !asset.storage_path) {
    return null;
  }

  return {
    id: asset.id,
    storageBucket: asset.storage_bucket,
    storagePath: asset.storage_path,
  };
}

async function loadEligibleProjectPhotoIds(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const { data: photos, error } = await supabase
    .from("assets")
    .select("id, storage_bucket, storage_path")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .limit(MAX_MATCH_CANDIDATES);

  if (error) {
    throw new HttpError(500, "face_match_asset_lookup_failed", "Unable to load project photo candidates.");
  }

  return (photos ?? [])
    .filter((photo) => photo.storage_bucket && photo.storage_path)
    .map((photo) => ({
      id: photo.id,
      storageBucket: photo.storage_bucket as string,
      storagePath: photo.storage_path as string,
    }));
}

function normalizeAutoMatcherMatches(matches: AutoMatcherMatch[]) {
  const byPair = new Map<string, AutoMatcherMatch>();

  matches.forEach((match) => {
    const assetId = String(match.assetId ?? "").trim();
    const consentId = String(match.consentId ?? "").trim();
    const confidence = Number(match.confidence);

    if (!assetId || !consentId || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return;
    }

    byPair.set(`${assetId}:${consentId}`, {
      assetId,
      consentId,
      confidence,
      faces: Array.isArray(match.faces) ? match.faces : undefined,
      providerMetadata: match.providerMetadata,
    });
  });

  return Array.from(byPair.values());
}

function normalizeFaceBoxForPersistence(faceBox: AutoMatcherFaceBox | null | undefined) {
  if (!faceBox) {
    return null;
  }

  const xMin = Number((faceBox as { xMin?: number }).xMin);
  const yMin = Number((faceBox as { yMin?: number }).yMin);
  const xMax = Number((faceBox as { xMax?: number }).xMax);
  const yMax = Number((faceBox as { yMax?: number }).yMax);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin) || !Number.isFinite(xMax) || !Number.isFinite(yMax)) {
    return null;
  }

  if (xMax < xMin || yMax < yMin) {
    return null;
  }

  const probability = Number((faceBox as { probability?: number | null }).probability);
  const payload: Record<string, number> = {
    x_min: xMin,
    y_min: yMin,
    x_max: xMax,
    y_max: yMax,
  };
  if (Number.isFinite(probability)) {
    payload.probability = Math.max(0, Math.min(1, probability));
  }

  return payload;
}

function normalizeEmbeddingForPersistence(embedding: number[] | null | undefined) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }

  const normalized = embedding
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (normalized.length !== embedding.length) {
    return null;
  }

  return normalized;
}

type NormalizedFaceEvidence = {
  similarity: number;
  sourceFaceBox: Record<string, number> | null;
  targetFaceBox: Record<string, number> | null;
  sourceEmbedding: number[] | null;
  targetEmbedding: number[] | null;
  providerFaceIndex: number | null;
};

function normalizeFaceEvidenceForPersistence(match: AutoMatcherMatch): NormalizedFaceEvidence[] {
  if (!Array.isArray(match.faces) || match.faces.length === 0) {
    return [];
  }

  const normalized = match.faces.map((face) => {
    const parsedSimilarity = Number(face.similarity);
    const similarity =
      Number.isFinite(parsedSimilarity) && parsedSimilarity >= 0 && parsedSimilarity <= 1
        ? parsedSimilarity
        : match.confidence;

    const parsedProviderFaceIndex = Number(face.providerFaceIndex);
    const providerFaceIndex =
      Number.isFinite(parsedProviderFaceIndex) && parsedProviderFaceIndex >= 0
        ? Math.floor(parsedProviderFaceIndex)
        : null;

    return {
      similarity,
      sourceFaceBox: normalizeFaceBoxForPersistence(face.sourceFaceBox),
      targetFaceBox: normalizeFaceBoxForPersistence(face.targetFaceBox),
      sourceEmbedding: normalizeEmbeddingForPersistence(face.sourceEmbedding),
      targetEmbedding: normalizeEmbeddingForPersistence(face.targetEmbedding),
      providerFaceIndex,
    } satisfies NormalizedFaceEvidence;
  });

  return normalized.sort((left, right) => {
    if (right.similarity !== left.similarity) {
      return right.similarity - left.similarity;
    }

    const leftIndex = left.providerFaceIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.providerFaceIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return JSON.stringify(left.targetFaceBox ?? {}).localeCompare(JSON.stringify(right.targetFaceBox ?? {}));
  });
}

function buildPairKey(assetId: string, consentId: string) {
  return `${assetId}:${consentId}`;
}

async function deleteMatchCandidatePair(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  consentId: string,
) {
  const { error } = await supabase
    .from("asset_consent_match_candidates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .eq("consent_id", consentId);

  if (error) {
    throw new HttpError(500, "face_match_candidate_delete_failed", "Unable to remove likely-match candidate.");
  }
}

async function deleteStaleMatchResultFaceRows(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  jobId: string,
  assetId: string,
  consentId: string,
  keepFaceRanks: number[],
) {
  let query = supabase
    .from("asset_consent_match_result_faces")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("job_id", jobId)
    .eq("asset_id", assetId)
    .eq("consent_id", consentId);

  if (keepFaceRanks.length > 0) {
    query = query.not("face_rank", "in", `(${keepFaceRanks.join(",")})`);
  }

  const { error } = await query;
  if (error) {
    throw new HttpError(500, "face_match_result_faces_delete_failed", "Unable to remove stale face-evidence rows.");
  }
}

async function applyAutoMatches(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  jobId: string,
  jobType: FaceMatchJobType,
  candidates: AutoMatcherCandidate[],
  matcherVersion: string,
  confidenceThreshold: number,
  reviewMinConfidence: number,
  persistResults: boolean,
  persistFaceEvidence: boolean,
  resultsMaxPerJob: number | null,
  matches: AutoMatcherMatch[],
) {
  if (candidates.length === 0) {
    return;
  }

  const candidatePairs = new Set(candidates.map((candidate) => buildPairKey(candidate.assetId, candidate.consentId)));
  const scoreByPair = new Map<string, AutoMatcherMatch>();
  normalizeAutoMatcherMatches(matches).forEach((match) => {
    const pairKey = buildPairKey(match.assetId, match.consentId);
    if (!candidatePairs.has(pairKey)) {
      return;
    }

    const existing = scoreByPair.get(pairKey);
    if (!existing || match.confidence > existing.confidence) {
      scoreByPair.set(pairKey, match);
    }
  });

  const nowIso = new Date().toISOString();
  const normalizedScores = Array.from(scoreByPair.values());
  const aboveThresholdPairs = Array.from(scoreByPair.values()).filter(
    (match) => match.confidence >= confidenceThreshold,
  ).length;

  const candidateRows = normalizedScores
    .filter((match) => match.confidence >= reviewMinConfidence && match.confidence < confidenceThreshold)
    .map((match) => ({
      tenant_id: tenantId,
      project_id: projectId,
      asset_id: match.assetId,
      consent_id: match.consentId,
      confidence: match.confidence,
      matcher_version: matcherVersion,
      source_job_type: jobType,
      last_scored_at: nowIso,
      updated_at: nowIso,
    }));

  if (candidateRows.length > 0) {
    const { error: candidateUpsertError } = await supabase.from("asset_consent_match_candidates").upsert(candidateRows, {
      onConflict: "asset_id,consent_id",
    });

    if (candidateUpsertError) {
      throw new HttpError(500, "face_match_candidate_upsert_failed", "Unable to upsert likely-match candidates.");
    }
  }

  const candidateDeletePairKeys = new Set<string>();
  normalizedScores
    .filter((match) => match.confidence < reviewMinConfidence || match.confidence >= confidenceThreshold)
    .forEach((match) => {
      candidateDeletePairKeys.add(buildPairKey(match.assetId, match.consentId));
    });

  const resultRows = normalizedScores
    .map((match) => {
      let decision: MatchResultDecision = "below_review_band";
      if (match.confidence >= confidenceThreshold) {
        decision = "auto_link_upserted";
      } else if (match.confidence >= reviewMinConfidence) {
        decision = "candidate_upserted";
      }

      return {
        tenant_id: tenantId,
        project_id: projectId,
        asset_id: match.assetId,
        consent_id: match.consentId,
        job_id: jobId,
        job_type: jobType,
        confidence: match.confidence,
        decision,
        matcher_version: matcherVersion,
        auto_threshold: confidenceThreshold,
        review_min_confidence: reviewMinConfidence,
        scored_at: nowIso,
      };
    })
    .sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }
      const assetSort = left.asset_id.localeCompare(right.asset_id);
      if (assetSort !== 0) {
        return assetSort;
      }
      return left.consent_id.localeCompare(right.consent_id);
    });

  const boundedResultRows =
    typeof resultsMaxPerJob === "number" ? resultRows.slice(0, resultsMaxPerJob) : resultRows;

  let persistedResultsCount = 0;
  if (persistResults && boundedResultRows.length > 0) {
    const { error: resultsUpsertError } = await supabase.from("asset_consent_match_results").upsert(boundedResultRows, {
      onConflict: "job_id,asset_id,consent_id",
    });

    if (resultsUpsertError) {
      throw new HttpError(500, "face_match_results_upsert_failed", "Unable to persist match results.");
    }

    persistedResultsCount = boundedResultRows.length;
  }

  let persistedFaceEvidenceCount = 0;
  if (persistResults && persistFaceEvidence && boundedResultRows.length > 0) {
    const decisionsInScope = new Set<MatchResultDecision>(["auto_link_upserted"]);
    const faceRows: Array<{
      job_id: string;
      asset_id: string;
      consent_id: string;
      face_rank: number;
      tenant_id: string;
      project_id: string;
      similarity: number;
      source_face_box: Record<string, number> | null;
      target_face_box: Record<string, number> | null;
      source_embedding: number[] | null;
      target_embedding: number[] | null;
      provider: string;
      provider_mode: string;
      provider_face_index: number | null;
      provider_plugin_versions: Record<string, unknown> | null;
      matcher_version: string;
      scored_at: string;
    }> = [];
    const keepFaceRanksByPair = new Map<string, number[]>();

    boundedResultRows.forEach((resultRow) => {
      const pairKey = buildPairKey(resultRow.asset_id, resultRow.consent_id);
      keepFaceRanksByPair.set(pairKey, []);

      if (!decisionsInScope.has(resultRow.decision)) {
        return;
      }

      const match = scoreByPair.get(pairKey);
      if (!match) {
        return;
      }

      const normalizedFaces = normalizeFaceEvidenceForPersistence(match);
      keepFaceRanksByPair.set(
        pairKey,
        normalizedFaces.map((_, index) => index),
      );

      normalizedFaces.forEach((face, faceRank) => {
        faceRows.push({
          job_id: jobId,
          asset_id: resultRow.asset_id,
          consent_id: resultRow.consent_id,
          face_rank: faceRank,
          tenant_id: tenantId,
          project_id: projectId,
          similarity: face.similarity,
          source_face_box: face.sourceFaceBox,
          target_face_box: face.targetFaceBox,
          source_embedding: face.sourceEmbedding,
          target_embedding: face.targetEmbedding,
          provider: match.providerMetadata?.provider ?? "unknown",
          provider_mode: match.providerMetadata?.providerMode ?? "unknown",
          provider_face_index: face.providerFaceIndex,
          provider_plugin_versions: match.providerMetadata?.providerPluginVersions ?? null,
          matcher_version: matcherVersion,
          scored_at: nowIso,
        });
      });
    });

    if (faceRows.length > 0) {
      const { error: faceEvidenceUpsertError } = await supabase.from("asset_consent_match_result_faces").upsert(faceRows, {
        onConflict: "job_id,asset_id,consent_id,face_rank",
      });
      if (faceEvidenceUpsertError) {
        throw new HttpError(500, "face_match_result_faces_upsert_failed", "Unable to persist face-evidence rows.");
      }
    }

    for (const [pairKey, keepFaceRanks] of keepFaceRanksByPair.entries()) {
      const [assetId, consentId] = pairKey.split(":");
      await deleteStaleMatchResultFaceRows(
        supabase,
        tenantId,
        projectId,
        jobId,
        assetId,
        consentId,
        keepFaceRanks,
      );
    }

    persistedFaceEvidenceCount = faceRows.length;
  }

  let actionTaken = "no_write";
  if (candidateRows.length > 0) {
    actionTaken = "upsert_candidates";
  } else if (candidateDeletePairKeys.size > 0) {
    actionTaken = "delete_candidates";
  }

  logWorkerDevelopment("auto_match_write_decision", {
    candidatePairs: candidatePairs.size,
    scoredPairs: scoreByPair.size,
    aboveThresholdPairs,
    reviewBandPairs: candidateRows.length,
    persistedResultsCount,
    persistedFaceEvidenceCount,
    threshold: confidenceThreshold,
    reviewMinConfidence,
    actionTaken,
  });

  for (const pairKey of candidateDeletePairKeys) {
    const [assetId, consentId] = pairKey.split(":");
    await deleteMatchCandidatePair(supabase, tenantId, projectId, assetId, consentId);
  }
}

async function resolveJobCandidates(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  maxComparisonsPerJob: number,
): Promise<ResolveJobCandidatesResult> {
  if (job.job_type === "photo_uploaded") {
    if (!job.scope_asset_id) {
      return { eligible: false, candidates: [] };
    }

    const eligiblePhoto = await loadEligiblePhotoAsset(
      supabase,
      job.tenant_id,
      job.project_id,
      job.scope_asset_id,
    );
    if (!eligiblePhoto) {
      return { eligible: false, candidates: [] };
    }

    const eligibleConsents = await loadEligibleConsentIdsWithHeadshots(supabase, job.tenant_id, job.project_id);
    const candidates = eligibleConsents.slice(0, maxComparisonsPerJob).map((consent) => ({
      assetId: job.scope_asset_id as string,
      consentId: consent.consentId,
      photo: {
        storageBucket: eligiblePhoto.storageBucket,
        storagePath: eligiblePhoto.storagePath,
      },
      headshot: {
        storageBucket: consent.headshotStorageBucket,
        storagePath: consent.headshotStoragePath,
      },
    }));
    return { eligible: true, candidates };
  }

  if (job.job_type === "consent_headshot_ready") {
    if (!job.scope_consent_id) {
      return { eligible: false, candidates: [] };
    }

    const eligibleHeadshot = await loadEligibleHeadshotForConsent(
      supabase,
      job.tenant_id,
      job.project_id,
      job.scope_consent_id,
    );
    if (!eligibleHeadshot) {
      return { eligible: false, candidates: [] };
    }

    const projectPhotos = await loadEligibleProjectPhotoIds(supabase, job.tenant_id, job.project_id);
    const candidates = projectPhotos.slice(0, maxComparisonsPerJob).map((photo) => ({
      assetId: photo.id,
      consentId: job.scope_consent_id as string,
      photo: {
        storageBucket: photo.storageBucket,
        storagePath: photo.storagePath,
      },
      headshot: {
        storageBucket: eligibleHeadshot.headshotStorageBucket,
        storagePath: eligibleHeadshot.headshotStoragePath,
      },
    }));
    return { eligible: true, candidates };
  }

  if (job.job_type === "reconcile_project") {
    return { eligible: true, candidates: [] };
  }

  throw new HttpError(400, "face_match_invalid_job_type", "Unsupported face-match job type.");
}

async function completeJobWithMetrics(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  startedAt: number,
  fields: Record<string, unknown>,
  result: ProcessClaimedFaceMatchJobResult,
) {
  const completedJob = await completeFaceMatchJob(supabase, job.job_id, job.lock_token);
  if (completedJob.outcome !== "completed") {
    logWorkerOperational("complete_lost_lease", {
      jobId: job.job_id,
      jobType: job.job_type,
      outcome: completedJob.outcome,
      lockedBy: job.locked_by,
      reclaimed: job.reclaimed,
    });
    return {
      ...result,
      lostLease: true,
    };
  }

  logWorkerDevelopment("job_metrics", {
    jobId: job.job_id,
    jobType: job.job_type,
    reclaimed: job.reclaimed,
    totalMs: Math.round(performance.now() - startedAt),
    ...fields,
  });
  return result;
}

async function processClaimedFaceMatchFanoutContinuation(
  supabase: SupabaseClient,
  continuation: ClaimedFanoutContinuationRow,
  maxComparisonsPerJob: number,
) {
  const batchResult = await processClaimedFanoutContinuation(supabase, continuation, maxComparisonsPerJob);
  const lastStatus = batchResult.superseded
    ? "superseded"
    : batchResult.completed
      ? "completed"
      : "queued";

  const completion = await completeFaceMatchFanoutContinuationBatch(supabase, {
    continuationId: continuation.continuation_id,
    lockToken: continuation.lock_token,
    nextStatus: lastStatus,
    cursorSortAt: batchResult.nextCursorSortAt,
    cursorAssetId: batchResult.nextCursorAssetId,
    cursorConsentId: batchResult.nextCursorConsentId,
    cursorProjectProfileParticipantId: batchResult.nextCursorProjectProfileParticipantId,
  });

  if (completion.outcome !== "completed") {
    logWorkerOperational("fanout_complete_lost_lease", {
      continuationId: continuation.continuation_id,
      direction: continuation.direction,
      outcome: completion.outcome,
      lockedBy: continuation.locked_by,
      reclaimed: continuation.reclaimed,
    });
    return { outcome: "lost_lease" as const, ...batchResult };
  }

  return {
    outcome: batchResult.skippedIneligible ? ("skipped_ineligible" as const) : ("succeeded" as const),
    ...batchResult,
  };
}

async function executeClaimedFaceMatchFanoutContinuation(
  supabase: SupabaseClient,
  continuation: ClaimedFanoutContinuationRow,
  maxComparisonsPerJob: number,
) {
  const startedAt = performance.now();

  try {
    return await processClaimedFaceMatchFanoutContinuation(supabase, continuation, maxComparisonsPerJob);
  } catch (error) {
    const retryable = isRetryableContinuationError(error);
    const failed = await failFaceMatchFanoutContinuation(supabase, {
      continuationId: continuation.continuation_id,
      lockToken: continuation.lock_token,
      errorCode: toContinuationSafeErrorCode(error),
      errorMessage: toContinuationSafeErrorMessage(error),
      retryable,
    });

    if (failed.outcome === "lost_lease" || failed.outcome === "missing" || failed.outcome === "not_processing") {
      logWorkerOperational("fanout_fail_lost_lease", {
        continuationId: continuation.continuation_id,
        direction: continuation.direction,
        outcome: failed.outcome,
        reclaimed: continuation.reclaimed,
      });
      return {
        outcome: "lost_lease" as const,
        skippedIneligible: false,
        itemsExamined: 0,
        compareJobsScheduled: 0,
        materializeJobsScheduled: 0,
        completed: false,
        superseded: false,
        nextCursorSortAt: continuation.cursor_sort_at,
        nextCursorAssetId: continuation.cursor_asset_id,
        nextCursorConsentId: continuation.cursor_consent_id,
        nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
      };
    }

    logWorkerDevelopment("fanout_failure", {
      continuationId: continuation.continuation_id,
      direction: continuation.direction,
      outcome: failed.outcome,
      retryable,
      errorCode: failed.last_error_code,
      totalMs: Math.round(performance.now() - startedAt),
      attemptCount: failed.attempt_count,
      maxAttempts: failed.max_attempts,
      reclaimed: continuation.reclaimed,
    });

    return {
      outcome: failed.outcome === "retried" ? ("retried" as const) : ("dead" as const),
      skippedIneligible: false,
      itemsExamined: 0,
      compareJobsScheduled: 0,
      materializeJobsScheduled: 0,
      completed: false,
      superseded: false,
      nextCursorSortAt: continuation.cursor_sort_at,
      nextCursorAssetId: continuation.cursor_asset_id,
      nextCursorConsentId: continuation.cursor_consent_id,
      nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
    };
  }
}

async function enqueueMaterializeJobForIntake(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
): Promise<ProcessClaimedFaceMatchJobResult> {
  const startedAt = performance.now();
  const materializerVersion = getAutoMatchMaterializerVersion();

  if (job.job_type === "photo_uploaded") {
    if (!job.scope_asset_id) {
      return completeJobWithMetrics(
        supabase,
        job,
        startedAt,
        { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
        { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
      );
    }

    const eligiblePhoto = await loadEligiblePhotoAsset(supabase, job.tenant_id, job.project_id, job.scope_asset_id);
    if (!eligiblePhoto) {
      return completeJobWithMetrics(
        supabase,
        job,
        startedAt,
        { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
        { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
      );
    }

    const enqueueResult = await enqueueMaterializeAssetFacesJob({
      tenantId: job.tenant_id,
      projectId: job.project_id,
      assetId: job.scope_asset_id,
      materializerVersion,
      payload: {
        sourceJobId: job.job_id,
        sourceJobType: job.job_type,
      },
      supabase,
    });

    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      {
        candidateCount: 1,
        scoredPairs: 0,
        skippedIneligible: false,
        pipelineMode: "materialized",
        enqueuedMaterializeJob: enqueueResult.enqueued,
      },
      { skippedIneligible: false, scoredPairs: 0, candidatePairs: 1 },
    );
  }

  if (job.job_type === "consent_headshot_ready") {
    if (!job.scope_consent_id) {
      return completeJobWithMetrics(
        supabase,
        job,
        startedAt,
        { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
        { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
      );
    }

    const eligibleHeadshot = await loadEligibleHeadshotForConsent(
      supabase,
      job.tenant_id,
      job.project_id,
      job.scope_consent_id,
    );
    if (!eligibleHeadshot) {
      return completeJobWithMetrics(
        supabase,
        job,
        startedAt,
        { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
        { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
      );
    }

    const enqueueResult = await enqueueMaterializeAssetFacesJob({
      tenantId: job.tenant_id,
      projectId: job.project_id,
      assetId: eligibleHeadshot.headshotAssetId,
      materializerVersion,
      payload: {
        sourceJobId: job.job_id,
        sourceJobType: job.job_type,
        consentId: job.scope_consent_id,
      },
      supabase,
    });

    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      {
        candidateCount: 1,
        scoredPairs: 0,
        skippedIneligible: false,
        pipelineMode: "materialized",
        enqueuedMaterializeJob: enqueueResult.enqueued,
      },
      { skippedIneligible: false, scoredPairs: 0, candidatePairs: 1 },
    );
  }

  if (job.job_type === "reconcile_project") {
    const payload = parseReconcileProjectPayload(job.payload);
    if (payload.replayKind === "recurring_profile_source" && payload.projectProfileParticipantId) {
      const currentSource = await resolveAutoEligibleProjectRecurringSource(supabase, {
        tenantId: job.tenant_id,
        projectId: job.project_id,
        projectProfileParticipantId: payload.projectProfileParticipantId,
      });

      if (!currentSource) {
        const supersededCount = await supersedeRecurringProfileFanoutContinuations(supabase, {
          tenantId: job.tenant_id,
          projectId: job.project_id,
          projectProfileParticipantId: payload.projectProfileParticipantId,
        });

        return completeJobWithMetrics(
          supabase,
          job,
          startedAt,
          {
            candidateCount: 0,
            scoredPairs: 0,
            skippedIneligible: false,
            pipelineMode: "materialized",
            replayKind: payload.replayKind,
            recurringSourceReady: false,
            replayReason: payload.reason,
            supersededContinuations: supersededCount,
          },
          { skippedIneligible: false, scoredPairs: 0, candidatePairs: 0 },
        );
      }

      const boundary = await getPhotoFanoutBoundary(supabase, job.tenant_id, job.project_id);
      let replayScheduled = false;

      if (boundary.boundaryPhotoUploadedAt && boundary.boundaryPhotoAssetId) {
        const enqueueResult = await enqueueFaceMatchFanoutContinuation(supabase, {
          tenantId: job.tenant_id,
          projectId: job.project_id,
          direction: "recurring_profile_to_photos",
          sourceProjectProfileParticipantId: currentSource.projectProfileParticipantId,
          sourceProfileId: currentSource.profileId,
          sourceHeadshotId: currentSource.recurringHeadshotId,
          sourceSelectionFaceId: currentSource.selectionFaceId,
          sourceMaterializationId: currentSource.recurringHeadshotMaterializationId,
          sourceMaterializerVersion: getAutoMatchMaterializerVersion(),
          compareVersion: getAutoMatchCompareVersion(),
          boundarySnapshotAt: boundary.boundarySnapshotAt,
          boundarySortAt: boundary.boundaryPhotoUploadedAt,
          boundaryAssetId: boundary.boundaryPhotoAssetId,
          dispatchMode: "backfill_repair",
          resetTerminal: true,
        });
        replayScheduled =
          enqueueResult.enqueued || enqueueResult.requeued || enqueueResult.alreadyProcessing || enqueueResult.alreadyQueued;
      }

      const supersededCount = await supersedeRecurringProfileFanoutContinuations(supabase, {
        tenantId: job.tenant_id,
        projectId: job.project_id,
        projectProfileParticipantId: currentSource.projectProfileParticipantId,
        keepSourceMaterializationId: currentSource.recurringHeadshotMaterializationId,
        keepSelectionFaceId: currentSource.selectionFaceId,
      });

      return completeJobWithMetrics(
        supabase,
        job,
        startedAt,
        {
          candidateCount: replayScheduled ? 1 : 0,
          scoredPairs: 0,
          skippedIneligible: false,
          pipelineMode: "materialized",
          replayKind: payload.replayKind,
          recurringSourceReady: true,
          replayReason: payload.reason,
          replayScheduled,
          supersededContinuations: supersededCount,
        },
        { skippedIneligible: false, scoredPairs: 0, candidatePairs: replayScheduled ? 1 : 0 },
      );
    }

    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      { candidateCount: 0, scoredPairs: 0, skippedIneligible: false, pipelineMode: "materialized" },
      { skippedIneligible: false, scoredPairs: 0, candidatePairs: 0 },
    );
  }

  throw new HttpError(400, "face_match_invalid_job_type", "Unsupported materialized intake job type.");
}

async function processMaterializeAssetFacesJob(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  matcher: AutoMatcher,
): Promise<ProcessClaimedFaceMatchJobResult> {
  const startedAt = performance.now();
  if (!job.scope_asset_id) {
    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
      { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
    );
  }

  const materializePayload = parseMaterializeAssetFacesPayload(job.payload);
  const materializerVersion = materializePayload.materializerVersion;
  const currentMaterialization = await loadCurrentAssetFaceMaterialization(
    supabase,
    job.tenant_id,
    job.project_id,
    job.scope_asset_id,
    materializerVersion,
    { includeFaces: false },
  );
  const ensured = await ensureAssetFaceMaterialization({
    supabase,
    matcher,
    tenantId: job.tenant_id,
    projectId: job.project_id,
    assetId: job.scope_asset_id,
    materializerVersion,
    includeFaces: false,
    forceRematerialize:
      materializePayload.repairRequested &&
      shouldForceRematerializeCurrentMaterialization(currentMaterialization?.materialization),
  });

  if (!ensured) {
    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
      { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
    );
  }

  const continuationCount = await createOrResetFanoutContinuationsForMaterializedAsset(supabase, {
    tenantId: job.tenant_id,
    projectId: job.project_id,
    assetId: ensured.asset.assetId,
    assetType: ensured.asset.assetType,
    sourceMaterializationId: ensured.materialization.id,
    sourceMaterializerVersion: materializerVersion,
    compareVersion: getAutoMatchCompareVersion(),
    repairRequested: materializePayload.repairRequested,
  });

  return completeJobWithMetrics(
    supabase,
    job,
    startedAt,
    {
      candidateCount: continuationCount,
      scoredPairs: 0,
      skippedIneligible: false,
      pipelineMode: "materialized",
      materializedAssetType: ensured.asset.assetType,
      faceCount: ensured.materialization.face_count,
      usableForCompare: ensured.materialization.usable_for_compare,
      repairRequested: materializePayload.repairRequested,
    },
    { skippedIneligible: false, scoredPairs: 0, candidatePairs: continuationCount },
  );
}

async function isCurrentMaterializedPair(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  headshotMaterialization: AssetFaceMaterializationRow,
  assetMaterialization: AssetFaceMaterializationRow,
) {
  if (!job.scope_consent_id || !job.scope_asset_id) {
    return false;
  }

  const currentHeadshot = await loadConsentHeadshotMaterialization(
    supabase,
    job.tenant_id,
    job.project_id,
    job.scope_consent_id,
    headshotMaterialization.materializer_version,
    { includeFaces: false },
  );
  if (!currentHeadshot || currentHeadshot.materialization.id !== headshotMaterialization.id) {
    return false;
  }

  const currentAsset = await loadCurrentAssetFaceMaterialization(
    supabase,
    job.tenant_id,
    job.project_id,
    job.scope_asset_id,
    assetMaterialization.materializer_version,
    { includeFaces: false },
  );
  if (!currentAsset || currentAsset.materialization.id !== assetMaterialization.id) {
    return false;
  }

  return true;
}

async function processCompareMaterializedPairJob(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  matcher: AutoMatcher,
  confidenceThreshold: number,
  reviewMinConfidence: number,
  persistResults: boolean,
  persistFaceEvidence: boolean,
  resultsMaxPerJob: number | null,
): Promise<ProcessClaimedFaceMatchJobResult> {
  const startedAt = performance.now();
  if (!job.scope_asset_id || !job.scope_consent_id) {
    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
      { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
    );
  }

  const payload = parseCompareMaterializedPairPayload(job.payload);
  const compare = await ensureMaterializedFaceCompare({
    supabase,
    matcher,
    tenantId: job.tenant_id,
    projectId: job.project_id,
    consentId: job.scope_consent_id,
    assetId: job.scope_asset_id,
    headshotMaterializationId: payload.headshotMaterializationId,
    assetMaterializationId: payload.assetMaterializationId,
    compareVersion: payload.compareVersion,
  });

  const pipelineMode = getAutoMatchPipelineMode();
  const isCurrent = await isCurrentMaterializedPair(
    supabase,
    job,
    compare.headshotMaterialization,
    compare.assetMaterialization,
  );
  const consentEligible = await loadConsentEligibility(
    supabase,
    job.tenant_id,
    job.project_id,
    job.scope_consent_id,
  );

  if (pipelineMode === "materialized_apply" && isCurrent && consentEligible) {
    const match = buildMaterializedMatchFromCompare({
      assetId: job.scope_asset_id,
      consentId: job.scope_consent_id,
      confidence: compare.compare.winning_similarity,
      providerMetadata: toAutoMatcherProviderMetadata(
        compare.compare.provider,
        compare.compare.provider_mode,
        compare.compare.provider_plugin_versions,
      ),
      headshotFace: compare.headshotFace,
      winningAssetFace: compare.winningAssetFace,
    });

    const candidate: AutoMatcherCandidate = {
      assetId: job.scope_asset_id,
      consentId: job.scope_consent_id,
      photo: {
        storageBucket: "__materialized__",
        storagePath: compare.assetMaterialization.id,
      },
      headshot: {
        storageBucket: "__materialized__",
        storagePath: compare.headshotMaterialization.id,
      },
    };

    await applyAutoMatches(
      supabase,
      job.tenant_id,
      job.project_id,
      job.job_id,
      job.job_type,
      [candidate],
      matcher.version,
      confidenceThreshold,
      reviewMinConfidence,
      persistResults,
      persistFaceEvidence,
      resultsMaxPerJob,
      [match],
    );

    const reviewMin = Math.min(reviewMinConfidence, confidenceThreshold);
    if (
      compare.compare.winning_asset_face_id &&
      compare.compare.winning_similarity >= reviewMin &&
      compare.compare.winning_similarity < confidenceThreshold
    ) {
      const { error: candidateUpdateError } = await supabase.from("asset_consent_match_candidates").upsert(
        {
          tenant_id: job.tenant_id,
          project_id: job.project_id,
          asset_id: job.scope_asset_id,
          consent_id: job.scope_consent_id,
          confidence: compare.compare.winning_similarity,
          matcher_version: matcher.version,
          source_job_type: job.job_type,
          last_scored_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          winning_asset_face_id: compare.compare.winning_asset_face_id,
          winning_asset_face_rank: compare.compare.winning_asset_face_rank,
        },
        {
          onConflict: "asset_id,consent_id",
        },
      );

      if (candidateUpdateError) {
        throw new HttpError(500, "face_match_candidate_upsert_failed", "Unable to update likely-match candidates.");
      }
    }

    await reconcilePhotoFaceCanonicalStateForAsset({
      supabase,
      tenantId: job.tenant_id,
      projectId: job.project_id,
      assetId: job.scope_asset_id,
    });
  }

  return completeJobWithMetrics(
    supabase,
    job,
    startedAt,
    {
      candidateCount: 1,
      scoredPairs: 1,
      skippedIneligible: false,
      pipelineMode,
      compareStatus: compare.compare.compare_status,
      currentVersionedPair: isCurrent,
      consentEligible,
      winningSimilarity: compare.compare.winning_similarity,
      winningAssetFaceRank: compare.compare.winning_asset_face_rank,
    },
    { skippedIneligible: false, scoredPairs: 1, candidatePairs: 1 },
  );
}

async function isCurrentRecurringMaterializedPair(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  payload: CompareRecurringProfileMaterializedPairPayload,
  assetMaterialization: AssetFaceMaterializationRow,
) {
  if (!job.scope_asset_id) {
    return false;
  }

  const currentSource = await resolveAutoEligibleProjectRecurringSource(supabase, {
    tenantId: job.tenant_id,
    projectId: job.project_id,
    projectProfileParticipantId: payload.projectProfileParticipantId,
  });
  if (!currentSource) {
    return false;
  }

  if (
    currentSource.profileId !== payload.profileId
    || currentSource.recurringHeadshotId !== payload.recurringHeadshotId
    || currentSource.recurringHeadshotMaterializationId !== payload.recurringHeadshotMaterializationId
    || currentSource.selectionFaceId !== payload.recurringSelectionFaceId
  ) {
    return false;
  }

  const currentAsset = await loadCurrentAssetFaceMaterialization(
    supabase,
    job.tenant_id,
    job.project_id,
    job.scope_asset_id,
    assetMaterialization.materializer_version,
    { includeFaces: false },
  );
  if (!currentAsset || currentAsset.materialization.id !== assetMaterialization.id) {
    return false;
  }

  return true;
}

async function processCompareRecurringProfileMaterializedPairJob(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  matcher: AutoMatcher,
): Promise<ProcessClaimedFaceMatchJobResult> {
  const startedAt = performance.now();
  if (!job.scope_asset_id) {
    return completeJobWithMetrics(
      supabase,
      job,
      startedAt,
      { candidateCount: 0, scoredPairs: 0, skippedIneligible: true, pipelineMode: "materialized" },
      { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 },
    );
  }

  const payload = parseCompareRecurringProfileMaterializedPairPayload(job.payload);
  const compare = await ensureRecurringProfileMaterializedFaceCompare({
    supabase,
    matcher,
    tenantId: job.tenant_id,
    projectId: job.project_id,
    projectProfileParticipantId: payload.projectProfileParticipantId,
    profileId: payload.profileId,
    assetId: job.scope_asset_id,
    recurringHeadshotId: payload.recurringHeadshotId,
    recurringHeadshotMaterializationId: payload.recurringHeadshotMaterializationId,
    recurringSelectionFaceId: payload.recurringSelectionFaceId,
    assetMaterializationId: payload.assetMaterializationId,
    compareVersion: payload.compareVersion,
  });
  const isCurrent = await isCurrentRecurringMaterializedPair(
    supabase,
    job,
    payload,
    compare.assetMaterialization,
  );

  if (isCurrent) {
    await reconcilePhotoFaceCanonicalStateForAsset({
      supabase,
      tenantId: job.tenant_id,
      projectId: job.project_id,
      assetId: job.scope_asset_id,
    });
  }

  return completeJobWithMetrics(
    supabase,
    job,
    startedAt,
    {
      candidateCount: 1,
      scoredPairs: 1,
      skippedIneligible: false,
      pipelineMode: "materialized",
      compareStatus: compare.compare.compare_status,
      currentVersionedPair: isCurrent,
      recurringProfileId: payload.profileId,
      projectProfileParticipantId: payload.projectProfileParticipantId,
      winningSimilarity: compare.compare.winning_similarity,
      winningAssetFaceRank: compare.compare.winning_asset_face_rank,
    },
    { skippedIneligible: false, scoredPairs: 1, candidatePairs: 1 },
  );
}

async function processClaimedFaceMatchJobRaw(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  matcher: AutoMatcher,
  confidenceThreshold: number,
  reviewMinConfidence: number,
  persistResults: boolean,
  persistFaceEvidence: boolean,
  resultsMaxPerJob: number | null,
  maxComparisonsPerJob: number,
): Promise<ProcessClaimedFaceMatchJobResult> {
  const startedAt = performance.now();
  const resolved = await resolveJobCandidates(supabase, job, maxComparisonsPerJob);

  if (!resolved.eligible) {
    const completedJob = await completeFaceMatchJob(supabase, job.job_id, job.lock_token);
    if (completedJob.outcome !== "completed") {
      logWorkerOperational("complete_lost_lease", {
        jobId: job.job_id,
        jobType: job.job_type,
        outcome: completedJob.outcome,
        lockedBy: job.locked_by,
        reclaimed: job.reclaimed,
      });
      return { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0, lostLease: true };
    }

    logWorkerDevelopment("job_metrics", {
      jobId: job.job_id,
      jobType: job.job_type,
      reclaimed: job.reclaimed,
      candidateCount: 0,
      scoredPairs: 0,
      skippedIneligible: true,
      totalMs: Math.round(performance.now() - startedAt),
    });
    return { skippedIneligible: true, scoredPairs: 0, candidatePairs: 0 };
  }

  const matcherStartedAt = performance.now();
  const matches = await matcher.match({
    tenantId: job.tenant_id,
    projectId: job.project_id,
    jobType: job.job_type,
    candidates: resolved.candidates,
    supabase,
  });
  const matcherDurationMs = performance.now() - matcherStartedAt;

  const writesStartedAt = performance.now();
  await applyAutoMatches(
    supabase,
    job.tenant_id,
    job.project_id,
    job.job_id,
    job.job_type,
    resolved.candidates,
    matcher.version,
    confidenceThreshold,
    reviewMinConfidence,
    persistResults,
    persistFaceEvidence,
    resultsMaxPerJob,
    matches,
  );
  const writesDurationMs = performance.now() - writesStartedAt;
  const completedJob = await completeFaceMatchJob(supabase, job.job_id, job.lock_token);
  if (completedJob.outcome !== "completed") {
    logWorkerOperational("complete_lost_lease", {
      jobId: job.job_id,
      jobType: job.job_type,
      outcome: completedJob.outcome,
      lockedBy: job.locked_by,
      reclaimed: job.reclaimed,
    });
    return {
      skippedIneligible: false,
      scoredPairs: 0,
      candidatePairs: 0,
      lostLease: true,
    };
  }

  const scoredPairs = normalizeAutoMatcherMatches(matches).length;
  const totalDurationMs = performance.now() - startedAt;
  const pairsPerSecond = totalDurationMs > 0 ? (scoredPairs * 1000) / totalDurationMs : 0;
  logWorkerDevelopment("job_metrics", {
    jobId: job.job_id,
    jobType: job.job_type,
    reclaimed: job.reclaimed,
    candidateCount: resolved.candidates.length,
    scoredPairs,
    matcherMs: Math.round(matcherDurationMs),
    writesMs: Math.round(writesDurationMs),
    totalMs: Math.round(totalDurationMs),
    pairsPerSecond: Number(pairsPerSecond.toFixed(2)),
  });
  return {
    skippedIneligible: false,
    scoredPairs,
    candidatePairs: resolved.candidates.length,
  };
}

async function processClaimedFaceMatchJob(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  matcher: AutoMatcher,
  confidenceThreshold: number,
  reviewMinConfidence: number,
  persistResults: boolean,
  persistFaceEvidence: boolean,
  resultsMaxPerJob: number | null,
  maxComparisonsPerJob: number,
): Promise<ProcessClaimedFaceMatchJobResult> {
  const pipelineMode = getAutoMatchPipelineMode();
  if (job.job_type === "compare_materialized_pair") {
    return processCompareMaterializedPairJob(
      supabase,
      job,
      matcher,
      confidenceThreshold,
      reviewMinConfidence,
      persistResults,
      persistFaceEvidence,
      resultsMaxPerJob,
    );
  }

  if (job.job_type === "compare_recurring_profile_materialized_pair") {
    return processCompareRecurringProfileMaterializedPairJob(
      supabase,
      job,
      matcher,
    );
  }

  if (pipelineMode === "raw") {
    return processClaimedFaceMatchJobRaw(
      supabase,
      job,
      matcher,
      confidenceThreshold,
      reviewMinConfidence,
      persistResults,
      persistFaceEvidence,
      resultsMaxPerJob,
      maxComparisonsPerJob,
    );
  }

  if (job.job_type === "photo_uploaded" || job.job_type === "consent_headshot_ready" || job.job_type === "reconcile_project") {
    return enqueueMaterializeJobForIntake(supabase, job);
  }

  if (job.job_type === "materialize_asset_faces") {
    return processMaterializeAssetFacesJob(supabase, job, matcher);
  }

  throw new HttpError(400, "face_match_invalid_job_type", "Unsupported face-match job type.");
}

async function executeClaimedFaceMatchJob(
  supabase: SupabaseClient,
  job: ClaimedFaceMatchJobRow,
  matcher: AutoMatcher,
  confidenceThreshold: number,
  reviewMinConfidence: number,
  persistResults: boolean,
  persistFaceEvidence: boolean,
  resultsMaxPerJob: number | null,
  maxComparisonsPerJob: number,
): Promise<ExecuteClaimedFaceMatchJobResult> {
  const startedAt = performance.now();

  try {
    const result = await processClaimedFaceMatchJob(
      supabase,
      job,
      matcher,
      confidenceThreshold,
      reviewMinConfidence,
      persistResults,
      persistFaceEvidence,
      resultsMaxPerJob,
      maxComparisonsPerJob,
    );

    if (result.lostLease) {
      return {
        outcome: "lost_lease",
        scoredPairs: 0,
        candidatePairs: 0,
      };
    }

    return {
      outcome: result.skippedIneligible ? "skipped_ineligible" : "succeeded",
      scoredPairs: result.scoredPairs,
      candidatePairs: result.candidatePairs,
    };
  } catch (error) {
    const retryable = isRetryableError(error);
    const failedJob = await failFaceMatchJob(
      supabase,
      job.job_id,
      job.lock_token,
      toSafeErrorCode(error),
      toSafeErrorMessage(error),
      retryable,
    );
    if (failedJob.outcome === "lost_lease" || failedJob.outcome === "missing" || failedJob.outcome === "not_processing") {
      logWorkerOperational("fail_lost_lease", {
        jobId: job.job_id,
        jobType: job.job_type,
        outcome: failedJob.outcome,
        retryable,
        reclaimed: job.reclaimed,
      });

      return {
        outcome: "lost_lease",
        scoredPairs: 0,
        candidatePairs: 0,
      };
    }

    const outcome = failedJob.outcome === "retried" ? "retried" : "dead";

    logWorkerDevelopment("job_failure", {
      jobId: job.job_id,
      jobType: job.job_type,
      outcome,
      retryable,
      errorCode: failedJob.last_error_code,
      totalMs: Math.round(performance.now() - startedAt),
      attemptCount: failedJob.attempt_count,
      maxAttempts: failedJob.max_attempts,
      reclaimed: job.reclaimed,
    });

    return {
      outcome,
      scoredPairs: 0,
      candidatePairs: 0,
    };
  }
}

export async function runAutoMatchWorker(
  input: RunAutoMatchWorkerInput,
): Promise<RunAutoMatchWorkerResult> {
  const runStartedAt = performance.now();
  const supabase = getInternalSupabaseClient(input.supabase);
  const batchSize = normalizeBatchSize(input.batchSize);
  const confidenceThreshold = normalizeThreshold(input.confidenceThreshold);
  const reviewMinConfidence = normalizeReviewMinConfidence(input.reviewMinConfidence, confidenceThreshold);
  const persistResults = normalizePersistResults(input.persistResults);
  const persistFaceEvidence = normalizePersistFaceEvidence(input.persistFaceEvidence);
  const resultsMaxPerJob = normalizeResultsMaxPerJob(input.resultsMaxPerJob);
  const maxComparisonsPerJob = normalizeMaxComparisons(input.maxComparisonsPerJob);
  const matcher = input.matcher ?? getAutoMatcher();
  const workerId = String(input.workerId ?? "").trim();
  if (!workerId) {
    throw new HttpError(400, "face_match_worker_id_required", "Worker ID is required.");
  }

  if (persistFaceEvidence && !persistResults) {
    throw new HttpError(
      500,
      "face_match_invalid_config",
      "AUTO_MATCH_PERSIST_FACE_EVIDENCE requires AUTO_MATCH_PERSIST_RESULTS.",
    );
  }

  const claimedJobs = await claimFaceMatchJobs(supabase, workerId, batchSize);
  claimedJobs
    .filter((job) => job.reclaimed)
    .forEach((job) => {
      logWorkerOperational("job_reclaimed", {
        workerId,
        jobId: job.job_id,
        jobType: job.job_type,
        leaseExpiresAt: job.lease_expires_at,
        lockToken: job.lock_token,
      });
    });
  const workerConcurrency = normalizeWorkerConcurrency(claimedJobs.length);
  const counters: RunAutoMatchWorkerResult = {
    claimed: claimedJobs.length,
    workerConcurrency,
    succeeded: 0,
    retried: 0,
    dead: 0,
    skippedIneligible: 0,
    scoredPairs: 0,
    candidatePairs: 0,
  };

  const jobResults = await mapWithConcurrency(
    claimedJobs,
    normalizeWorkerConcurrency(claimedJobs.length),
    async (job) =>
      executeClaimedFaceMatchJob(
        supabase,
        job,
        matcher,
        confidenceThreshold,
        reviewMinConfidence,
        persistResults,
        persistFaceEvidence,
        resultsMaxPerJob,
        maxComparisonsPerJob,
      ),
  );

  jobResults.forEach((result) => {
    if (result.outcome === "succeeded") {
      counters.succeeded += 1;
    } else if (result.outcome === "skipped_ineligible") {
      counters.skippedIneligible += 1;
    } else if (result.outcome === "retried") {
      counters.retried += 1;
    } else if (result.outcome === "dead") {
      counters.dead += 1;
    }

    counters.scoredPairs += result.scoredPairs;
    counters.candidatePairs += result.candidatePairs;
  });
  const shouldClaimContinuationsThisRun = claimedJobs.every(
    (job) =>
      job.job_type === "compare_materialized_pair"
      || job.job_type === "compare_recurring_profile_materialized_pair",
  );

  let claimedContinuations: ClaimedFanoutContinuationRow[] = [];
  let continuationResults: Array<
    Awaited<ReturnType<typeof executeClaimedFaceMatchFanoutContinuation>>
  > = [];

  if (shouldClaimContinuationsThisRun) {
    claimedContinuations = await claimFaceMatchFanoutContinuations(
      supabase,
      workerId,
      batchSize,
      getAutoMatchJobLeaseSeconds(),
    );
    claimedContinuations
      .filter((continuation) => continuation.reclaimed)
      .forEach((continuation) => {
        logWorkerOperational("fanout_reclaimed", {
          workerId,
          continuationId: continuation.continuation_id,
          direction: continuation.direction,
          leaseExpiresAt: continuation.lease_expires_at,
          lockToken: continuation.lock_token,
        });
      });

    continuationResults = await mapWithConcurrency(
      claimedContinuations,
      normalizeWorkerConcurrency(claimedContinuations.length),
      async (continuation) =>
        executeClaimedFaceMatchFanoutContinuation(
          supabase,
          continuation,
          maxComparisonsPerJob,
        ),
    );
  }

  counters.claimed += claimedContinuations.length;
  counters.workerConcurrency = normalizeWorkerConcurrency(counters.claimed);

  continuationResults.forEach((result) => {
    if (result.outcome === "lost_lease") {
      return;
    }
    if (result.outcome === "retried") {
      counters.retried += 1;
      return;
    }
    if (result.outcome === "dead") {
      counters.dead += 1;
      return;
    }
    if (result.outcome === "skipped_ineligible") {
      counters.skippedIneligible += 1;
    } else {
      counters.succeeded += 1;
    }
    counters.candidatePairs += result.itemsExamined;
  });

  logWorkerDevelopment("worker_run_summary", {
    workerId,
    batchSize,
    pipelineMode: getAutoMatchPipelineMode(),
    claimed: counters.claimed,
    configuredWorkerConcurrency: getAutoMatchWorkerConcurrency(),
    workerConcurrency,
    succeeded: counters.succeeded,
    retried: counters.retried,
    dead: counters.dead,
    skippedIneligible: counters.skippedIneligible,
    scoredPairs: counters.scoredPairs,
    candidatePairs: counters.candidatePairs,
    totalMs: Math.round(performance.now() - runStartedAt),
    pairsPerSecond:
      counters.scoredPairs > 0
        ? Number(((counters.scoredPairs * 1000) / Math.max(1, performance.now() - runStartedAt)).toFixed(2))
        : 0,
  });

  return counters;
}
