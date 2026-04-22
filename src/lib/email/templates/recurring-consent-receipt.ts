import { escapeEmailHtml, formatOutboundEmailTimestampUtc } from "@/lib/email/templates/shared";

type BuildRecurringConsentReceiptInput = {
  subjectName: string;
  subjectEmail: string;
  tenantLabel: string;
  signedAtIso: string;
  consentText: string;
  consentVersion: string;
  revokeUrl: string;
};

export function buildRecurringConsentReceipt(input: BuildRecurringConsentReceiptInput) {
  const signedAt = formatOutboundEmailTimestampUtc(input.signedAtIso);
  const subject = `SnapConsent receipt for ${input.tenantLabel}`;

  const text = [
    `Hi ${input.subjectName},`,
    "",
    "This email confirms your submitted recurring consent.",
    `Organization: ${input.tenantLabel}`,
    `Email: ${input.subjectEmail}`,
    `Signed at: ${signedAt}`,
    `Consent version: ${input.consentVersion}`,
    "",
    "Consent text:",
    input.consentText,
    "",
    "Revoke your consent:",
    input.revokeUrl,
    "",
    "If you did not submit this form, contact the organization immediately.",
  ].join("\n");

  const html = `
    <p>Hi ${escapeEmailHtml(input.subjectName)},</p>
    <p>This email confirms your submitted recurring consent.</p>
    <ul>
      <li><strong>Organization:</strong> ${escapeEmailHtml(input.tenantLabel)}</li>
      <li><strong>Email:</strong> ${escapeEmailHtml(input.subjectEmail)}</li>
      <li><strong>Signed at:</strong> ${escapeEmailHtml(signedAt)}</li>
      <li><strong>Consent version:</strong> ${escapeEmailHtml(input.consentVersion)}</li>
    </ul>
    <p><strong>Consent text:</strong></p>
    <p>${escapeEmailHtml(input.consentText)}</p>
    <p><a href="${escapeEmailHtml(input.revokeUrl)}">Revoke your consent</a></p>
    <p>If you did not submit this form, contact the organization immediately.</p>
  `;

  return { subject, text, html };
}
