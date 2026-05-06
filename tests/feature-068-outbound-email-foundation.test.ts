import assert from "node:assert/strict";
import test from "node:test";

import nodemailer from "nodemailer";

import { POST as outboundEmailWorkerPost } from "@/app/api/internal/email/worker/route";
import { deliverConsentReceiptAfterSubmit } from "../src/lib/email/outbound/consent-receipt-delivery";
import { getOutboundEmailConfig, type OutboundEmailConfig } from "../src/lib/email/outbound/config";
import { deliverTenantMembershipInviteEmail } from "../src/lib/email/outbound/tenant-membership-invite-delivery";
import { renderConsentReceiptEmail } from "../src/lib/email/outbound/renderers/consent-receipt";
import { renderTenantMembershipInviteEmail } from "../src/lib/email/outbound/renderers/tenant-membership-invite";
import { createSmtpOutboundEmailTransport } from "../src/lib/email/outbound/smtp-transport";
import { formatOutboundEmailTimestampUtc } from "../src/lib/email/outbound/timestamps";
import { runOutboundEmailWorker } from "../src/lib/email/outbound/worker";

const OUTBOUND_EMAIL_ENV_KEYS = [
  "EMAIL_TRANSPORT",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_FROM",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_SECURE",
  "SMTP_REQUIRE_TLS",
] as const;

function withOutboundEmailEnv(
  values: Partial<Record<(typeof OUTBOUND_EMAIL_ENV_KEYS)[number], string | undefined>>,
  callback: () => void,
) {
  const original = Object.fromEntries(OUTBOUND_EMAIL_ENV_KEYS.map((key) => [key, process.env[key]]));

  try {
    for (const key of OUTBOUND_EMAIL_ENV_KEYS) {
      delete process.env[key];
    }

    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    callback();
  } finally {
    for (const key of OUTBOUND_EMAIL_ENV_KEYS) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function localSinkConfig(overrides: Partial<OutboundEmailConfig> = {}): OutboundEmailConfig {
  return {
    emailTransport: "local-sink",
    smtpHost: "127.0.0.1",
    smtpPort: 54325,
    smtpFrom: "receipts@snapconsent.local",
    smtpUser: null,
    smtpPassword: null,
    smtpSecure: false,
    smtpRequireTls: false,
    ...overrides,
  };
}

function smtpConfig(overrides: Partial<OutboundEmailConfig> = {}): OutboundEmailConfig {
  return {
    emailTransport: "smtp",
    smtpHost: "smtp.example.test",
    smtpPort: 587,
    smtpFrom: "SnapConsent <app@example.test>",
    smtpUser: "app@example.test",
    smtpPassword: "<GMAIL_APP_PASSWORD>",
    smtpSecure: false,
    smtpRequireTls: true,
    ...overrides,
  };
}

test("outbound email timestamp formatting is deterministic UTC", () => {
  assert.equal(formatOutboundEmailTimestampUtc("2026-04-22T08:09:45.000Z"), "2026-04-22 08:09 UTC");
});

test("outbound email config defaults to local sink mode", () => {
  withOutboundEmailEnv({}, () => {
    assert.deepEqual(getOutboundEmailConfig(), localSinkConfig());
  });
});

test("outbound email config rejects local sink auth settings without explicit smtp mode", () => {
  withOutboundEmailEnv({ SMTP_USER: "app@example.test" }, () => {
    assert.throws(() => getOutboundEmailConfig(), {
      name: "Error",
      code: "invalid_smtp_config",
      message: "SMTP auth settings require EMAIL_TRANSPORT=smtp.",
    });
  });
});

test("outbound email config rejects invalid transport mode", () => {
  withOutboundEmailEnv({ EMAIL_TRANSPORT: "gmail" }, () => {
    assert.throws(() => getOutboundEmailConfig(), {
      name: "Error",
      code: "invalid_smtp_config",
      message: "Email transport configuration is invalid.",
    });
  });
});

test("outbound email config rejects invalid TLS booleans", () => {
  withOutboundEmailEnv({ EMAIL_TRANSPORT: "smtp", SMTP_SECURE: "yes" }, () => {
    assert.throws(() => getOutboundEmailConfig(), {
      name: "Error",
      code: "invalid_smtp_config",
      message: "SMTP_SECURE configuration is invalid.",
    });
  });
});

test("outbound email config parses Gmail-style STARTTLS settings", () => {
  withOutboundEmailEnv(
    {
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.gmail.com",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "true",
      SMTP_USER: "<GMAIL_ADDRESS>",
      SMTP_PASSWORD: "<GMAIL_APP_PASSWORD>",
      SMTP_FROM: "SnapConsent <GMAIL_ADDRESS>",
    },
    () => {
      assert.deepEqual(getOutboundEmailConfig(), {
        emailTransport: "smtp",
        smtpHost: "smtp.gmail.com",
        smtpPort: 587,
        smtpFrom: "SnapConsent <GMAIL_ADDRESS>",
        smtpUser: "<GMAIL_ADDRESS>",
        smtpPassword: "<GMAIL_APP_PASSWORD>",
        smtpSecure: false,
        smtpRequireTls: true,
      });
    },
  );
});

test("outbound email config defaults port 465 smtp mode to implicit TLS", () => {
  withOutboundEmailEnv(
    {
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "465",
      SMTP_USER: "app@example.test",
      SMTP_PASSWORD: "<GMAIL_APP_PASSWORD>",
      SMTP_FROM: "SnapConsent <app@example.test>",
    },
    () => {
      const config = getOutboundEmailConfig();
      assert.equal(config.smtpSecure, true);
      assert.equal(config.smtpRequireTls, false);
    },
  );
});

test("outbound email config rejects smtp mode without auth", () => {
  withOutboundEmailEnv({ EMAIL_TRANSPORT: "smtp" }, () => {
    assert.throws(() => getOutboundEmailConfig(), {
      name: "Error",
      code: "invalid_smtp_config",
      message: "SMTP auth configuration is required for real SMTP mode.",
    });
  });
});

test("outbound email config rejects plaintext real smtp mode", () => {
  withOutboundEmailEnv(
    {
      EMAIL_TRANSPORT: "smtp",
      SMTP_HOST: "smtp.example.test",
      SMTP_PORT: "587",
      SMTP_SECURE: "false",
      SMTP_REQUIRE_TLS: "false",
      SMTP_USER: "app@example.test",
      SMTP_PASSWORD: "<GMAIL_APP_PASSWORD>",
      SMTP_FROM: "SnapConsent <app@example.test>",
    },
    () => {
      assert.throws(() => getOutboundEmailConfig(), {
        name: "Error",
        code: "invalid_smtp_config",
        message: "SMTP TLS configuration is required for real SMTP mode.",
      });
    },
  );
});

test("consent receipt renderer builds an absolute revoke URL from APP_ORIGIN", () => {
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example.test";

  try {
    const rendered = renderConsentReceiptEmail({
      consentId: "consent-1",
      revokeToken: "revoke-123",
      subjectName: "Jordan Miles",
      subjectEmail: "jordan@example.com",
      projectName: "Spring Session",
      signedAtIso: "2026-04-22T08:09:45.000Z",
      consentText: "I consent.",
      consentVersion: "v1",
    });

    assert.equal(rendered.subject, "SnapConsent receipt for Spring Session");
    assert.match(rendered.text, /Signed at: 2026-04-22 08:09 UTC/);
    assert.match(rendered.text, /https:\/\/app\.example\.test\/r\/revoke-123/);
    assert.match(rendered.html ?? "", /https:\/\/app\.example\.test\/r\/revoke-123/);
  } finally {
    process.env.APP_ORIGIN = originalOrigin;
  }
});

test("tenant membership invite renderer builds an absolute join URL from APP_ORIGIN", () => {
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example.test";

  try {
    const rendered = renderTenantMembershipInviteEmail({
      inviteId: "invite-1",
      tenantId: "tenant-1",
      tenantName: "Northwind Studio",
      invitedEmail: "alex@example.com",
      role: "reviewer",
      inviteToken: "invite-token-123",
      expiresAtIso: "2026-04-25T08:09:45.000Z",
      lastSentAtIso: "2026-04-22T08:09:45.000Z",
      inviterDisplayName: "Morgan",
    });

    assert.equal(rendered.subject, "Join Northwind Studio on SnapConsent");
    assert.match(rendered.text, /Role: Reviewer/);
    assert.match(rendered.text, /https:\/\/app\.example\.test\/join\/invite-token-123/);
    assert.match(rendered.html ?? "", /https:\/\/app\.example\.test\/join\/invite-token-123/);
  } finally {
    process.env.APP_ORIGIN = originalOrigin;
  }
});

test("smtp outbound transport forwards the provider message id", async (t) => {
  const sendMail = t.mock.fn(async () => ({ messageId: "smtp-message-1" }));
  const createTransport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }) as never);

  try {
    const transport = createSmtpOutboundEmailTransport({
      ...localSinkConfig(),
    });

    const result = await transport.send({
      from: "receipts@snapconsent.local",
      to: "jordan@example.com",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    });

    assert.equal(createTransport.mock.callCount(), 1);
    assert.deepEqual(createTransport.mock.calls[0].arguments[0], {
      host: "127.0.0.1",
      port: 54325,
      secure: false,
      ignoreTLS: true,
    });
    assert.equal(sendMail.mock.callCount(), 1);
    assert.equal(result.providerMessageId, "smtp-message-1");
  } finally {
    createTransport.mock.restore();
  }
});

test("smtp outbound transport configures STARTTLS auth for real smtp mode", async (t) => {
  const sendMail = t.mock.fn(async () => ({ messageId: "smtp-message-2" }));
  const createTransport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }) as never);

  try {
    createSmtpOutboundEmailTransport(smtpConfig());

    assert.equal(createTransport.mock.callCount(), 1);
    assert.deepEqual(createTransport.mock.calls[0].arguments[0], {
      host: "smtp.example.test",
      port: 587,
      secure: false,
      requireTLS: true,
      ignoreTLS: false,
      auth: {
        user: "app@example.test",
        pass: "<GMAIL_APP_PASSWORD>",
      },
    });
  } finally {
    createTransport.mock.restore();
  }
});

test("smtp outbound transport configures implicit TLS auth for port 465 mode", async (t) => {
  const sendMail = t.mock.fn(async () => ({ messageId: "smtp-message-3" }));
  const createTransport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }) as never);

  try {
    createSmtpOutboundEmailTransport(smtpConfig({ smtpPort: 465, smtpSecure: true, smtpRequireTls: false }));

    assert.equal(createTransport.mock.callCount(), 1);
    assert.deepEqual(createTransport.mock.calls[0].arguments[0], {
      host: "smtp.example.test",
      port: 465,
      secure: true,
      requireTLS: false,
      ignoreTLS: false,
      auth: {
        user: "app@example.test",
        pass: "<GMAIL_APP_PASSWORD>",
      },
    });
  } finally {
    createTransport.mock.restore();
  }
});

test("outbound email worker requires a worker id", async () => {
  await assert.rejects(
    () => runOutboundEmailWorker({ workerId: "" }),
    {
      name: "Error",
      code: "outbound_email_worker_id_required",
    },
  );
});

test("outbound email worker route rejects unauthorized requests", async () => {
  const originalToken = process.env.OUTBOUND_EMAIL_WORKER_TOKEN;
  process.env.OUTBOUND_EMAIL_WORKER_TOKEN = "test-email-worker-token";

  try {
    const response = await outboundEmailWorkerPost(
      new Request("http://localhost/api/internal/email/worker", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-token",
        },
        body: JSON.stringify({ batchSize: 1 }),
      }),
    );

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      error: "unauthorized",
      message: "Unauthorized outbound email worker request.",
    });
  } finally {
    process.env.OUTBOUND_EMAIL_WORKER_TOKEN = originalToken;
  }
});

test("consent receipt delivery helper queues on dispatch failure without throwing", async () => {
  const result = await deliverConsentReceiptAfterSubmit(
    {
      consentId: "consent-1",
      duplicate: false,
      revokeToken: "revoke-1",
      subjectEmail: "jordan@example.com",
      subjectName: "Jordan Miles",
      projectName: "Project A",
      signedAt: "2026-04-22T08:09:45.000Z",
      tenantId: "tenant-1",
      consentText: "I consent.",
      consentVersion: "v1",
    },
    {
      enqueueConsentReceiptEmailJob: async () => ({
        jobId: "job-1",
        status: "pending",
        attemptCount: 0,
        maxAttempts: 5,
        runAfter: new Date().toISOString(),
        sentAt: null,
        cancelledAt: null,
        deadAt: null,
        enqueued: true,
      }),
      dispatchOutboundEmailJobById: async () => ({ outcome: "retried", jobId: "job-1" }),
    },
  );

  assert.equal(result.receiptStatus, "queued");
  assert.equal(result.jobId, "job-1");
});

test("consent receipt delivery helper skips duplicate receipts", async () => {
  let enqueueCalled = false;

  const result = await deliverConsentReceiptAfterSubmit(
    {
      consentId: "consent-1",
      duplicate: true,
      revokeToken: "revoke-1",
      subjectEmail: "jordan@example.com",
      subjectName: "Jordan Miles",
      projectName: "Project A",
      signedAt: "2026-04-22T08:09:45.000Z",
      tenantId: "tenant-1",
      consentText: "I consent.",
      consentVersion: "v1",
    },
    {
      enqueueConsentReceiptEmailJob: async () => {
        enqueueCalled = true;
        throw new Error("should not be called");
      },
      dispatchOutboundEmailJobById: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(result.receiptStatus, "sent");
  assert.equal(result.jobId, null);
  assert.equal(enqueueCalled, false);
});

test("tenant membership invite delivery helper queues on dispatch failure without throwing", async () => {
  const result = await deliverTenantMembershipInviteEmail(
    {
      tenantId: "tenant-1",
      payload: {
        inviteId: "invite-1",
        tenantId: "tenant-1",
        tenantName: "Northwind Studio",
        invitedEmail: "alex@example.com",
        role: "reviewer",
        inviteToken: "invite-token-123",
        expiresAtIso: "2026-04-25T08:09:45.000Z",
        lastSentAtIso: "2026-04-22T08:09:45.000Z",
        inviterDisplayName: "Morgan",
      },
    },
    {
      enqueueTenantMembershipInviteEmailJob: async () => ({
        jobId: "job-2",
        status: "pending",
        attemptCount: 0,
        maxAttempts: 5,
        runAfter: new Date().toISOString(),
        sentAt: null,
        cancelledAt: null,
        deadAt: null,
        enqueued: true,
      }),
      dispatchOutboundEmailJobById: async () => ({ outcome: "retried", jobId: "job-2" }),
    },
  );

  assert.equal(result.deliveryStatus, "queued");
  assert.equal(result.jobId, "job-2");
});
