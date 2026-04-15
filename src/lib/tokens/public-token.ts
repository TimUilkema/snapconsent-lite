import { createHash, createHmac } from "node:crypto";

import { HttpError } from "@/lib/http/errors";

function requireTokenSecret() {
  const secret = process.env.INVITE_TOKEN_SECRET ?? process.env.SECRET_KEY;

  if (!secret) {
    throw new HttpError(500, "missing_token_secret", "Token secret is not configured.");
  }

  return secret;
}

export function hashPublicToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deriveInviteToken(input: {
  tenantId: string;
  projectId: string;
  idempotencyKey: string;
}) {
  const secret = requireTokenSecret();
  const payload = `${input.tenantId}:${input.projectId}:${input.idempotencyKey}`;

  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function deriveRecurringProfileConsentToken(input: { requestId: string }) {
  const secret = requireTokenSecret();
  const payload = `recurring-profile-consent:${input.requestId}`;

  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function deriveRecurringProfileRevokeToken(input: { consentId: string }) {
  const secret = requireTokenSecret();
  const payload = `recurring-profile-revoke:${input.consentId}`;

  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}
