import type { SupabaseClient } from "@supabase/supabase-js";

export const OUTBOUND_EMAIL_KINDS = ["consent_receipt", "tenant_membership_invite"] as const;
export const OUTBOUND_EMAIL_JOB_STATUSES = ["pending", "processing", "sent", "cancelled", "dead"] as const;

export type OutboundEmailKind = (typeof OUTBOUND_EMAIL_KINDS)[number];
export type OutboundEmailJobStatus = (typeof OUTBOUND_EMAIL_JOB_STATUSES)[number];

export type RenderedOutboundEmail = {
  subject: string;
  text: string;
  html?: string | null;
};

export type OutboundEmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
};

export type OutboundEmailSendResult = {
  providerMessageId?: string | null;
};

export interface OutboundEmailTransport {
  send(message: OutboundEmailMessage): Promise<OutboundEmailSendResult>;
}

export type ConsentReceiptEmailPayload = {
  consentId: string;
  revokeToken: string;
  subjectName: string;
  subjectEmail: string;
  projectName: string;
  signedAtIso: string;
  consentText: string;
  consentVersion: string;
};

export type TenantMembershipInviteEmailPayload = {
  inviteId: string;
  tenantId: string;
  tenantName: string;
  invitedEmail: string;
  role: "admin" | "reviewer" | "photographer";
  inviteToken: string;
  expiresAtIso: string;
  lastSentAtIso: string;
  inviterDisplayName: string;
};

export type OutboundEmailPayloadByKind = {
  consent_receipt: ConsentReceiptEmailPayload;
  tenant_membership_invite: TenantMembershipInviteEmailPayload;
};

export type OutboundEmailValidationResult =
  | { valid: true }
  | { valid: false; errorCode: string; errorMessage: string };

export type OutboundEmailPostSendContext<K extends OutboundEmailKind> = {
  tenantId: string;
  jobId: string;
  payload: OutboundEmailPayloadByKind[K];
  supabase: SupabaseClient;
};

export type OutboundEmailValidationContext<K extends OutboundEmailKind> = {
  tenantId: string;
  jobId: string;
  payload: OutboundEmailPayloadByKind[K];
  supabase: SupabaseClient;
};

export type OutboundEmailRegistryEntry<K extends OutboundEmailKind> = {
  kind: K;
  buildDedupeKey(payload: OutboundEmailPayloadByKind[K]): string;
  getRecipient(payload: OutboundEmailPayloadByKind[K]): string;
  parsePayload(value: Record<string, unknown>): OutboundEmailPayloadByKind[K];
  render(payload: OutboundEmailPayloadByKind[K]): RenderedOutboundEmail;
  validateBeforeSend?(
    context: OutboundEmailValidationContext<K>,
  ): Promise<OutboundEmailValidationResult> | OutboundEmailValidationResult;
  afterSend?(context: OutboundEmailPostSendContext<K>): Promise<void> | void;
};

export type OutboundEmailJobRow = {
  id: string;
  tenant_id: string;
  email_kind: OutboundEmailKind;
  status: OutboundEmailJobStatus;
  dedupe_key: string;
  payload_json: Record<string, unknown>;
  to_email: string;
  from_email: string;
  rendered_subject: string | null;
  rendered_text: string | null;
  rendered_html: string | null;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  lease_expires_at: string | null;
  last_worker_id: string | null;
  last_attempted_at: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  dead_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ClaimedOutboundEmailJobRow = {
  job_id: string;
  tenant_id: string;
  email_kind: OutboundEmailKind;
  status: OutboundEmailJobStatus;
  dedupe_key: string;
  payload_json: Record<string, unknown> | null;
  to_email: string;
  from_email: string;
  rendered_subject: string | null;
  rendered_text: string | null;
  rendered_html: string | null;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  lease_expires_at: string | null;
  last_worker_id: string | null;
  last_attempted_at: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  sent_at: string | null;
  cancelled_at: string | null;
  dead_at: string | null;
  created_at: string;
  updated_at: string;
  reclaimed: boolean;
};
