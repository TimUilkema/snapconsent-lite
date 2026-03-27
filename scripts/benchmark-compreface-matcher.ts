import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AutoMatcherCandidate } from "../src/lib/matching/auto-matcher";
import { createCompreFaceAutoMatcher } from "../src/lib/matching/providers/compreface";

type BenchmarkArgs = {
  tenantId: string;
  projectId: string;
  consentId: string;
  limit: number;
  runs: number;
  concurrencies: number[];
  output: string;
};

type BenchmarkRunResult = {
  run: number;
  durationMs: number;
  pairsPerSecond: number;
  positiveMatches: number;
};

type BenchmarkSummaryResult = {
  concurrency: number;
  candidateCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  avgPairsPerSecond: number;
  minPairsPerSecond: number;
  maxPairsPerSecond: number;
  avgPositiveMatches: number;
  runs: BenchmarkRunResult[];
};

function parseDotEnvLine(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFromLocalFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const result = new Map<string, string>();

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = parseDotEnvLine(trimmed.slice(delimiterIndex + 1));
    result.set(key, value);
  });

  return result;
}

function requireEnv(name: string, envFromFile: Map<string, string>) {
  const runtimeValue = process.env[name];
  if (runtimeValue && runtimeValue.trim().length > 0) {
    return runtimeValue.trim();
  }

  const fileValue = envFromFile.get(name);
  if (fileValue && fileValue.trim().length > 0) {
    return fileValue.trim();
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function parseArgs(): BenchmarkArgs {
  const rawArgs = process.argv.slice(2);
  const values = new Map<string, string>();

  for (let index = 0; index < rawArgs.length; index += 1) {
    const token = rawArgs[index];
    if (!token.startsWith("--")) {
      continue;
    }

    const key = token.slice(2);
    const value = rawArgs[index + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }
    values.set(key, value);
    index += 1;
  }

  const tenantId = String(values.get("tenant-id") ?? "").trim();
  const projectId = String(values.get("project-id") ?? "").trim();
  const consentId = String(values.get("consent-id") ?? "").trim();
  if (!tenantId || !projectId || !consentId) {
    throw new Error(
      "Usage: npx tsx scripts/benchmark-compreface-matcher.ts --tenant-id <uuid> --project-id <uuid> --consent-id <uuid> [--limit 180] [--runs 3] [--concurrency 1,2,4,8] [--output docs/rpi/.../benchmark.json]",
    );
  }

  const limit = Math.max(1, Number(values.get("limit") ?? "180") || 180);
  const runs = Math.max(1, Number(values.get("runs") ?? "3") || 3);
  const output = String(values.get("output") ?? "").trim();
  const concurrencies = String(values.get("concurrency") ?? "1,2,4,8")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 16)
    .map((value) => Math.floor(value));

  if (concurrencies.length === 0) {
    throw new Error("Provide at least one valid concurrency value between 1 and 16.");
  }

  return {
    tenantId,
    projectId,
    consentId,
    limit,
    runs,
    concurrencies: Array.from(new Set(concurrencies)),
    output,
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[position] ?? 0;
}

async function loadBenchmarkCandidates(
  supabase: SupabaseClient,
  args: BenchmarkArgs,
): Promise<AutoMatcherCandidate[]> {
  const { data: consent, error: consentError } = await supabase
    .from("consents")
    .select("id, face_match_opt_in, revoked_at")
    .eq("tenant_id", args.tenantId)
    .eq("project_id", args.projectId)
    .eq("id", args.consentId)
    .maybeSingle();
  if (consentError) {
    throw new Error(`Unable to load consent: ${consentError.message}`);
  }
  if (!consent || !consent.face_match_opt_in || consent.revoked_at) {
    throw new Error("Consent is not eligible for face matching (missing/opt-out/revoked).");
  }

  const { data: links, error: linksError } = await supabase
    .from("asset_consent_links")
    .select("asset_id")
    .eq("tenant_id", args.tenantId)
    .eq("project_id", args.projectId)
    .eq("consent_id", args.consentId);
  if (linksError) {
    throw new Error(`Unable to load consent links: ${linksError.message}`);
  }

  const headshotIds = Array.from(new Set((links ?? []).map((link) => link.asset_id)));
  if (headshotIds.length === 0) {
    throw new Error("No headshot link found for this consent.");
  }

  const { data: headshots, error: headshotError } = await supabase
    .from("assets")
    .select("id, storage_bucket, storage_path, uploaded_at")
    .eq("tenant_id", args.tenantId)
    .eq("project_id", args.projectId)
    .eq("asset_type", "headshot")
    .eq("status", "uploaded")
    .in("id", headshotIds)
    .order("uploaded_at", { ascending: false })
    .limit(1);
  if (headshotError) {
    throw new Error(`Unable to load headshot: ${headshotError.message}`);
  }
  const headshot = headshots?.[0];
  if (!headshot?.storage_bucket || !headshot.storage_path) {
    throw new Error("No uploaded headshot with storage path found.");
  }

  const { data: photos, error: photosError } = await supabase
    .from("assets")
    .select("id, storage_bucket, storage_path")
    .eq("tenant_id", args.tenantId)
    .eq("project_id", args.projectId)
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .limit(args.limit);
  if (photosError) {
    throw new Error(`Unable to load project photos: ${photosError.message}`);
  }

  return (photos ?? [])
    .filter((photo) => photo.storage_bucket && photo.storage_path)
    .map((photo) => ({
      assetId: photo.id,
      consentId: args.consentId,
      photo: {
        storageBucket: photo.storage_bucket as string,
        storagePath: photo.storage_path as string,
      },
      headshot: {
        storageBucket: headshot.storage_bucket as string,
        storagePath: headshot.storage_path as string,
      },
    }));
}

async function run() {
  const args = parseArgs();
  const envFromFile = loadEnvFromLocalFile();
  const processEnv = process.env as Record<string, string | undefined>;

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", envFromFile);
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFromFile);
  processEnv.NODE_ENV = processEnv.NODE_ENV ?? "production";
  processEnv.COMPREFACE_BASE_URL = requireEnv("COMPREFACE_BASE_URL", envFromFile);
  processEnv.COMPREFACE_API_KEY = requireEnv("COMPREFACE_API_KEY", envFromFile);
  processEnv.AUTO_MATCH_PROVIDER_TIMEOUT_MS = processEnv.AUTO_MATCH_PROVIDER_TIMEOUT_MS ?? "30000";

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const candidates = await loadBenchmarkCandidates(supabase, args);
  if (candidates.length === 0) {
    throw new Error("No candidate photos found for this project.");
  }

  console.log(`Benchmark candidates: ${candidates.length}`);
  console.log(`Runs per concurrency: ${args.runs}`);
  console.log(`Concurrency sweep: ${args.concurrencies.join(", ")}`);

  const summaries: BenchmarkSummaryResult[] = [];
  for (const concurrency of args.concurrencies) {
    process.env.AUTO_MATCH_PROVIDER_CONCURRENCY = String(concurrency);
    const matcher = createCompreFaceAutoMatcher();
    const durationsMs: number[] = [];
    const runResults: BenchmarkRunResult[] = [];

    for (let runIndex = 0; runIndex < args.runs; runIndex += 1) {
      const startedAt = performance.now();
      const matches = await matcher.match({
        tenantId: args.tenantId,
        projectId: args.projectId,
        jobType: "consent_headshot_ready",
        candidates,
        supabase,
      });
      const durationMs = performance.now() - startedAt;
      durationsMs.push(durationMs);

      const positiveMatches = matches.filter((match) => match.confidence > 0).length;
      const throughput = durationMs > 0 ? (matches.length * 1000) / durationMs : 0;
      runResults.push({
        run: runIndex + 1,
        durationMs,
        pairsPerSecond: throughput,
        positiveMatches,
      });
      console.log(
        `[run ${runIndex + 1}/${args.runs}] concurrency=${concurrency} duration_ms=${Math.round(durationMs)} pairs_per_sec=${throughput.toFixed(2)} positive_matches=${positiveMatches}`,
      );
    }

    const avgMs = durationsMs.reduce((sum, value) => sum + value, 0) / durationsMs.length;
    const p50Ms = percentile(durationsMs, 0.5);
    const p95Ms = percentile(durationsMs, 0.95);
    const avgThroughput = avgMs > 0 ? (candidates.length * 1000) / avgMs : 0;
    const minThroughput = Math.min(...runResults.map((runResult) => runResult.pairsPerSecond));
    const maxThroughput = Math.max(...runResults.map((runResult) => runResult.pairsPerSecond));
    const avgPositiveMatches = runResults.reduce((sum, runResult) => sum + runResult.positiveMatches, 0) / runResults.length;

    summaries.push({
      concurrency,
      candidateCount: candidates.length,
      avgMs,
      p50Ms,
      p95Ms,
      avgPairsPerSecond: avgThroughput,
      minPairsPerSecond: minThroughput,
      maxPairsPerSecond: maxThroughput,
      avgPositiveMatches,
      runs: runResults,
    });

    console.log(
      `[summary] concurrency=${concurrency} avg_ms=${Math.round(avgMs)} p50_ms=${Math.round(p50Ms)} p95_ms=${Math.round(p95Ms)} avg_pairs_per_sec=${avgThroughput.toFixed(2)}`,
    );
  }

  const best = [...summaries].sort((left, right) => right.avgPairsPerSecond - left.avgPairsPerSecond)[0] ?? null;
  const sortedByConcurrency = [...summaries].sort((left, right) => left.concurrency - right.concurrency);
  let saturationConcurrency: number | null = null;
  for (let index = 1; index < sortedByConcurrency.length; index += 1) {
    const previous = sortedByConcurrency[index - 1] as BenchmarkSummaryResult;
    const current = sortedByConcurrency[index] as BenchmarkSummaryResult;
    const throughputDelta = previous.avgPairsPerSecond > 0
      ? (current.avgPairsPerSecond - previous.avgPairsPerSecond) / previous.avgPairsPerSecond
      : 0;
    const latencyDelta = previous.avgMs > 0
      ? (current.avgMs - previous.avgMs) / previous.avgMs
      : 0;
    if (throughputDelta < -0.05 && latencyDelta > 0.2) {
      saturationConcurrency = previous.concurrency;
      break;
    }
  }

  const outputPath = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.resolve(
      process.cwd(),
      "docs",
      "rpi",
      "017-face-result-geometry-and-embeddings",
      `benchmark-compreface-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    benchmarkType: "compreface-matcher-throughput",
    scope: {
      tenantId: args.tenantId,
      projectId: args.projectId,
      consentId: args.consentId,
      candidateCount: candidates.length,
    },
    config: {
      concurrencies: args.concurrencies,
      runs: args.runs,
      limit: args.limit,
      autoMatchProviderConcurrencyAtStart: process.env.AUTO_MATCH_PROVIDER_CONCURRENCY ?? null,
      providerBaseUrl: process.env.COMPREFACE_BASE_URL ?? null,
    },
    summaries,
    recommendation: best
      ? {
        bestConcurrency: best.concurrency,
        bestAvgPairsPerSecond: Number(best.avgPairsPerSecond.toFixed(3)),
        bestAvgDurationMs: Number(best.avgMs.toFixed(1)),
        saturationConcurrency,
      }
      : null,
  };
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[report] wrote benchmark report to ${outputPath}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
