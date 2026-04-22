import assert from "node:assert/strict";
import test from "node:test";

import nodemailer from "nodemailer";

import { POST as outboundEmailWorkerPost } from "@/app/api/internal/email/worker/route";
import { deliverConsentReceiptAfterSubmit } from "../src/lib/email/outbound/consent-receipt-delivery";
import { renderConsentReceiptEmail } from "../src/lib/email/outbound/renderers/consent-receipt";
import { createSmtpOutboundEmailTransport } from "../src/lib/email/outbound/smtp-transport";
import { formatOutboundEmailTimestampUtc } from "../src/lib/email/outbound/timestamps";
import { runOutboundEmailWorker } from "../src/lib/email/outbound/worker";

test("outbound email timestamp formatting is deterministic UTC", () => {
  assert.equal(formatOutboundEmailTimestampUtc("2026-04-22T08:09:45.000Z"), "2026-04-22 08:09 UTC");
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

test("smtp outbound transport forwards the provider message id", async (t) => {
  const sendMail = t.mock.fn(async () => ({ messageId: "smtp-message-1" }));
  const createTransport = t.mock.method(nodemailer, "createTransport", () => ({ sendMail }) as never);

  try {
    const transport = createSmtpOutboundEmailTransport({
      smtpHost: "127.0.0.1",
      smtpPort: 54325,
      smtpFrom: "receipts@snapconsent.local",
    });

    const result = await transport.send({
      from: "receipts@snapconsent.local",
      to: "jordan@example.com",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    });

    assert.equal(createTransport.mock.callCount(), 1);
    assert.equal(sendMail.mock.callCount(), 1);
    assert.equal(result.providerMessageId, "smtp-message-1");
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
