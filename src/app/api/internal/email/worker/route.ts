import { getOutboundEmailWorkerToken } from "@/lib/email/outbound/config";
import { runOutboundEmailWorker } from "@/lib/email/outbound/worker";
import { HttpError, jsonError } from "@/lib/http/errors";

type WorkerRequestBody = {
  batchSize?: number;
  workerId?: string;
};

const DEFAULT_BATCH_SIZE = 25;

function parseBatchSize(body: WorkerRequestBody | null) {
  const parsed = Number(body?.batchSize ?? DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.floor(parsed);
}

export async function POST(request: Request) {
  try {
    const expectedToken = getOutboundEmailWorkerToken();
    const authHeader = request.headers.get("authorization") ?? "";
    if (authHeader !== `Bearer ${expectedToken}`) {
      throw new HttpError(401, "unauthorized", "Unauthorized outbound email worker request.");
    }

    const body = (await request.json().catch(() => null)) as WorkerRequestBody | null;
    const workerId = String(body?.workerId ?? "").trim() || `outbound-email-worker:${crypto.randomUUID()}`;
    const result = await runOutboundEmailWorker({
      workerId,
      batchSize: parseBatchSize(body),
    });

    return Response.json(
      {
        ok: true,
        claimed: result.claimed,
        sent: result.sent,
        retried: result.retried,
        cancelled: result.cancelled,
        dead: result.dead,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
