import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getOutboundEmailConfig } from "@/lib/email/outbound/config";
import { getOutboundEmailRegistryEntry, runOutboundEmailAfterSendHook } from "@/lib/email/outbound/registry";
import { createSmtpOutboundEmailTransport } from "@/lib/email/outbound/smtp-transport";
import type {
  ClaimedOutboundEmailJobRow,
  OutboundEmailKind,
  OutboundEmailPayloadByKind,
  OutboundEmailTransport,
} from "@/lib/email/outbound/types";
import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";

type EnqueueResultRow = {
  job_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  sent_at: string | null;
  cancelled_at: string | null;
  dead_at: string | null;
  enqueued: boolean;
};

type CompleteResultRow = {
  job_id: string;
  status: string;
  sent_at: string;
  updated_at: string;
};

type FailResultRow = {
  job_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  last_error_code: string | null;
  last_error_message: string | null;
  updated_at: string;
};

type CancelResultRow = {
  job_id: string;
  status: string;
  cancelled_at: string;
  updated_at: string;
};

export type EnqueueOutboundEmailJobResult = {
  jobId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  sentAt: string | null;
  cancelledAt: string | null;
  deadAt: string | null;
  enqueued: boolean;
};

export type DispatchOutboundEmailJobResult =
  | { outcome: "sent"; jobId: string; providerMessageId: string | null }
  | { outcome: "retried"; jobId: string }
  | { outcome: "dead"; jobId: string }
  | { outcome: "cancelled"; jobId: string }
  | { outcome: "not_claimed"; jobId: string };

function getInternalSupabaseClient(supabase?: SupabaseClient) {
  if (supabase) {
    return supabase;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function toSafeErrorMessage(error: unknown) {
  if (error instanceof HttpError) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Unknown outbound email error.";
}

function toSafeErrorCode(error: unknown) {
  if (error instanceof HttpError) {
    return error.code;
  }

  if (error instanceof Error) {
    return normalizePostgrestError(error, "outbound_email_dispatch_failed").code;
  }

  return "outbound_email_dispatch_failed";
}

function isRetryableError(error: unknown) {
  if (error instanceof HttpError) {
    return error.status >= 500;
  }

  return true;
}

function normalizeWorkerId(workerId: string | null | undefined, prefix: string) {
  const normalized = String(workerId ?? "").trim();
  return normalized.length > 0 ? normalized : `${prefix}:${randomUUID()}`;
}

function createDefaultTransport() {
  return createSmtpOutboundEmailTransport(getOutboundEmailConfig());
}

export async function enqueueOutboundEmailJob<K extends OutboundEmailKind>(input: {
  tenantId: string;
  emailKind: K;
  payload: OutboundEmailPayloadByKind[K];
  maxAttempts?: number;
  runAfter?: string | null;
  supabase?: SupabaseClient;
}): Promise<EnqueueOutboundEmailJobResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const config = getOutboundEmailConfig();
  const entry = getOutboundEmailRegistryEntry(input.emailKind);
  const dedupeKey = entry.buildDedupeKey(input.payload);
  const toEmail = entry.getRecipient(input.payload);

  let initialStatus: "pending" | "dead" = "pending";
  let renderedSubject: string | null = null;
  let renderedText: string | null = null;
  let renderedHtml: string | null = null;
  let errorCode: string | null = null;
  let errorMessage: string | null = null;

  try {
    const rendered = entry.render(input.payload);
    renderedSubject = rendered.subject;
    renderedText = rendered.text;
    renderedHtml = rendered.html ?? null;
  } catch (error) {
    initialStatus = "dead";
    errorCode = toSafeErrorCode(error);
    errorMessage = toSafeErrorMessage(error);
  }

  const { data, error } = await supabase.rpc("enqueue_outbound_email_job", {
    p_tenant_id: input.tenantId,
    p_email_kind: input.emailKind,
    p_dedupe_key: dedupeKey,
    p_payload_json: input.payload,
    p_to_email: toEmail,
    p_from_email: config.smtpFrom,
    p_rendered_subject: renderedSubject,
    p_rendered_text: renderedText,
    p_rendered_html: renderedHtml,
    p_max_attempts: input.maxAttempts ?? 5,
    p_run_after: input.runAfter ?? null,
    p_initial_status: initialStatus,
    p_error_code: errorCode,
    p_error_message: errorMessage,
  });

  if (error) {
    throw new HttpError(500, "outbound_email_enqueue_failed", "Unable to enqueue outbound email job.");
  }

  const row = (data?.[0] ?? null) as EnqueueResultRow | null;
  if (!row) {
    throw new HttpError(500, "outbound_email_enqueue_failed", "Unable to enqueue outbound email job.");
  }

  return {
    jobId: row.job_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    sentAt: row.sent_at,
    cancelledAt: row.cancelled_at,
    deadAt: row.dead_at,
    enqueued: row.enqueued,
  };
}

async function claimOutboundEmailJobById(input: {
  tenantId: string;
  jobId: string;
  workerId: string;
  leaseSeconds?: number;
  supabase?: SupabaseClient;
}) {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("claim_outbound_email_job_by_id", {
    p_job_id: input.jobId,
    p_tenant_id: input.tenantId,
    p_worker_id: input.workerId,
    p_lease_seconds: input.leaseSeconds ?? 300,
  });

  if (error) {
    throw new HttpError(500, "outbound_email_claim_failed", "Unable to claim outbound email job.");
  }

  return ((data?.[0] ?? null) as ClaimedOutboundEmailJobRow | null) ?? null;
}

export async function claimOutboundEmailJobs(input: {
  workerId: string;
  batchSize?: number;
  leaseSeconds?: number;
  supabase?: SupabaseClient;
}) {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("claim_outbound_email_jobs", {
    p_worker_id: input.workerId,
    p_batch_size: input.batchSize ?? 25,
    p_lease_seconds: input.leaseSeconds ?? 300,
  });

  if (error) {
    throw new HttpError(500, "outbound_email_claim_failed", "Unable to claim outbound email jobs.");
  }

  return ((data ?? []) as ClaimedOutboundEmailJobRow[]) ?? [];
}

async function completeOutboundEmailJob(input: {
  jobId: string;
  workerId: string;
  providerMessageId?: string | null;
  supabase?: SupabaseClient;
}) {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("complete_outbound_email_job", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_provider_message_id: input.providerMessageId ?? null,
  });

  if (error) {
    throw new HttpError(500, "outbound_email_complete_failed", "Unable to complete outbound email job.");
  }

  return ((data?.[0] ?? null) as CompleteResultRow | null) ?? null;
}

async function failOutboundEmailJob(input: {
  jobId: string;
  workerId: string;
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
  supabase?: SupabaseClient;
}) {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("fail_outbound_email_job", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable,
    p_retry_delay_seconds: null,
  });

  if (error) {
    throw new HttpError(500, "outbound_email_fail_failed", "Unable to update outbound email failure state.");
  }

  return ((data?.[0] ?? null) as FailResultRow | null) ?? null;
}

async function cancelOutboundEmailJob(input: {
  jobId: string;
  workerId: string;
  errorCode: string;
  errorMessage: string;
  supabase?: SupabaseClient;
}) {
  const supabase = getInternalSupabaseClient(input.supabase);
  const { data, error } = await supabase.rpc("cancel_outbound_email_job", {
    p_job_id: input.jobId,
    p_worker_id: input.workerId,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
  });

  if (error) {
    throw new HttpError(500, "outbound_email_cancel_failed", "Unable to cancel outbound email job.");
  }

  return ((data?.[0] ?? null) as CancelResultRow | null) ?? null;
}

export async function dispatchClaimedOutboundEmailJob(input: {
  job: ClaimedOutboundEmailJobRow;
  transport?: OutboundEmailTransport;
  supabase?: SupabaseClient;
}): Promise<DispatchOutboundEmailJobResult> {
  const supabase = getInternalSupabaseClient(input.supabase);
  const transport = input.transport ?? createDefaultTransport();
  const workerId = normalizeWorkerId(input.job.last_worker_id, "outbound-email-dispatch");
  const kind = input.job.email_kind;
  const entry = getOutboundEmailRegistryEntry(kind);

  try {
    const payload = entry.parsePayload((input.job.payload_json ?? {}) as Record<string, unknown>);

    if (entry.validateBeforeSend) {
      const validation = await entry.validateBeforeSend({
        tenantId: input.job.tenant_id,
        jobId: input.job.job_id,
        payload,
        supabase,
      } as never);

      if (!validation.valid) {
        const cancelled = await cancelOutboundEmailJob({
          jobId: input.job.job_id,
          workerId,
          errorCode: validation.errorCode,
          errorMessage: validation.errorMessage,
          supabase,
        });

        if (!cancelled) {
          return { outcome: "not_claimed", jobId: input.job.job_id };
        }

        return { outcome: "cancelled", jobId: input.job.job_id };
      }
    }

    if (!input.job.rendered_subject || !input.job.rendered_text) {
      const failed = await failOutboundEmailJob({
        jobId: input.job.job_id,
        workerId,
        errorCode: "outbound_email_missing_rendered_content",
        errorMessage: "Outbound email job is missing rendered content.",
        retryable: false,
        supabase,
      });

      if (!failed) {
        return { outcome: "not_claimed", jobId: input.job.job_id };
      }

      return { outcome: "dead", jobId: input.job.job_id };
    }

    const sendResult = await transport.send({
      from: input.job.from_email,
      to: input.job.to_email,
      subject: input.job.rendered_subject,
      text: input.job.rendered_text,
      html: input.job.rendered_html,
    });

    const completed = await completeOutboundEmailJob({
      jobId: input.job.job_id,
      workerId,
      providerMessageId: sendResult.providerMessageId ?? null,
      supabase,
    });

    if (!completed) {
      return { outcome: "not_claimed", jobId: input.job.job_id };
    }

    try {
      await runOutboundEmailAfterSendHook(kind, {
        tenantId: input.job.tenant_id,
        jobId: input.job.job_id,
        payload,
        supabase,
      } as never);
    } catch (error) {
      console.error("outbound_email_after_send_failed", {
        jobId: input.job.job_id,
        emailKind: kind,
        errorCode: toSafeErrorCode(error),
        errorMessage: toSafeErrorMessage(error),
      });
    }

    return {
      outcome: "sent",
      jobId: input.job.job_id,
      providerMessageId: sendResult.providerMessageId ?? null,
    };
  } catch (error) {
    const failed = await failOutboundEmailJob({
      jobId: input.job.job_id,
      workerId,
      errorCode: toSafeErrorCode(error),
      errorMessage: toSafeErrorMessage(error),
      retryable: isRetryableError(error),
      supabase,
    });

    if (!failed) {
      return { outcome: "not_claimed", jobId: input.job.job_id };
    }

    return {
      outcome: failed.status === "dead" ? "dead" : "retried",
      jobId: input.job.job_id,
    };
  }
}

export async function dispatchOutboundEmailJobById(input: {
  tenantId: string;
  jobId: string;
  workerId?: string;
  transport?: OutboundEmailTransport;
  supabase?: SupabaseClient;
}): Promise<DispatchOutboundEmailJobResult> {
  const workerId = normalizeWorkerId(input.workerId, "outbound-email-dispatch");
  const claimed = await claimOutboundEmailJobById({
    tenantId: input.tenantId,
    jobId: input.jobId,
    workerId,
    supabase: input.supabase,
  });

  if (!claimed) {
    return { outcome: "not_claimed", jobId: input.jobId };
  }

  return dispatchClaimedOutboundEmailJob({
    job: claimed,
    transport: input.transport,
    supabase: input.supabase,
  });
}

export async function enqueueConsentReceiptEmailJob(input: {
  tenantId: string;
  payload: OutboundEmailPayloadByKind["consent_receipt"];
  supabase?: SupabaseClient;
}) {
  return enqueueOutboundEmailJob({
    tenantId: input.tenantId,
    emailKind: "consent_receipt",
    payload: input.payload,
    supabase: input.supabase,
  });
}

export async function enqueueTenantMembershipInviteEmailJob(input: {
  tenantId: string;
  payload: OutboundEmailPayloadByKind["tenant_membership_invite"];
  supabase?: SupabaseClient;
}) {
  return enqueueOutboundEmailJob({
    tenantId: input.tenantId,
    emailKind: "tenant_membership_invite",
    payload: input.payload,
    supabase: input.supabase,
  });
}
