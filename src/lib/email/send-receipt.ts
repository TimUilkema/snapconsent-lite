import { getOutboundEmailConfig } from "@/lib/email/outbound/config";
import { createSmtpOutboundEmailTransport } from "@/lib/email/outbound/smtp-transport";
import { buildConsentReceipt } from "@/lib/email/templates/consent-receipt";
import { buildRecurringConsentReceipt } from "@/lib/email/templates/recurring-consent-receipt";

type SendConsentReceiptInput = {
  subjectName: string;
  subjectEmail: string;
  projectName: string;
  signedAtIso: string;
  consentText: string;
  consentVersion: string;
  revokeUrl: string;
};

export async function sendConsentReceiptEmail(input: SendConsentReceiptInput) {
  const config = getOutboundEmailConfig();
  const message = buildConsentReceipt(input);
  const transport = createSmtpOutboundEmailTransport(config);

  await transport.send({
    from: config.smtpFrom,
    to: input.subjectEmail,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}

type SendRecurringConsentReceiptInput = {
  subjectName: string;
  subjectEmail: string;
  tenantLabel: string;
  signedAtIso: string;
  consentText: string;
  consentVersion: string;
  revokeUrl: string;
};

export async function sendRecurringConsentReceiptEmail(input: SendRecurringConsentReceiptInput) {
  const config = getOutboundEmailConfig();
  const message = buildRecurringConsentReceipt(input);
  const transport = createSmtpOutboundEmailTransport(config);

  await transport.send({
    from: config.smtpFrom,
    to: input.subjectEmail,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
