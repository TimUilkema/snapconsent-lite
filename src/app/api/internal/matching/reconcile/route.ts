import { HttpError, jsonError } from "@/lib/http/errors";
import { runAutoMatchReconcile } from "@/lib/matching/auto-match-reconcile";

type ReconcileRequestBody = {
  lookbackMinutes?: number;
  batchSize?: number;
};

const DEFAULT_LOOKBACK_MINUTES = 180;
const DEFAULT_BATCH_SIZE = 150;

function getReconcileToken() {
  const token = process.env.MATCHING_RECONCILE_TOKEN;
  if (!token) {
    throw new HttpError(500, "reconcile_not_configured", "Matching reconcile token is not configured.");
  }

  return token;
}

function parseLookbackMinutes(body: ReconcileRequestBody | null) {
  const parsed = Number(body?.lookbackMinutes ?? DEFAULT_LOOKBACK_MINUTES);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_LOOKBACK_MINUTES;
  }

  return Math.floor(parsed);
}

function parseBatchSize(body: ReconcileRequestBody | null) {
  const parsed = Number(body?.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.floor(parsed);
}

export async function POST(request: Request) {
  try {
    const expectedToken = getReconcileToken();
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${expectedToken}`) {
      throw new HttpError(401, "unauthorized", "Unauthorized matching reconcile request.");
    }

    const body = (await request.json().catch(() => null)) as ReconcileRequestBody | null;
    const result = await runAutoMatchReconcile({
      lookbackMinutes: parseLookbackMinutes(body),
      batchSize: parseBatchSize(body),
    });

    return Response.json(
      {
        ok: true,
        scanned: result.scanned,
        enqueued: result.enqueued,
        requeued: result.requeued,
        already_processing: result.alreadyProcessing,
        already_queued: result.alreadyQueued,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
