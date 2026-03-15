import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  getAutoMatchConfidenceThreshold,
  getAutoMatchMaxComparisonsPerJob,
  getAutoMatchPersistFaceEvidence,
  getAutoMatchPersistResults,
  getAutoMatchResultsMaxPerJob,
  getAutoMatchReviewMinConfidence,
} from "@/lib/matching/auto-match-config";
import type { FaceMatchJobType } from "@/lib/matching/auto-match-jobs";
import {
  getAutoMatcher,
  type AutoMatcher,
  type AutoMatcherCandidate,
  type AutoMatcherFaceBox,
  type AutoMatcherMatch,
} from "@/lib/matching/auto-matcher";
import { MatcherProviderError } from "@/lib/matching/provider-errors";

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
  started_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

type FailFaceMatchJobRow = {
  job_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  updated_at: string;
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
  if (error instanceof HttpError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown worker error.";
}

function toSafeErrorCode(error: unknown) {
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

async function claimFaceMatchJobs(
  supabase: SupabaseClient,
  workerId: string,
  batchSize: number,
): Promise<ClaimedFaceMatchJobRow[]> {
  const { data, error } = await supabase.rpc("claim_face_match_jobs", {
    p_locked_by: workerId,
    p_batch_size: batchSize,
  });

  if (error) {
    throw new HttpError(500, "face_match_claim_failed", "Unable to claim face-match jobs.");
  }

  return (data as ClaimedFaceMatchJobRow[] | null) ?? [];
}

async function completeFaceMatchJob(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase.rpc("complete_face_match_job", {
    p_job_id: jobId,
  });

  if (error) {
    throw new HttpError(500, "face_match_complete_failed", "Unable to complete face-match job.");
  }

  if (!data?.[0]) {
    throw new HttpError(409, "face_match_complete_conflict", "Face-match job was not in processing state.");
  }
}

async function failFaceMatchJob(
  supabase: SupabaseClient,
  jobId: string,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
) {
  const { data, error } = await supabase.rpc("fail_face_match_job", {
    p_job_id: jobId,
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
    throw new HttpError(409, "face_match_fail_conflict", "Face-match job was not in processing state.");
  }

  return row;
}

async function loadEligibleConsentIdsWithHeadshots(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<EligibleConsentWithHeadshot[]> {
  const { data: consents, error: consentsError } = await supabase
    .from("consents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("face_match_opt_in", true)
    .is("revoked_at", null)
    .limit(MAX_MATCH_CANDIDATES);

  if (consentsError) {
    throw new HttpError(500, "face_match_consent_lookup_failed", "Unable to load eligible consents.");
  }

  const consentIds = (consents ?? []).map((row) => row.id);
  if (consentIds.length === 0) {
    return [];
  }

  const { data: links, error: linksError } = await supabase
    .from("asset_consent_links")
    .select("consent_id, asset_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("consent_id", consentIds);

  if (linksError) {
    throw new HttpError(500, "face_match_headshot_lookup_failed", "Unable to load consent headshots.");
  }

  const headshotIds = Array.from(new Set((links ?? []).map((link) => link.asset_id)));
  if (headshotIds.length === 0) {
    return [];
  }

  const nowIso = new Date().toISOString();
  const { data: headshots, error: headshotsError } = await supabase
    .from("assets")
    .select("id, storage_bucket, storage_path, uploaded_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_type", "headshot")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .in("id", headshotIds)
    .or(`retention_expires_at.is.null,retention_expires_at.gt.${nowIso}`)
    .order("uploaded_at", { ascending: false });

  if (headshotsError) {
    throw new HttpError(500, "face_match_headshot_lookup_failed", "Unable to validate consent headshots.");
  }

  const headshotById = new Map(
    (headshots ?? []).map((headshot) => [
      headshot.id,
      {
        storageBucket: headshot.storage_bucket,
        storagePath: headshot.storage_path,
        uploadedAt: headshot.uploaded_at,
      },
    ]),
  );
  const eligibleByConsentId = new Map<string, EligibleConsentWithHeadshot>();

  const sortedLinks = (links ?? [])
    .filter((link) => headshotById.has(link.asset_id))
    .sort((left, right) => {
      const leftUploadedAt = headshotById.get(left.asset_id)?.uploadedAt ?? "";
      const rightUploadedAt = headshotById.get(right.asset_id)?.uploadedAt ?? "";
      return rightUploadedAt.localeCompare(leftUploadedAt);
    });

  sortedLinks.forEach((link) => {
    if (eligibleByConsentId.has(link.consent_id)) {
      return;
    }

    const headshot = headshotById.get(link.asset_id);
    if (!headshot?.storageBucket || !headshot.storagePath) {
      return;
    }

    eligibleByConsentId.set(link.consent_id, {
      consentId: link.consent_id,
      headshotAssetId: link.asset_id,
      headshotStorageBucket: headshot.storageBucket,
      headshotStoragePath: headshot.storagePath,
    });
  });

  return Array.from(eligibleByConsentId.values());
}

async function loadEligibleHeadshotForConsent(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
) {
  const { data: consent, error: consentError } = await supabase
    .from("consents")
    .select("id, face_match_opt_in, revoked_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", consentId)
    .maybeSingle();

  if (consentError) {
    throw new HttpError(500, "face_match_consent_lookup_failed", "Unable to load consent.");
  }

  if (!consent || !consent.face_match_opt_in || consent.revoked_at) {
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

async function deleteAutoLinkPair(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  consentId: string,
) {
  const { error } = await supabase
    .from("asset_consent_links")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .eq("consent_id", consentId)
    .eq("link_source", "auto");

  if (error) {
    throw new HttpError(500, "face_match_link_delete_failed", "Unable to remove stale auto consent links.");
  }
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

  const assetIds = Array.from(new Set(candidates.map((candidate) => candidate.assetId)));
  const consentIds = Array.from(new Set(candidates.map((candidate) => candidate.consentId)));

  const { data: existingLinks, error: existingLinksError } = await supabase
    .from("asset_consent_links")
    .select("asset_id, consent_id, link_source")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("asset_id", assetIds)
    .in("consent_id", consentIds);

  if (existingLinksError) {
    throw new HttpError(500, "face_match_link_lookup_failed", "Unable to load existing consent links.");
  }

  const existingLinkSourceByPair = new Map<string, string>(
    (existingLinks ?? []).map((row) => [`${row.asset_id}:${row.consent_id}`, row.link_source]),
  );

  const { data: suppressedRows, error: suppressedRowsError } = await supabase
    .from("asset_consent_link_suppressions")
    .select("asset_id, consent_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("asset_id", assetIds)
    .in("consent_id", consentIds);

  if (suppressedRowsError) {
    throw new HttpError(500, "face_match_suppression_lookup_failed", "Unable to load matching suppressions.");
  }

  const suppressedPairs = new Set(
    (suppressedRows ?? [])
      .map((row) => buildPairKey(row.asset_id, row.consent_id))
      .filter((pairKey) => candidatePairs.has(pairKey)),
  );

  const manualPairs = new Set<string>();
  existingLinkSourceByPair.forEach((linkSource, pairKey) => {
    if (candidatePairs.has(pairKey) && linkSource === "manual") {
      manualPairs.add(pairKey);
    }
  });

  const nowIso = new Date().toISOString();
  const normalizedScores = Array.from(scoreByPair.values());
  const aboveThresholdPairs = Array.from(scoreByPair.values()).filter(
    (match) => match.confidence >= confidenceThreshold,
  ).length;
  const upsertRows = normalizedScores
    .filter((match) => match.confidence >= confidenceThreshold)
    .filter((match) => !suppressedPairs.has(buildPairKey(match.assetId, match.consentId)))
    .filter((match) => existingLinkSourceByPair.get(buildPairKey(match.assetId, match.consentId)) !== "manual")
    .map((match) => ({
      tenant_id: tenantId,
      project_id: projectId,
      asset_id: match.assetId,
      consent_id: match.consentId,
      link_source: "auto",
      match_confidence: match.confidence,
      matched_at: nowIso,
      matcher_version: matcherVersion,
    }));

  const candidateRows = normalizedScores
    .filter((match) => match.confidence >= reviewMinConfidence && match.confidence < confidenceThreshold)
    .filter((match) => !suppressedPairs.has(buildPairKey(match.assetId, match.consentId)))
    .filter((match) => existingLinkSourceByPair.get(buildPairKey(match.assetId, match.consentId)) !== "manual")
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

  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase.from("asset_consent_links").upsert(upsertRows, {
      onConflict: "asset_id,consent_id",
    });

    if (upsertError) {
      throw new HttpError(500, "face_match_link_upsert_failed", "Unable to write auto consent links.");
    }
  }

  if (candidateRows.length > 0) {
    const { error: candidateUpsertError } = await supabase.from("asset_consent_match_candidates").upsert(candidateRows, {
      onConflict: "asset_id,consent_id",
    });

    if (candidateUpsertError) {
      throw new HttpError(500, "face_match_candidate_upsert_failed", "Unable to upsert likely-match candidates.");
    }
  }

  const staleAutoPairKeys = new Set<string>();
  normalizedScores
    .filter((match) => match.confidence < confidenceThreshold)
    .forEach((match) => {
      const pairKey = buildPairKey(match.assetId, match.consentId);
      if (existingLinkSourceByPair.get(pairKey) === "auto") {
        staleAutoPairKeys.add(pairKey);
      }
    });

  suppressedPairs.forEach((pairKey) => {
    if (existingLinkSourceByPair.get(pairKey) === "auto") {
      staleAutoPairKeys.add(pairKey);
    }
  });

  const candidateDeletePairKeys = new Set<string>();
  normalizedScores
    .filter((match) => match.confidence < reviewMinConfidence || match.confidence >= confidenceThreshold)
    .forEach((match) => {
      candidateDeletePairKeys.add(buildPairKey(match.assetId, match.consentId));
    });
  manualPairs.forEach((pairKey) => {
    candidateDeletePairKeys.add(pairKey);
  });
  suppressedPairs.forEach((pairKey) => {
    candidateDeletePairKeys.add(pairKey);
  });

  const resultRows = normalizedScores
    .map((match) => {
      const pairKey = buildPairKey(match.assetId, match.consentId);
      let decision: MatchResultDecision = "below_review_band";

      if (manualPairs.has(pairKey)) {
        decision = "skipped_manual";
      } else if (suppressedPairs.has(pairKey)) {
        decision = "skipped_suppressed";
      } else if (match.confidence >= confidenceThreshold) {
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
    const decisionsInScope = new Set<MatchResultDecision>(["auto_link_upserted", "skipped_manual"]);
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
  if (upsertRows.length > 0 && staleAutoPairKeys.size > 0 && candidateRows.length > 0) {
    actionTaken = "upsert_auto_upsert_candidates_delete_stale_auto";
  } else if (upsertRows.length > 0 && candidateRows.length > 0) {
    actionTaken = "upsert_auto_upsert_candidates";
  } else if (upsertRows.length > 0 && staleAutoPairKeys.size > 0) {
    actionTaken = "upsert_and_delete_stale_auto";
  } else if (candidateRows.length > 0 && staleAutoPairKeys.size > 0) {
    actionTaken = "upsert_candidates_delete_stale_auto";
  } else if (upsertRows.length > 0) {
    actionTaken = "upsert_auto";
  } else if (candidateRows.length > 0) {
    actionTaken = "upsert_candidates";
  } else if (staleAutoPairKeys.size > 0) {
    actionTaken = "delete_stale_auto";
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

  for (const pairKey of staleAutoPairKeys) {
    const [assetId, consentId] = pairKey.split(":");
    await deleteAutoLinkPair(supabase, tenantId, projectId, assetId, consentId);
  }

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
) {
  const startedAt = performance.now();
  const resolved = await resolveJobCandidates(supabase, job, maxComparisonsPerJob);

  if (!resolved.eligible) {
    await completeFaceMatchJob(supabase, job.job_id);
    logWorkerDevelopment("job_metrics", {
      jobId: job.job_id,
      jobType: job.job_type,
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
  await completeFaceMatchJob(supabase, job.job_id);

  const scoredPairs = normalizeAutoMatcherMatches(matches).length;
  const totalDurationMs = performance.now() - startedAt;
  const pairsPerSecond = totalDurationMs > 0 ? (scoredPairs * 1000) / totalDurationMs : 0;
  logWorkerDevelopment("job_metrics", {
    jobId: job.job_id,
    jobType: job.job_type,
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

export async function runAutoMatchWorker(
  input: RunAutoMatchWorkerInput,
): Promise<RunAutoMatchWorkerResult> {
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
  const counters: RunAutoMatchWorkerResult = {
    claimed: claimedJobs.length,
    succeeded: 0,
    retried: 0,
    dead: 0,
    skippedIneligible: 0,
    scoredPairs: 0,
    candidatePairs: 0,
  };

  for (const job of claimedJobs) {
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
      if (result.skippedIneligible) {
        counters.skippedIneligible += 1;
      } else {
        counters.succeeded += 1;
      }
      counters.scoredPairs += result.scoredPairs;
      counters.candidatePairs += result.candidatePairs;
    } catch (error) {
      const retryable = isRetryableError(error);
      const failedJob = await failFaceMatchJob(
        supabase,
        job.job_id,
        toSafeErrorCode(error),
        toSafeErrorMessage(error),
        retryable,
      );

      if (failedJob.status === "queued") {
        counters.retried += 1;
      } else if (failedJob.status === "dead") {
        counters.dead += 1;
      }
    }
  }

  return counters;
}
