import type { SupabaseClient } from "@supabase/supabase-js";

import { markReceiptSent } from "@/lib/consent/submit-consent";
import { renderConsentReceiptEmail } from "@/lib/email/outbound/renderers/consent-receipt";
import { renderTenantMembershipInviteEmail } from "@/lib/email/outbound/renderers/tenant-membership-invite";
import type {
  ConsentReceiptEmailPayload,
  OutboundEmailKind,
  OutboundEmailPayloadByKind,
  OutboundEmailRegistryEntry,
  TenantMembershipInviteEmailPayload,
} from "@/lib/email/outbound/types";
import { HttpError } from "@/lib/http/errors";

function requireString(value: unknown, field: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    throw new HttpError(500, "outbound_email_invalid_payload", `Outbound email payload field ${field} is required.`);
  }

  return normalized;
}

function parseConsentReceiptPayload(value: Record<string, unknown>): ConsentReceiptEmailPayload {
  return {
    consentId: requireString(value.consentId, "consentId"),
    revokeToken: requireString(value.revokeToken, "revokeToken"),
    subjectName: requireString(value.subjectName, "subjectName"),
    subjectEmail: requireString(value.subjectEmail, "subjectEmail"),
    projectName: requireString(value.projectName, "projectName"),
    signedAtIso: requireString(value.signedAtIso, "signedAtIso"),
    consentText: requireString(value.consentText, "consentText"),
    consentVersion: requireString(value.consentVersion, "consentVersion"),
  };
}

function requireRole(value: unknown, field: string): TenantMembershipInviteEmailPayload["role"] {
  const normalized = requireString(value, field);
  if (normalized === "admin" || normalized === "reviewer" || normalized === "photographer") {
    return normalized;
  }

  throw new HttpError(500, "outbound_email_invalid_payload", `Outbound email payload field ${field} is invalid.`);
}

function normalizeIsoTimestamp(value: string, field: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(500, "outbound_email_invalid_payload", `Outbound email payload field ${field} is invalid.`);
  }

  return date.toISOString();
}

function parseTenantMembershipInvitePayload(value: Record<string, unknown>): TenantMembershipInviteEmailPayload {
  return {
    inviteId: requireString(value.inviteId, "inviteId"),
    tenantId: requireString(value.tenantId, "tenantId"),
    tenantName: requireString(value.tenantName, "tenantName"),
    invitedEmail: requireString(value.invitedEmail, "invitedEmail"),
    role: requireRole(value.role, "role"),
    inviteToken: requireString(value.inviteToken, "inviteToken"),
    expiresAtIso: normalizeIsoTimestamp(requireString(value.expiresAtIso, "expiresAtIso"), "expiresAtIso"),
    lastSentAtIso: normalizeIsoTimestamp(requireString(value.lastSentAtIso, "lastSentAtIso"), "lastSentAtIso"),
    inviterDisplayName: requireString(value.inviterDisplayName, "inviterDisplayName"),
  };
}

const consentReceiptEntry: OutboundEmailRegistryEntry<"consent_receipt"> = {
  kind: "consent_receipt",
  buildDedupeKey(payload) {
    return `consent_receipt:${payload.consentId}`;
  },
  getRecipient(payload) {
    return payload.subjectEmail;
  },
  parsePayload(value) {
    return parseConsentReceiptPayload(value);
  },
  render(payload) {
    return renderConsentReceiptEmail(payload);
  },
  async afterSend({ payload, supabase }) {
    await markReceiptSent(supabase, payload.consentId, payload.revokeToken);
  },
};

const tenantMembershipInviteEntry: OutboundEmailRegistryEntry<"tenant_membership_invite"> = {
  kind: "tenant_membership_invite",
  buildDedupeKey(payload) {
    return `tenant_membership_invite:${payload.inviteId}:${payload.lastSentAtIso}`;
  },
  getRecipient(payload) {
    return payload.invitedEmail;
  },
  parsePayload(value) {
    return parseTenantMembershipInvitePayload(value);
  },
  render(payload) {
    return renderTenantMembershipInviteEmail(payload);
  },
  async validateBeforeSend({ payload, supabase, tenantId }) {
    const { data, error } = await supabase
      .from("tenant_membership_invites")
      .select("status, last_sent_at, expires_at")
      .eq("tenant_id", tenantId)
      .eq("id", payload.inviteId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "outbound_email_invite_validation_failed", "Unable to validate membership invite.");
    }

    if (!data) {
      return {
        valid: false,
        errorCode: "tenant_membership_invite_missing",
        errorMessage: "Membership invite no longer exists.",
      };
    }

    if (data.status !== "pending") {
      return {
        valid: false,
        errorCode: "tenant_membership_invite_not_pending",
        errorMessage: "Membership invite is no longer pending.",
      };
    }

    const normalizedLastSentAtIso = data.last_sent_at ? new Date(data.last_sent_at).toISOString() : null;
    if (!normalizedLastSentAtIso || normalizedLastSentAtIso !== payload.lastSentAtIso) {
      return {
        valid: false,
        errorCode: "tenant_membership_invite_superseded",
        errorMessage: "Membership invite email has been superseded by a newer send.",
      };
    }

    if (data.expires_at && new Date(data.expires_at).getTime() <= Date.now()) {
      return {
        valid: false,
        errorCode: "tenant_membership_invite_expired",
        errorMessage: "Membership invite has expired.",
      };
    }

    return { valid: true };
  },
};

const registry = {
  consent_receipt: consentReceiptEntry,
  tenant_membership_invite: tenantMembershipInviteEntry,
} satisfies {
  [K in OutboundEmailKind]: OutboundEmailRegistryEntry<K>;
};

export function getOutboundEmailRegistryEntry<K extends OutboundEmailKind>(kind: K): OutboundEmailRegistryEntry<K> {
  const entry = registry[kind];
  if (!entry) {
    throw new HttpError(500, "outbound_email_unknown_kind", `Unknown outbound email kind: ${kind}`);
  }

  return entry;
}

export async function runOutboundEmailAfterSendHook<K extends OutboundEmailKind>(
  kind: K,
  input: {
    tenantId: string;
    jobId: string;
    payload: OutboundEmailPayloadByKind[K];
    supabase: SupabaseClient;
  },
) {
  const entry = getOutboundEmailRegistryEntry(kind);
  if (!entry.afterSend) {
    return;
  }

  await entry.afterSend(input);
}
