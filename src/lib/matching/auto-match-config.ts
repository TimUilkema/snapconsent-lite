import { HttpError } from "@/lib/http/errors";

const DEFAULT_THRESHOLD = 0.92;
const DEFAULT_REVIEW_MIN_CONFIDENCE = 0.3;
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_PROVIDER = "stub";
const MAX_RESULTS_PER_JOB = 5_000;

export type AutoMatchProvider = "stub" | "compreface";

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
  const apiKey = String(process.env.COMPREFACE_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) {
    throw new HttpError(
      500,
      "face_match_provider_not_configured",
      "CompreFace provider is selected but not fully configured.",
    );
  }

  return {
    baseUrl,
    apiKey,
    timeoutMs: getAutoMatchProviderTimeoutMs(),
  };
}
