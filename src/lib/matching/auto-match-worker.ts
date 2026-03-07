import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  getAutoMatchConfidenceThreshold,
  getAutoMatchMaxComparisonsPerJob,
} from "@/lib/matching/auto-match-config";
import type { FaceMatchJobType } from "@/lib/matching/auto-match-jobs";
import { getAutoMatcher, type AutoMatcher, type AutoMatcherCandidate, type AutoMatcherMatch } from "@/lib/matching/auto-matcher";
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
    });
  });

  return Array.from(byPair.values());
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

async function applyAutoMatches(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  candidates: AutoMatcherCandidate[],
  matcherVersion: string,
  confidenceThreshold: number,
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

  const nowIso = new Date().toISOString();
  const aboveThresholdPairs = Array.from(scoreByPair.values()).filter(
    (match) => match.confidence >= confidenceThreshold,
  ).length;
  const upsertRows = Array.from(scoreByPair.values())
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

  if (upsertRows.length > 0) {
    const { error: upsertError } = await supabase.from("asset_consent_links").upsert(upsertRows, {
      onConflict: "asset_id,consent_id",
    });

    if (upsertError) {
      throw new HttpError(500, "face_match_link_upsert_failed", "Unable to write auto consent links.");
    }
  }

  const staleAutoPairKeys = new Set<string>();
  Array.from(scoreByPair.values())
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

  let actionTaken = "no_write";
  if (upsertRows.length > 0 && staleAutoPairKeys.size > 0) {
    actionTaken = "upsert_and_delete_stale_auto";
  } else if (upsertRows.length > 0) {
    actionTaken = "upsert_auto";
  } else if (staleAutoPairKeys.size > 0) {
    actionTaken = "delete_stale_auto";
  }

  logWorkerDevelopment("auto_match_write_decision", {
    candidatePairs: candidatePairs.size,
    scoredPairs: scoreByPair.size,
    aboveThresholdPairs,
    threshold: confidenceThreshold,
    actionTaken,
  });

  for (const pairKey of staleAutoPairKeys) {
    const [assetId, consentId] = pairKey.split(":");
    await deleteAutoLinkPair(supabase, tenantId, projectId, assetId, consentId);
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
  maxComparisonsPerJob: number,
) {
  const resolved = await resolveJobCandidates(supabase, job, maxComparisonsPerJob);

  if (!resolved.eligible) {
    await completeFaceMatchJob(supabase, job.job_id);
    return { skippedIneligible: true };
  }

  const matches = await matcher.match({
    tenantId: job.tenant_id,
    projectId: job.project_id,
    jobType: job.job_type,
    candidates: resolved.candidates,
    supabase,
  });

  await applyAutoMatches(
    supabase,
    job.tenant_id,
    job.project_id,
    resolved.candidates,
    matcher.version,
    confidenceThreshold,
    matches,
  );
  await completeFaceMatchJob(supabase, job.job_id);
  return { skippedIneligible: false };
}

export async function runAutoMatchWorker(
  input: RunAutoMatchWorkerInput,
): Promise<RunAutoMatchWorkerResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const batchSize = normalizeBatchSize(input.batchSize);
  const confidenceThreshold = normalizeThreshold(input.confidenceThreshold);
  const maxComparisonsPerJob = normalizeMaxComparisons(input.maxComparisonsPerJob);
  const matcher = input.matcher ?? getAutoMatcher();
  const workerId = String(input.workerId ?? "").trim();
  if (!workerId) {
    throw new HttpError(400, "face_match_worker_id_required", "Worker ID is required.");
  }

  const claimedJobs = await claimFaceMatchJobs(supabase, workerId, batchSize);
  const counters: RunAutoMatchWorkerResult = {
    claimed: claimedJobs.length,
    succeeded: 0,
    retried: 0,
    dead: 0,
    skippedIneligible: 0,
  };

  for (const job of claimedJobs) {
    try {
      const result = await processClaimedFaceMatchJob(
        supabase,
        job,
        matcher,
        confidenceThreshold,
        maxComparisonsPerJob,
      );
      if (result.skippedIneligible) {
        counters.skippedIneligible += 1;
      } else {
        counters.succeeded += 1;
      }
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
