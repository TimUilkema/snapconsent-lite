import { escapeEmailHtml } from "@/lib/email/outbound/html";
import { formatOutboundEmailTimestampUtc } from "@/lib/email/outbound/timestamps";
import type { ConsentReceiptEmailPayload, RenderedOutboundEmail } from "@/lib/email/outbound/types";
import { buildExternalUrl } from "@/lib/url/external-origin";
import { buildRevokePath } from "@/lib/url/paths";

export function renderConsentReceiptEmail(payload: ConsentReceiptEmailPayload): RenderedOutboundEmail {
  const signedAt = formatOutboundEmailTimestampUtc(payload.signedAtIso);
  const revokeUrl = buildExternalUrl(buildRevokePath(payload.revokeToken));
  const subject = `SnapConsent receipt for ${payload.projectName}`;

  const text = [
    `Hi ${payload.subjectName},`,
    "",
    "This email confirms your submitted consent.",
    `Project: ${payload.projectName}`,
    `Email: ${payload.subjectEmail}`,
    `Signed at: ${signedAt}`,
    `Consent version: ${payload.consentVersion}`,
    "",
    "Consent text:",
    payload.consentText,
    "",
    "Revoke your consent:",
    revokeUrl,
    "",
    "If you did not submit this form, contact the photographer immediately.",
  ].join("\n");

  const html = `
    <p>Hi ${escapeEmailHtml(payload.subjectName)},</p>
    <p>This email confirms your submitted consent.</p>
    <ul>
      <li><strong>Project:</strong> ${escapeEmailHtml(payload.projectName)}</li>
      <li><strong>Email:</strong> ${escapeEmailHtml(payload.subjectEmail)}</li>
      <li><strong>Signed at:</strong> ${escapeEmailHtml(signedAt)}</li>
      <li><strong>Consent version:</strong> ${escapeEmailHtml(payload.consentVersion)}</li>
    </ul>
    <p><strong>Consent text:</strong></p>
    <p>${escapeEmailHtml(payload.consentText)}</p>
    <p><a href="${escapeEmailHtml(revokeUrl)}">Revoke your consent</a></p>
    <p>If you did not submit this form, contact the photographer immediately.</p>
  `;

  return { subject, text, html };
}
