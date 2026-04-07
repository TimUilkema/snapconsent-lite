import { HttpError } from "@/lib/http/errors";

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_REVIEW_MIN_CONFIDENCE = 0.25;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER_CONCURRENCY = 2;
const MAX_PROVIDER_CONCURRENCY = 16;
const DEFAULT_WORKER_CONCURRENCY = 1;
const MAX_WORKER_CONCURRENCY = 8;
const DEFAULT_JOB_LEASE_SECONDS = 900;
const MIN_JOB_LEASE_SECONDS = 60;
const MAX_JOB_LEASE_SECONDS = 3600;
const DEFAULT_PROVIDER = "stub";
const DEFAULT_PIPELINE_MODE = "materialized_apply";
const MAX_RESULTS_PER_JOB = 5_000;
const MATERIALIZER_VERSION = "face-materializer-v1";
const COMPARE_VERSION = "embedding-compare-v2";

export type AutoMatchProvider = "stub" | "compreface";
export type AutoMatchPipelineMode = "raw" | "materialized_shadow" | "materialized_apply";

function normalizeProvider(raw: string | undefined): AutoMatchProvider {
  const provider = String(raw ?? DEFAULT_PROVIDER)
    .trim()
    .toLowerCase();

  if (provider === "compreface") {
    return "compreface";
  }

  return "stub";
}

function parseBoundedNumber(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

export function getAutoMatchProvider(): AutoMatchProvider {
  return normalizeProvider(process.env.AUTO_MATCH_PROVIDER);
}

export function getAutoMatchPipelineMode(): AutoMatchPipelineMode {
  const normalized = String(process.env.AUTO_MATCH_PIPELINE_MODE ?? DEFAULT_PIPELINE_MODE)
    .trim()
    .toLowerCase();

  if (normalized === "raw") {
    return "materialized_apply";
  }

  if (normalized === "materialized_shadow") {
    return "materialized_shadow";
  }

  if (normalized === "materialized_apply") {
    return "materialized_apply";
  }

  return "raw";
}

export function getAutoMatchConfidenceThreshold() {
  return parseBoundedNumber(process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD, DEFAULT_THRESHOLD, 0, 1);
}

export function getAutoMatchReviewMinConfidence() {
  return parseBoundedNumber(
    process.env.AUTO_MATCH_REVIEW_MIN_CONFIDENCE,
    DEFAULT_REVIEW_MIN_CONFIDENCE,
    0,
    1,
  );
}

export function getAutoMatchProviderTimeoutMs() {
  return Math.floor(parseBoundedNumber(process.env.AUTO_MATCH_PROVIDER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, 250, MAX_TIMEOUT_MS));
}

export function getAutoMatchProviderConcurrency() {
  return Math.floor(
    parseBoundedNumber(
      process.env.AUTO_MATCH_PROVIDER_CONCURRENCY,
      DEFAULT_PROVIDER_CONCURRENCY,
      1,
      MAX_PROVIDER_CONCURRENCY,
    ),
  );
}

export function getAutoMatchWorkerConcurrency() {
  return Math.floor(
    parseBoundedNumber(
      process.env.AUTO_MATCH_WORKER_CONCURRENCY,
      DEFAULT_WORKER_CONCURRENCY,
      1,
      MAX_WORKER_CONCURRENCY,
    ),
  );
}

export function getAutoMatchJobLeaseSeconds() {
  return Math.floor(
    parseBoundedNumber(
      process.env.AUTO_MATCH_JOB_LEASE_SECONDS,
      DEFAULT_JOB_LEASE_SECONDS,
      MIN_JOB_LEASE_SECONDS,
      MAX_JOB_LEASE_SECONDS,
    ),
  );
}

export function getAutoMatchMaxComparisonsPerJob() {
  const parsed = Number(process.env.AUTO_MATCH_MAX_COMPARISONS_PER_JOB ?? "");
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return null;
  }

  return normalized;
}

export function getAutoMatchPersistResults() {
  return parseBoolean(process.env.AUTO_MATCH_PERSIST_RESULTS, false);
}

export function getAutoMatchPersistFaceEvidence() {
  return parseBoolean(process.env.AUTO_MATCH_PERSIST_FACE_EVIDENCE, false);
}

export function getAutoMatchResultsMaxPerJob() {
  const parsed = Number(process.env.AUTO_MATCH_RESULTS_MAX_PER_JOB ?? "");
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return null;
  }

  return Math.min(normalized, MAX_RESULTS_PER_JOB);
}

export function getCompreFaceConfig() {
  const baseUrl = String(process.env.COMPREFACE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const verificationApiKey = String(
    process.env.COMPREFACE_VERIFICATION_API_KEY ?? process.env.COMPREFACE_API_KEY ?? "",
  ).trim();
  const detectionApiKey = String(
    process.env.COMPREFACE_DETECTION_API_KEY ?? verificationApiKey,
  ).trim();

  if (!baseUrl || !verificationApiKey || !detectionApiKey) {
    throw new HttpError(
      500,
      "face_match_provider_not_configured",
      "CompreFace provider is selected but not fully configured.",
    );
  }

  return {
    baseUrl,
    verificationApiKey,
    detectionApiKey,
    timeoutMs: getAutoMatchProviderTimeoutMs(),
  };
}

export function getAutoMatchMaterializerVersion() {
  return MATERIALIZER_VERSION;
}

export function getAutoMatchCompareVersion() {
  return COMPARE_VERSION;
}
