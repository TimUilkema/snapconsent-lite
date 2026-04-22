import { HttpError } from "@/lib/http/errors";

export type OutboundEmailConfig = {
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
};

export function getOutboundEmailConfig(): OutboundEmailConfig {
  const smtpHost = process.env.SMTP_HOST ?? "127.0.0.1";
  const smtpPort = Number(process.env.SMTP_PORT ?? "54325");
  const smtpFrom = process.env.SMTP_FROM ?? "receipts@snapconsent.local";

  if (!Number.isFinite(smtpPort) || smtpPort <= 0) {
    throw new HttpError(500, "invalid_smtp_config", "SMTP port configuration is invalid.");
  }

  if (!smtpFrom.trim()) {
    throw new HttpError(500, "invalid_smtp_config", "SMTP from configuration is invalid.");
  }

  return {
    smtpHost,
    smtpPort,
    smtpFrom: smtpFrom.trim(),
  };
}

export function getOutboundEmailWorkerToken() {
  const token = process.env.OUTBOUND_EMAIL_WORKER_TOKEN;
  if (!token) {
    throw new HttpError(500, "worker_not_configured", "Outbound email worker token is not configured.");
  }

  return token;
}
