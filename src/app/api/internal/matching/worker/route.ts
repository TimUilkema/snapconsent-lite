import { HttpError, jsonError } from "@/lib/http/errors";
import { runAutoMatchWorker } from "@/lib/matching/auto-match-worker";

type WorkerRequestBody = {
  batchSize?: number;
  workerId?: string;
};

const DEFAULT_BATCH_SIZE = 25;

function getWorkerToken() {
  const token = process.env.MATCHING_WORKER_TOKEN;
  if (!token) {
    throw new HttpError(500, "worker_not_configured", "Matching worker token is not configured.");
  }

  return token;
}

function parseBatchSize(body: WorkerRequestBody | null) {
  const parsed = Number(body?.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.floor(parsed);
}

export async function POST(request: Request) {
  try {
    const expectedToken = getWorkerToken();
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${expectedToken}`) {
      throw new HttpError(401, "unauthorized", "Unauthorized matching worker request.");
    }

    const body = (await request.json().catch(() => null)) as WorkerRequestBody | null;
    const workerId = String(body?.workerId ?? "").trim() || `matching-worker:${crypto.randomUUID()}`;
    const result = await runAutoMatchWorker({
      workerId,
      batchSize: parseBatchSize(body),
    });

    return Response.json(
      {
        ok: true,
        claimed: result.claimed,
        succeeded: result.succeeded,
        retried: result.retried,
        dead: result.dead,
        skipped_ineligible: result.skippedIneligible,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
