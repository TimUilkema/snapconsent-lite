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
  const signedAt = new Date(input.signedAtIso).toLocaleString();
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
    <p>Hi ${escapeHtml(input.subjectName)},</p>
    <p>This email confirms your submitted consent.</p>
    <ul>
      <li><strong>Project:</strong> ${escapeHtml(input.projectName)}</li>
      <li><strong>Email:</strong> ${escapeHtml(input.subjectEmail)}</li>
      <li><strong>Signed at:</strong> ${escapeHtml(signedAt)}</li>
      <li><strong>Consent version:</strong> ${escapeHtml(input.consentVersion)}</li>
    </ul>
    <p><strong>Consent text:</strong></p>
    <p>${escapeHtml(input.consentText)}</p>
    <p><a href="${escapeHtml(input.revokeUrl)}">Revoke your consent</a></p>
    <p>If you did not submit this form, contact the photographer immediately.</p>
  `;

  return { subject, text, html };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
