import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

type Args = {
  workerUri: string;
  token: string;
  workerCounts: number[];
  batchSizes: number[];
  rounds: number;
  maxPairs: number;
  maxJobs: number;
  maxSeconds: number;
  stopOnQueueEmpty: boolean;
  output: string;
  providerConcurrencyTag: string;
};

type WorkerResponse = {
  ok: boolean;
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  skipped_ineligible?: number;
  scored_pairs?: number;
  candidate_pairs?: number;
};

type RunTotals = {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  skippedIneligible: number;
  scoredPairs: number;
  candidatePairs: number;
  errors: number;
  elapsedMs: number;
  jobsPerSecond: number;
  pairsPerSecond: number;
  ticks: number;
  stopReason: "max_pairs" | "max_jobs" | "max_seconds" | "queue_empty";
  reachedPairTarget: boolean;
};

type RunResult = {
  providerConcurrencyTag: string;
  workers: number;
  batchSize: number;
  round: number;
  totals: RunTotals;
};

function parseCsvInts(value: string, fallback: number[]) {
  const parsed = String(value)
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item >= 1)
    .map((item) => Math.floor(item));
  return parsed.length > 0 ? Array.from(new Set(parsed)) : fallback;
}

function parseArgs(): Args {
  const raw = process.argv.slice(2);
  const values = new Map<string, string>();

  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (!token || !token.startsWith("--")) {
      continue;
    }
    const key = token.slice(2);
    const value = raw[i + 1];
    if (!value || value.startsWith("--")) {
      continue;
    }
    values.set(key, value);
    i += 1;
  }

  const workerUri = String(values.get("worker-uri") ?? "http://localhost:3000/api/internal/matching/worker").trim();
  const token = String(values.get("token") ?? process.env.MATCHING_WORKER_TOKEN ?? "").trim();
  const workerCounts = parseCsvInts(String(values.get("worker-counts") ?? "1,2,4"), [1, 2, 4]);
  const batchSizes = parseCsvInts(String(values.get("batch-sizes") ?? "5,10,20"), [5, 10, 20]);
  const rounds = Math.max(1, Math.floor(Number(values.get("rounds") ?? "2") || 2));
  const maxPairs = Math.max(1, Math.floor(Number(values.get("max-pairs") ?? "100") || 100));
  const maxJobs = Math.max(1, Math.floor(Number(values.get("max-jobs") ?? "500") || 500));
  const maxSeconds = Math.max(5, Math.floor(Number(values.get("max-seconds") ?? "180") || 180));
  const stopOnQueueEmpty = String(values.get("stop-on-queue-empty") ?? "true").trim().toLowerCase() !== "false";
  const output = String(values.get("output") ?? "").trim();
  const providerConcurrencyTag = String(values.get("provider-concurrency-tag") ?? "unset").trim() || "unset";

  if (!token) {
    throw new Error(
      "Usage: npx tsx scripts/benchmark-matching-queue.ts --token <MATCHING_WORKER_TOKEN> [--worker-uri http://localhost:3000/api/internal/matching/worker] [--worker-counts 1,2,4] [--batch-sizes 5,10,20] [--rounds 2] [--max-pairs 100] [--max-jobs 500] [--max-seconds 180] [--provider-concurrency-tag 12] [--stop-on-queue-empty true] [--output docs/rpi/.../queue-benchmark.json]"
      + "\nDefaults: --max-pairs 100 --max-jobs 500 --max-seconds 180 --stop-on-queue-empty true",
    );
  }

  return {
    workerUri,
    token,
    workerCounts,
    batchSizes,
    rounds,
    maxPairs,
    maxJobs,
    maxSeconds,
    stopOnQueueEmpty,
    output,
    providerConcurrencyTag,
  };
}

async function callWorker(workerUri: string, token: string, workerId: string, batchSize: number) {
  const response = await fetch(workerUri, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      workerId,
      batchSize,
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Worker request failed (${response.status}): ${text || response.statusText}`);
  }

  return (await response.json()) as WorkerResponse;
}

async function runSingleConfig(
  workerUri: string,
  token: string,
  workers: number,
  batchSize: number,
  maxPairs: number,
  maxJobs: number,
  maxSeconds: number,
): Promise<RunTotals> {
  const workerIds = Array.from({ length: workers }, (_, i) => `queue-bench-${workers}-${batchSize}-${i + 1}-${crypto.randomUUID()}`);

  let totalClaimed = 0;
  let totalSucceeded = 0;
  let totalRetried = 0;
  let totalDead = 0;
  let totalSkippedIneligible = 0;
  let totalScoredPairs = 0;
  let totalCandidatePairs = 0;
  let ticks = 0;
  let emptyTickStreak = 0;
  let errorCount = 0;
  let stopReason: RunTotals["stopReason"] = "max_seconds";

  const startedAt = performance.now();
  while (true) {
    ticks += 1;
    const results = await Promise.all(
      workerIds.map((workerId) =>
        callWorker(workerUri, token, workerId, batchSize).catch(() => {
          errorCount += 1;
          return {
            ok: false,
            claimed: 0,
            succeeded: 0,
            retried: 0,
            dead: 0,
            skipped_ineligible: 0,
            scored_pairs: 0,
            candidate_pairs: 0,
          };
        }),
      ),
    );

    const tickClaimed = results.reduce((sum, row) => sum + Number(row.claimed ?? 0), 0);
    const tickSucceeded = results.reduce((sum, row) => sum + Number(row.succeeded ?? 0), 0);
    const tickRetried = results.reduce((sum, row) => sum + Number(row.retried ?? 0), 0);
    const tickDead = results.reduce((sum, row) => sum + Number(row.dead ?? 0), 0);
    const tickSkipped = results.reduce((sum, row) => sum + Number(row.skipped_ineligible ?? 0), 0);
    const tickScoredPairs = results.reduce((sum, row) => sum + Number(row.scored_pairs ?? 0), 0);
    const tickCandidatePairs = results.reduce((sum, row) => sum + Number(row.candidate_pairs ?? 0), 0);

    totalClaimed += tickClaimed;
    totalSucceeded += tickSucceeded;
    totalRetried += tickRetried;
    totalDead += tickDead;
    totalSkippedIneligible += tickSkipped;
    totalScoredPairs += tickScoredPairs;
    totalCandidatePairs += tickCandidatePairs;

    if (tickClaimed === 0) {
      emptyTickStreak += 1;
    } else {
      emptyTickStreak = 0;
    }

    const elapsedSeconds = (performance.now() - startedAt) / 1000;
    if (totalScoredPairs >= maxPairs) {
      stopReason = "max_pairs";
      break;
    }
    if (totalSucceeded >= maxJobs) {
      stopReason = "max_jobs";
      break;
    }
    if (elapsedSeconds >= maxSeconds) {
      stopReason = "max_seconds";
      break;
    }
    if (emptyTickStreak >= 2) {
      stopReason = "queue_empty";
      break;
    }
  }

  const elapsedMs = Math.round(performance.now() - startedAt);
  return {
    claimed: totalClaimed,
    succeeded: totalSucceeded,
    retried: totalRetried,
    dead: totalDead,
    skippedIneligible: totalSkippedIneligible,
    scoredPairs: totalScoredPairs,
    candidatePairs: totalCandidatePairs,
    errors: errorCount,
    elapsedMs,
    jobsPerSecond: Number((totalSucceeded / Math.max(elapsedMs / 1000, 0.001)).toFixed(3)),
    pairsPerSecond: Number((totalScoredPairs / Math.max(elapsedMs / 1000, 0.001)).toFixed(3)),
    ticks,
    stopReason,
    reachedPairTarget: totalScoredPairs >= maxPairs,
  };
}

function summarizeRuns(runs: RunResult[]) {
  const groups = new Map<string, RunResult[]>();
  for (const run of runs) {
    const key = `${run.providerConcurrencyTag}|${run.workers}|${run.batchSize}`;
    const existing = groups.get(key) ?? [];
    existing.push(run);
    groups.set(key, existing);
  }

  const summary = Array.from(groups.values()).map((group) => {
    const sample = group[0] as RunResult;
    const values = group.map((item) => item.totals.jobsPerSecond);
    const pairValues = group.map((item) => item.totals.pairsPerSecond);
    const reachedTargetCount = group.filter((item) => item.totals.reachedPairTarget).length;
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      providerConcurrencyTag: sample.providerConcurrencyTag,
      workers: sample.workers,
      batchSize: sample.batchSize,
      rounds: group.length,
      avgJobsPerSecond: Number(avg.toFixed(3)),
      minJobsPerSecond: Number(Math.min(...values).toFixed(3)),
      maxJobsPerSecond: Number(Math.max(...values).toFixed(3)),
      avgPairsPerSecond: Number((pairValues.reduce((sum, value) => sum + value, 0) / pairValues.length).toFixed(3)),
      minPairsPerSecond: Number(Math.min(...pairValues).toFixed(3)),
      maxPairsPerSecond: Number(Math.max(...pairValues).toFixed(3)),
      reachedPairTargetRuns: reachedTargetCount,
      reachedPairTargetRate: Number((reachedTargetCount / group.length).toFixed(3)),
      avgSucceeded: Number(
        (
          group.reduce((sum, item) => sum + item.totals.succeeded, 0) / group.length
        ).toFixed(1),
      ),
      avgScoredPairs: Number(
        (
          group.reduce((sum, item) => sum + item.totals.scoredPairs, 0) / group.length
        ).toFixed(1),
      ),
      avgElapsedMs: Number(
        (
          group.reduce((sum, item) => sum + item.totals.elapsedMs, 0) / group.length
        ).toFixed(1),
      ),
      avgRetries: Number(
        (
          group.reduce((sum, item) => sum + item.totals.retried, 0) / group.length
        ).toFixed(1),
      ),
      avgDead: Number(
        (
          group.reduce((sum, item) => sum + item.totals.dead, 0) / group.length
        ).toFixed(1),
      ),
      avgErrors: Number(
        (
          group.reduce((sum, item) => sum + item.totals.errors, 0) / group.length
        ).toFixed(1),
      ),
    };
  });

  summary.sort((left, right) => right.avgPairsPerSecond - left.avgPairsPerSecond);
  return summary;
}

async function run() {
  const args = parseArgs();
  const runs: RunResult[] = [];
  let queueLikelyDepleted = false;

  console.log(
    `[config] providerConcurrencyTag=${args.providerConcurrencyTag} workerCounts=${args.workerCounts.join(",")} batchSizes=${args.batchSizes.join(",")} rounds=${args.rounds} maxPairs=${args.maxPairs} maxJobs=${args.maxJobs} maxSeconds=${args.maxSeconds} stopOnQueueEmpty=${args.stopOnQueueEmpty}`,
  );

  for (const batchSize of args.batchSizes) {
    if (queueLikelyDepleted && args.stopOnQueueEmpty) {
      break;
    }
    for (const workers of args.workerCounts) {
      if (queueLikelyDepleted && args.stopOnQueueEmpty) {
        break;
      }
      for (let round = 1; round <= args.rounds; round += 1) {
        console.log(`[run] workers=${workers} batchSize=${batchSize} round=${round} starting`);
        const totals = await runSingleConfig(
          args.workerUri,
          args.token,
          workers,
          batchSize,
          args.maxPairs,
          args.maxJobs,
          args.maxSeconds,
        );
        runs.push({
          providerConcurrencyTag: args.providerConcurrencyTag,
          workers,
          batchSize,
          round,
          totals,
        });
        console.log(
          `[run] workers=${workers} batchSize=${batchSize} round=${round} succeeded=${totals.succeeded} claimed=${totals.claimed} scored_pairs=${totals.scoredPairs} elapsed_ms=${totals.elapsedMs} jobs_per_sec=${totals.jobsPerSecond} pairs_per_sec=${totals.pairsPerSecond} stop_reason=${totals.stopReason}`,
        );
        if (totals.stopReason === "queue_empty" && !totals.reachedPairTarget) {
          queueLikelyDepleted = true;
          if (args.stopOnQueueEmpty) {
            console.log("[run] queue likely depleted before reaching pair target; stopping remaining matrix cells.");
            break;
          }
        }
      }
    }
  }

  const summary = summarizeRuns(runs);
  const best = summary[0] ?? null;
  const outputPath = args.output
    ? path.resolve(process.cwd(), args.output)
    : path.resolve(
      process.cwd(),
      "docs",
      "rpi",
      "017-face-result-geometry-and-embeddings",
      `benchmark-queue-${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
    );
  mkdirSync(path.dirname(outputPath), { recursive: true });

  const report = {
    generatedAt: new Date().toISOString(),
    benchmarkType: "matching-queue-throughput-matrix",
    config: {
      workerUri: args.workerUri,
      providerConcurrencyTag: args.providerConcurrencyTag,
      workerCounts: args.workerCounts,
      batchSizes: args.batchSizes,
      rounds: args.rounds,
      maxPairs: args.maxPairs,
      maxJobs: args.maxJobs,
      maxSeconds: args.maxSeconds,
      stopOnQueueEmpty: args.stopOnQueueEmpty,
    },
    matrixStats: {
      runCount: runs.length,
      depletedEarly: queueLikelyDepleted,
    },
    runs,
    summary,
    recommendation: best
      ? {
        providerConcurrencyTag: best.providerConcurrencyTag,
        workers: best.workers,
        batchSize: best.batchSize,
        avgJobsPerSecond: best.avgJobsPerSecond,
        avgPairsPerSecond: best.avgPairsPerSecond,
      }
      : null,
  };

  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[report] wrote queue benchmark report to ${outputPath}`);
  if (best) {
    console.log(
      `[best] providerConcurrencyTag=${best.providerConcurrencyTag} workers=${best.workers} batchSize=${best.batchSize} avg_jobs_per_sec=${best.avgJobsPerSecond} avg_pairs_per_sec=${best.avgPairsPerSecond}`,
    );
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
