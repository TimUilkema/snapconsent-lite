import { escapeEmailHtml, formatOutboundEmailTimestampUtc } from "@/lib/email/templates/shared";

type ConsentReceiptInput = {
  subjectName: string;
  subjectEmail: string;
  projectName: string;
  signedAtIso: string;
  consentText: string;
  consentVersion: string;
  revokeUrl: string;
};

export function buildConsentReceipt(input: ConsentReceiptInput) {
  const signedAt = formatOutboundEmailTimestampUtc(input.signedAtIso);
  const subject = `SnapConsent receipt for ${input.projectName}`;

  const text = [
    `Hi ${input.subjectName},`,
    "",
    "This email confirms your submitted consent.",
    `Project: ${input.projectName}`,
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
    "If you did not submit this form, contact the photographer immediately.",
  ].join("\n");

  const html = `
    <p>Hi ${escapeEmailHtml(input.subjectName)},</p>
    <p>This email confirms your submitted consent.</p>
    <ul>
      <li><strong>Project:</strong> ${escapeEmailHtml(input.projectName)}</li>
      <li><strong>Email:</strong> ${escapeEmailHtml(input.subjectEmail)}</li>
      <li><strong>Signed at:</strong> ${escapeEmailHtml(signedAt)}</li>
      <li><strong>Consent version:</strong> ${escapeEmailHtml(input.consentVersion)}</li>
    </ul>
    <p><strong>Consent text:</strong></p>
    <p>${escapeEmailHtml(input.consentText)}</p>
    <p><a href="${escapeEmailHtml(input.revokeUrl)}">Revoke your consent</a></p>
    <p>If you did not submit this form, contact the photographer immediately.</p>
  `;

  return { subject, text, html };
}
