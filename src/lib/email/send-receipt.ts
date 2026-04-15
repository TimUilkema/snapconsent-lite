import nodemailer from "nodemailer";

import { HttpError } from "@/lib/http/errors";
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

function getEmailConfig() {
  const host = process.env.SMTP_HOST ?? "127.0.0.1";
  const port = Number(process.env.SMTP_PORT ?? "54325");
  const from = process.env.SMTP_FROM ?? "receipts@snapconsent.local";

  if (!Number.isFinite(port) || port <= 0) {
    throw new HttpError(500, "invalid_smtp_config", "SMTP port configuration is invalid.");
  }

  return { host, port, from };
}

export async function sendConsentReceiptEmail(input: SendConsentReceiptInput) {
  const { host, port, from } = getEmailConfig();
  const message = buildConsentReceipt(input);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false,
    ignoreTLS: true,
  });

  await transport.sendMail({
    from,
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
  const { host, port, from } = getEmailConfig();
  const message = buildRecurringConsentReceipt(input);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure: false,
    ignoreTLS: true,
  });

  await transport.sendMail({
    from,
    to: input.subjectEmail,
    subject: message.subject,
    text: message.text,
    html: message.html,
  });
}
