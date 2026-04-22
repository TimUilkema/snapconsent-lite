import type { SupabaseClient } from "@supabase/supabase-js";

import { claimOutboundEmailJobs, dispatchClaimedOutboundEmailJob } from "@/lib/email/outbound/jobs";
import type { OutboundEmailTransport } from "@/lib/email/outbound/types";
import { HttpError } from "@/lib/http/errors";

const DEFAULT_BATCH_SIZE = 25;
const MAX_BATCH_SIZE = 200;

export type RunOutboundEmailWorkerResult = {
  claimed: number;
  sent: number;
  retried: number;
  cancelled: number;
  dead: number;
};

function normalizeBatchSize(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = Math.floor(value ?? DEFAULT_BATCH_SIZE);
  if (parsed <= 0) {
    return DEFAULT_BATCH_SIZE;
  }

  return Math.min(parsed, MAX_BATCH_SIZE);
}

export async function runOutboundEmailWorker(input: {
  workerId: string;
  batchSize?: number;
  transport?: OutboundEmailTransport;
  supabase?: SupabaseClient;
}): Promise<RunOutboundEmailWorkerResult> {
  const workerId = String(input.workerId ?? "").trim();
  if (!workerId) {
    throw new HttpError(400, "outbound_email_worker_id_required", "Worker ID is required.");
  }

  const claimedJobs = await claimOutboundEmailJobs({
    workerId,
    batchSize: normalizeBatchSize(input.batchSize),
    supabase: input.supabase,
  });

  const counters: RunOutboundEmailWorkerResult = {
    claimed: claimedJobs.length,
    sent: 0,
    retried: 0,
    cancelled: 0,
    dead: 0,
  };

  for (const job of claimedJobs) {
    const result = await dispatchClaimedOutboundEmailJob({
      job,
      transport: input.transport,
      supabase: input.supabase,
    });

    if (result.outcome === "sent") {
      counters.sent += 1;
    } else if (result.outcome === "retried") {
      counters.retried += 1;
    } else if (result.outcome === "cancelled") {
      counters.cancelled += 1;
    } else if (result.outcome === "dead") {
      counters.dead += 1;
    }
  }

  return counters;
}
