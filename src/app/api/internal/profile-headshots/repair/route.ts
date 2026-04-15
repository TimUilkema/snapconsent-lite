import { HttpError, jsonError } from "@/lib/http/errors";
import { processRecurringProfileHeadshotRepairJobs } from "@/lib/profiles/profile-headshot-service";
import { createAdminClient } from "@/lib/supabase/admin";

type RepairRequestBody = {
  batchSize?: number;
  workerId?: string;
};

const DEFAULT_BATCH_SIZE = 10;

function getWorkerToken() {
  const token = process.env.MATCHING_WORKER_TOKEN;
  if (!token) {
    throw new HttpError(500, "worker_not_configured", "Matching worker token is not configured.");
  }

  return token;
}

function parseBatchSize(body: RepairRequestBody | null) {
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
      throw new HttpError(401, "unauthorized", "Unauthorized recurring headshot repair request.");
    }

    const body = (await request.json().catch(() => null)) as RepairRequestBody | null;
    const workerId = String(body?.workerId ?? "").trim() || `profile-headshot-repair:${crypto.randomUUID()}`;
    const supabase = createAdminClient();
    const result = await processRecurringProfileHeadshotRepairJobs({
      supabase,
      lockedBy: workerId,
      batchSize: parseBatchSize(body),
    });

    return Response.json(
      {
        ok: true,
        processed: result.processedCount,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
