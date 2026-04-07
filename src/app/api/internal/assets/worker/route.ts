import { HttpError, jsonError } from "@/lib/http/errors";
import { getAssetImageDerivativeQueueSummary } from "@/lib/assets/asset-image-derivatives";
import { runAssetImageDerivativeWorker } from "@/lib/assets/asset-image-derivative-worker";

type WorkerRequestBody = {
  batchSize?: number;
  workerId?: string;
};

const DEFAULT_BATCH_SIZE = 25;

function getWorkerToken() {
  const token = process.env.ASSET_DERIVATIVE_WORKER_TOKEN;
  if (!token) {
    throw new HttpError(500, "worker_not_configured", "Asset derivative worker token is not configured.");
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

function isAuthorizedInternalRequest(authHeader: string | null, expectedToken: string) {
  const normalized = String(authHeader ?? "").trim();
  if (!normalized) {
    return false;
  }

  if (normalized === expectedToken) {
    return true;
  }

  return normalized === `Bearer ${expectedToken}`;
}

export async function POST(request: Request) {
  try {
    const expectedToken = getWorkerToken();
    const authHeader = request.headers.get("authorization");
    if (!isAuthorizedInternalRequest(authHeader, expectedToken)) {
      throw new HttpError(401, "unauthorized", "Unauthorized asset worker request.");
    }

    const body = (await request.json().catch(() => null)) as WorkerRequestBody | null;
    const workerId = String(body?.workerId ?? "").trim() || `asset-derivative-worker:${crypto.randomUUID()}`;
    const result = await runAssetImageDerivativeWorker({
      workerId,
      batchSize: parseBatchSize(body),
    });
    const queue = await getAssetImageDerivativeQueueSummary();

    return Response.json(
      {
        ok: true,
        claimed: result.claimed,
        worker_concurrency: result.workerConcurrency,
        succeeded: result.succeeded,
        retried: result.retried,
        dead: result.dead,
        queue,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
