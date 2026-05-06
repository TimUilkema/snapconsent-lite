import { HttpError } from "@/lib/http/errors";

export type OutboundEmailTransportMode = "local-sink" | "smtp";

export type OutboundEmailConfig = {
  emailTransport: OutboundEmailTransportMode;
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
};

function requireSmtpConfig(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new HttpError(500, "invalid_smtp_config", message);
  }
}

function optionalTrimmedEnv(name: string) {
  const value = process.env[name];
  if (value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTransportMode(): OutboundEmailTransportMode {
  const normalized = optionalTrimmedEnv("EMAIL_TRANSPORT")?.toLowerCase() ?? "local-sink";
  if (normalized === "local-sink" || normalized === "smtp") {
    return normalized;
  }

  throw new HttpError(500, "invalid_smtp_config", "Email transport configuration is invalid.");
}

function parseOptionalBoolean(name: string) {
  const value = optionalTrimmedEnv(name);
  if (value === null) {
    return null;
  }

  const normalized = value.toLowerCase();
  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new HttpError(500, "invalid_smtp_config", `${name} configuration is invalid.`);
}

export function getOutboundEmailConfig(): OutboundEmailConfig {
  const emailTransport = parseTransportMode();
  const smtpHost = process.env.SMTP_HOST?.trim() ?? "127.0.0.1";
  const smtpPort = Number(process.env.SMTP_PORT ?? "54325");
  const smtpFrom = process.env.SMTP_FROM ?? "receipts@snapconsent.local";
  const smtpUser = optionalTrimmedEnv("SMTP_USER");
  const smtpPassword = optionalTrimmedEnv("SMTP_PASSWORD");
  const configuredSmtpSecure = parseOptionalBoolean("SMTP_SECURE");
  const configuredSmtpRequireTls = parseOptionalBoolean("SMTP_REQUIRE_TLS");

  requireSmtpConfig(smtpHost.length > 0, "SMTP host configuration is invalid.");
  requireSmtpConfig(Number.isInteger(smtpPort) && smtpPort > 0 && smtpPort <= 65535, "SMTP port configuration is invalid.");
  requireSmtpConfig(smtpFrom.trim().length > 0, "SMTP from configuration is invalid.");

  if (emailTransport === "local-sink") {
    requireSmtpConfig(!smtpUser && !smtpPassword, "SMTP auth settings require EMAIL_TRANSPORT=smtp.");
    requireSmtpConfig(
      configuredSmtpSecure === null && configuredSmtpRequireTls === null,
      "SMTP TLS settings require EMAIL_TRANSPORT=smtp.",
    );

    return {
      emailTransport,
      smtpHost,
      smtpPort,
      smtpFrom: smtpFrom.trim(),
      smtpUser: null,
      smtpPassword: null,
      smtpSecure: false,
      smtpRequireTls: false,
    };
  }

  requireSmtpConfig(Boolean(smtpUser && smtpPassword), "SMTP auth configuration is required for real SMTP mode.");

  const smtpSecure = configuredSmtpSecure ?? smtpPort === 465;
  const smtpRequireTls = configuredSmtpRequireTls ?? !smtpSecure;
  requireSmtpConfig(smtpSecure || smtpRequireTls, "SMTP TLS configuration is required for real SMTP mode.");

  return {
    emailTransport,
    smtpHost,
    smtpPort,
    smtpFrom: smtpFrom.trim(),
    smtpUser,
    smtpPassword,
    smtpSecure,
    smtpRequireTls,
  };
}

export function getOutboundEmailWorkerToken() {
  const token = process.env.OUTBOUND_EMAIL_WORKER_TOKEN;
  if (!token) {
    throw new HttpError(500, "worker_not_configured", "Outbound email worker token is not configured.");
  }

  return token;
}
