import type { SupabaseClient } from "@supabase/supabase-js";

import { markReceiptSent } from "@/lib/consent/submit-consent";
import { renderConsentReceiptEmail } from "@/lib/email/outbound/renderers/consent-receipt";
import type {
  ConsentReceiptEmailPayload,
  OutboundEmailKind,
  OutboundEmailPayloadByKind,
  OutboundEmailRegistryEntry,
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

const registry = {
  consent_receipt: consentReceiptEntry,
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
