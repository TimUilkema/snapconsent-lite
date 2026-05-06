import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import {
  dispatchOutboundEmailJobById,
  enqueueConsentReceiptEmailJob,
  enqueueTenantMembershipInviteEmailJob,
} from "../src/lib/email/outbound/jobs";
import { runOutboundEmailWorker } from "../src/lib/email/outbound/worker";
import { adminClient, assertNoPostgrestError, createAuthUserWithRetry } from "./helpers/supabase-test-client";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
};

function hashSha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature068-owner");

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 068 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: owner.userId,
    role: "owner",
  });
  assertNoPostgrestError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 068 Project ${randomUUID()}`,
      description: "Outbound email foundation tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature068-template-${randomUUID()}`,
      name: "Feature 068 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 068 consent body",
      status: "published",
      created_by: owner.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(templateError, "insert consent template");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId: owner.userId,
    consentTemplateId: template.id,
  };
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature068-invite-${randomUUID()}`;

  const { error } = await supabase.from("subject_invites").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.userId,
    token_hash: hashSha256(token),
    status: "active",
    max_uses: 1,
    consent_template_id: context.consentTemplateId,
  });
  assertNoPostgrestError(error, "insert invite");

  return token;
}

async function createConsentFixture() {
  const context = await createProjectContext(adminClient);
  const token = await createInviteToken(adminClient, context);
  const consent = await submitConsent({
    supabase: adminClient,
    token,
    fullName: "Jordan Miles",
    email: `feature068-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: null,
    captureIp: null,
    captureUserAgent: "feature-068-test",
  });

  return { context, consent };
}

test("outbound email jobs dedupe by consent receipt and mark the consent receipt as sent", async () => {
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example.test";

  try {
    const { context, consent } = await createConsentFixture();

    const first = await enqueueConsentReceiptEmailJob({
      tenantId: context.tenantId,
      payload: {
        consentId: consent.consentId,
        revokeToken: consent.revokeToken!,
        subjectName: consent.subjectName,
        subjectEmail: consent.subjectEmail,
        projectName: consent.projectName,
        signedAtIso: consent.signedAt,
        consentText: consent.consentText,
        consentVersion: consent.consentVersion,
      },
      supabase: adminClient,
    });

    const second = await enqueueConsentReceiptEmailJob({
      tenantId: context.tenantId,
      payload: {
        consentId: consent.consentId,
        revokeToken: consent.revokeToken!,
        subjectName: consent.subjectName,
        subjectEmail: consent.subjectEmail,
        projectName: consent.projectName,
        signedAtIso: consent.signedAt,
        consentText: consent.consentText,
        consentVersion: consent.consentVersion,
      },
      supabase: adminClient,
    });

    assert.equal(first.enqueued, true);
    assert.equal(second.enqueued, false);
    assert.equal(first.jobId, second.jobId);

    const dispatched = await dispatchOutboundEmailJobById({
      tenantId: context.tenantId,
      jobId: first.jobId,
      supabase: adminClient,
      transport: {
        send: async () => ({ providerMessageId: "provider-message-1" }),
      },
    });

    assert.equal(dispatched.outcome, "sent");

    const { data: job, error: jobError } = await adminClient
      .from("outbound_email_jobs")
      .select("status, attempt_count, provider_message_id, sent_at")
      .eq("tenant_id", context.tenantId)
      .eq("id", first.jobId)
      .single();
    assertNoPostgrestError(jobError, "select outbound email job");
    assert.equal(job.status, "sent");
    assert.equal(job.attempt_count, 1);
    assert.equal(job.provider_message_id, "provider-message-1");
    assert.notEqual(job.sent_at, null);

    const { data: consentRow, error: consentError } = await adminClient
      .from("consents")
      .select("receipt_email_sent_at")
      .eq("tenant_id", context.tenantId)
      .eq("id", consent.consentId)
      .single();
    assertNoPostgrestError(consentError, "select consent receipt timestamp");
    assert.notEqual(consentRow.receipt_email_sent_at, null);
  } finally {
    process.env.APP_ORIGIN = originalOrigin;
  }
});

test("outbound email worker retries transport failures and later sends the queued job", async () => {
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example.test";

  try {
    const { context, consent } = await createConsentFixture();

    const queued = await enqueueConsentReceiptEmailJob({
      tenantId: context.tenantId,
      payload: {
        consentId: consent.consentId,
        revokeToken: consent.revokeToken!,
        subjectName: consent.subjectName,
        subjectEmail: consent.subjectEmail,
        projectName: consent.projectName,
        signedAtIso: consent.signedAt,
        consentText: consent.consentText,
        consentVersion: consent.consentVersion,
      },
      supabase: adminClient,
    });

    const firstRun = await runOutboundEmailWorker({
      workerId: `feature068-worker-first:${randomUUID()}`,
      batchSize: 1,
      supabase: adminClient,
      transport: {
        send: async () => {
          throw new Error("smtp unavailable password=<GMAIL_APP_PASSWORD>");
        },
      },
    });

    assert.equal(firstRun.claimed, 1);
    assert.equal(firstRun.retried, 1);
    assert.equal(firstRun.sent, 0);

    const { data: retriedJob, error: retriedError } = await adminClient
      .from("outbound_email_jobs")
      .select("status, attempt_count, run_after, last_error_code, last_error_message")
      .eq("tenant_id", context.tenantId)
      .eq("id", queued.jobId)
      .single();
    assertNoPostgrestError(retriedError, "select retried job");
    assert.equal(retriedJob.status, "pending");
    assert.equal(retriedJob.attempt_count, 1);
    assert.equal(retriedJob.last_error_code, "outbound_email_dispatch_failed");
    assert.equal(
      retriedJob.last_error_message,
      "Outbound email dispatch failed. Check server logs and SMTP configuration.",
    );
    assert.doesNotMatch(retriedJob.last_error_message ?? "", /<GMAIL_APP_PASSWORD>/);

    const { error: forceDueError } = await adminClient
      .from("outbound_email_jobs")
      .update({
        run_after: new Date(Date.now() - 60_000).toISOString(),
      })
      .eq("tenant_id", context.tenantId)
      .eq("id", queued.jobId);
    assertNoPostgrestError(forceDueError, "force due run_after");

    const secondRun = await runOutboundEmailWorker({
      workerId: `feature068-worker-second:${randomUUID()}`,
      batchSize: 1,
      supabase: adminClient,
      transport: {
        send: async () => ({ providerMessageId: "provider-message-2" }),
      },
    });

    assert.equal(secondRun.claimed, 1);
    assert.equal(secondRun.sent, 1);
    assert.equal(secondRun.retried, 0);

    const { data: sentJob, error: sentError } = await adminClient
      .from("outbound_email_jobs")
      .select("status, attempt_count, provider_message_id")
      .eq("tenant_id", context.tenantId)
      .eq("id", queued.jobId)
      .single();
    assertNoPostgrestError(sentError, "select sent job");
    assert.equal(sentJob.status, "sent");
    assert.equal(sentJob.attempt_count, 2);
    assert.equal(sentJob.provider_message_id, "provider-message-2");
  } finally {
    process.env.APP_ORIGIN = originalOrigin;
  }
});

test("tenant membership invite outbound email dedupes by invite send timestamp and cancels stale jobs", async () => {
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = "https://app.example.test";

  try {
    const owner = await createAuthUserWithRetry(adminClient, "feature068-membership-owner");

    const { data: tenant, error: tenantError } = await adminClient
      .from("tenants")
      .insert({
        name: `Feature 068 Membership Invite ${randomUUID()}`,
      })
      .select("id")
      .single();
    assertNoPostgrestError(tenantError, "insert tenant");

    const { error: membershipError } = await adminClient.from("memberships").insert({
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    });
    assertNoPostgrestError(membershipError, "insert membership");

    const inviteToken = `feature068-membership-invite-${randomUUID()}`;
    const refreshedLastSentAtIso = new Date("2026-04-22T08:15:45.000Z").toISOString();

    const { data: invite, error: inviteError } = await adminClient
      .from("tenant_membership_invites")
      .insert({
        tenant_id: tenant.id,
        email: "alex@example.com",
        normalized_email: "alex@example.com",
        role: "reviewer",
        status: "pending",
        token_hash: hashSha256(inviteToken),
        invited_by_user_id: owner.userId,
        expires_at: "2026-04-25T08:09:45.000Z",
        last_sent_at: "2026-04-22T08:09:45.000Z",
      })
      .select("id")
      .single();
    assertNoPostgrestError(inviteError, "insert tenant membership invite");

    const first = await enqueueTenantMembershipInviteEmailJob({
      tenantId: tenant.id,
      payload: {
        inviteId: invite.id,
        tenantId: tenant.id,
        tenantName: "Feature 068 Membership Invite",
        invitedEmail: "alex@example.com",
        role: "reviewer",
        inviteToken,
        expiresAtIso: "2026-04-25T08:09:45.000Z",
        lastSentAtIso: "2026-04-22T08:09:45.000Z",
        inviterDisplayName: "owner",
      },
      supabase: adminClient,
    });

    const duplicate = await enqueueTenantMembershipInviteEmailJob({
      tenantId: tenant.id,
      payload: {
        inviteId: invite.id,
        tenantId: tenant.id,
        tenantName: "Feature 068 Membership Invite",
        invitedEmail: "alex@example.com",
        role: "reviewer",
        inviteToken,
        expiresAtIso: "2026-04-25T08:09:45.000Z",
        lastSentAtIso: "2026-04-22T08:09:45.000Z",
        inviterDisplayName: "owner",
      },
      supabase: adminClient,
    });

    assert.equal(first.enqueued, true);
    assert.equal(duplicate.enqueued, false);
    assert.equal(first.jobId, duplicate.jobId);

    const { error: refreshError } = await adminClient
      .from("tenant_membership_invites")
      .update({
        last_sent_at: refreshedLastSentAtIso,
      })
      .eq("tenant_id", tenant.id)
      .eq("id", invite.id);
    assertNoPostgrestError(refreshError, "refresh invite last_sent_at");

    const dispatched = await dispatchOutboundEmailJobById({
      tenantId: tenant.id,
      jobId: first.jobId,
      supabase: adminClient,
      transport: {
        send: async () => ({ providerMessageId: "provider-message-membership-1" }),
      },
    });

    assert.equal(dispatched.outcome, "cancelled");

    const { data: job, error: jobError } = await adminClient
      .from("outbound_email_jobs")
      .select("status, cancelled_at, last_error_code")
      .eq("tenant_id", tenant.id)
      .eq("id", first.jobId)
      .single();
    assertNoPostgrestError(jobError, "select cancelled outbound email job");
    assert.equal(job.status, "cancelled");
    assert.notEqual(job.cancelled_at, null);
    assert.equal(job.last_error_code, "tenant_membership_invite_superseded");
  } finally {
    process.env.APP_ORIGIN = originalOrigin;
  }
});
