import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { HttpError } from "../src/lib/http/errors";
import {
  clearConsentAutoPhotoFaceLinks,
  clearConsentPhotoSuppressions,
  getManualPhotoLinkState,
  manualLinkPhotoToConsent,
  manualUnlinkPhotoFromConsent,
  reconcilePhotoFaceCanonicalStateForAsset,
} from "../src/lib/matching/consent-photo-matching";
import {
  buildMaterializeAssetFacesDedupeKey,
  enqueueMaterializeAssetFacesJob,
} from "../src/lib/matching/auto-match-jobs";
import {
  getAutoMatchCompareVersion,
  getAutoMatchConfidenceThreshold,
  getAutoMatchMaterializerVersion,
} from "../src/lib/matching/auto-match-config";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { runProjectMatchingRepair } from "../src/lib/matching/auto-match-repair";
import { ensureAssetFaceMaterialization } from "../src/lib/matching/face-materialization";
import { ensureMaterializedFaceCompare } from "../src/lib/matching/materialized-face-compare";
import { getProjectMatchingProgress } from "../src/lib/matching/project-matching-progress";
import { getDefaultProjectWorkspaceId } from "./helpers/supabase-test-client";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  consentTemplateId: string;
};

type ConsentContext = {
  consentId: string;
  headshotAssetId: string;
};

type TestFace = {
  faceRank: number;
};

function parseDotEnvLine(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFromLocalFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const result = new Map<string, string>();

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = parseDotEnvLine(trimmed.slice(delimiterIndex + 1));
    result.set(key, value);
  });

  return result;
}

function requireEnv(name: string, envFromFile: Map<string, string>) {
  const runtimeValue = process.env[name];
  if (runtimeValue && runtimeValue.trim().length > 0) {
    return runtimeValue.trim();
  }

  const fileValue = envFromFile.get(name);
  if (fileValue && fileValue.trim().length > 0) {
    return fileValue.trim();
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function assertNoError(error: PostgrestError | null, context: string) {
  if (!error) {
    return;
  }

  assert.fail(`${context}: ${error.code} ${error.message}`);
}

const envFromFile = loadEnvFromLocalFile();
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", envFromFile);
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFromFile);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function createMaterializationOnlyMatcher(facesByAssetId: Record<string, TestFace[]>): AutoMatcher {
  return {
    version: "feature-031-materialize-test",
    async match() {
      assert.fail("raw matcher path should not be used in feature 031 tests");
    },
    async materializeAssetFaces(input) {
      const faces = (facesByAssetId[input.assetId] ?? []).map((face) => ({
        faceRank: face.faceRank,
        providerFaceIndex: face.faceRank,
        detectionProbability: 0.99,
        faceBox: {
          xMin: face.faceRank * 10,
          yMin: face.faceRank * 10,
          xMax: face.faceRank * 10 + 40,
          yMax: face.faceRank * 10 + 50,
          probability: 0.99,
        },
        embedding: [0.9 - face.faceRank * 0.01, face.faceRank],
      })) satisfies AutoMatcherMaterializedFace[];

      return {
        faces,
        providerMetadata: {
          provider: "test-provider",
          providerMode: "detection",
          providerPluginVersions: {
            detector: "retinaface-test",
            calculator: "embedding-test",
          },
        },
      };
    },
    async compareEmbeddings() {
      assert.fail("embedding compare should not run in feature 031 tests");
    },
  };
}

function createFailingMaterializationMatcher(message = "feature031 direct materialization failure"): AutoMatcher {
  return {
    version: "feature-031-materialize-fail-test",
    async match() {
      assert.fail("raw matcher path should not be used in feature 031 tests");
    },
    async materializeAssetFaces() {
      throw new Error(message);
    },
    async compareEmbeddings() {
      assert.fail("embedding compare should not run in feature 031 tests");
    },
  };
}

function createEmbeddingCompareMatcher(similarities: number[]): AutoMatcher {
  return {
    version: "feature-031-compare-test",
    async match() {
      assert.fail("raw matcher path should not be used in feature 031 compare tests");
    },
    async materializeAssetFaces() {
      assert.fail("materialization should not run in feature 031 compare tests");
    },
    async compareEmbeddings() {
      return {
        targetSimilarities: similarities,
        providerMetadata: {
          provider: "test-provider",
          providerMode: "verification_embeddings",
          providerPluginVersions: {
            calculator: "embedding-test",
          },
        },
      };
    },
  };
}

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `feature031-${randomUUID()}@example.com`,
      password: `SnapConsent-${randomUUID()}-A1!`,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return data.user.id;
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "fetch failed"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 031 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: userId,
      name: `Feature 031 Project ${randomUUID()}`,
      description: "Feature 031 precedence rule tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");
  const workspaceId = await getDefaultProjectWorkspaceId(supabase, tenant.id, project.id);

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature031-template-${randomUUID()}`,
      name: "Feature 031 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 031 template body",
      status: "published",
      created_by: userId,
    })
    .select("id")
    .single();
  assertNoError(templateError, "insert consent template");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    workspaceId,
    userId,
    consentTemplateId: template.id,
  };
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature031-invite-${randomUUID()}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { error } = await supabase.from("subject_invites").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    workspace_id: context.workspaceId,
    created_by: context.userId,
    token_hash: tokenHash,
    status: "active",
    max_uses: 1,
    consent_template_id: context.consentTemplateId,
  });
  assertNoError(error, "insert invite");
  return token;
}

async function createAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  options: {
    assetType: "photo" | "headshot";
    retentionDays?: number;
  },
) {
  const uploadedAt = new Date().toISOString();
  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/test.jpg`,
      original_filename: `${options.assetType}-${randomUUID()}.jpg`,
      content_type: "image/jpeg",
      file_size_bytes: 2048,
      content_hash: randomUUID().replaceAll("-", ""),
      content_hash_algo: "sha256",
      status: "uploaded",
      uploaded_at: uploadedAt,
      asset_type: options.assetType,
      retention_expires_at:
        options.assetType === "headshot" && options.retentionDays
          ? new Date(Date.now() + options.retentionDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
    })
    .select("id")
    .single();
  assertNoError(error, "insert asset");
  return asset.id as string;
}

async function createOptedInConsentWithHeadshot(
  supabase: SupabaseClient,
  context: ProjectContext,
  headshotAssetId?: string,
): Promise<ConsentContext> {
  const token = await createInviteToken(supabase, context);
  const resolvedHeadshotAssetId =
    headshotAssetId ??
    (await createAsset(supabase, context, {
      assetType: "headshot",
      retentionDays: 30,
    }));

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 031 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId: resolvedHeadshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-031-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId: resolvedHeadshotAssetId,
  };
}

async function materializeAsset(
  context: ProjectContext,
  assetId: string,
  faces: TestFace[],
) {
  const matcher = createMaterializationOnlyMatcher({
    [assetId]: faces,
  });

  const current = await ensureAssetFaceMaterialization({
    supabase: admin,
    matcher,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    includeFaces: true,
  });

  if (!current) {
    assert.fail(`Expected materialization for asset ${assetId}`);
  }

  return current;
}

async function seedCompareRow(input: {
  context: ProjectContext;
  consentId: string;
  assetId: string;
  headshotMaterializationId: string;
  headshotFaceId: string | null;
  assetMaterializationId: string;
  winningAssetFaceId: string | null;
  winningAssetFaceRank: number | null;
  winningSimilarity: number;
  compareStatus?: "matched" | "no_match" | "source_unusable";
  targetFaceCount: number;
}) {
  const { error } = await admin.from("asset_consent_face_compares").upsert(
    {
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      workspace_id: input.context.workspaceId,
      asset_id: input.assetId,
      consent_id: input.consentId,
      headshot_materialization_id: input.headshotMaterializationId,
      asset_materialization_id: input.assetMaterializationId,
      headshot_face_id: input.headshotFaceId,
      winning_asset_face_id: input.winningAssetFaceId,
      winning_asset_face_rank: input.winningAssetFaceRank,
      winning_similarity: input.winningSimilarity,
      compare_status: input.compareStatus ?? "matched",
      compare_version: getAutoMatchCompareVersion(),
      provider: "test-provider",
      provider_mode: "verification_embeddings",
      provider_plugin_versions: {
        calculator: "embedding-test",
      },
      target_face_count: input.targetFaceCount,
      compared_at: new Date().toISOString(),
    },
    {
      onConflict:
        "tenant_id,project_id,consent_id,asset_id,headshot_materialization_id,asset_materialization_id,compare_version",
    },
  );
  assertNoError(error, "seed compare row");
}

async function getFaceLinks(
  context: ProjectContext,
  filters?: {
    assetId?: string;
    consentId?: string;
  },
) {
  let query = admin
    .from("asset_face_consent_links")
    .select("asset_face_id, asset_materialization_id, asset_id, consent_id, link_source, match_confidence")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("asset_id", { ascending: true })
    .order("consent_id", { ascending: true });

  if (filters?.assetId) {
    query = query.eq("asset_id", filters.assetId);
  }

  if (filters?.consentId) {
    query = query.eq("consent_id", filters.consentId);
  }

  const { data, error } = await query;
  assertNoError(error, "select face links");
  return (data ?? []) as Array<{
    asset_face_id: string;
    asset_materialization_id: string;
    asset_id: string;
    consent_id: string;
    link_source: "manual" | "auto";
    match_confidence: number | null;
  }>;
}

async function getConsentAssigneeId(context: ProjectContext, consentId: string) {
  const { data, error } = await admin
    .from("project_face_assignees")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("assignee_kind", "project_consent")
    .eq("consent_id", consentId)
    .maybeSingle();
  assertNoError(error, "select consent assignee");
  return (data as { id: string } | null)?.id ?? null;
}

async function getFaceSuppressions(
  context: ProjectContext,
  filters?: {
    assetId?: string;
    consentId?: string;
  },
) {
  let query = admin
    .from("asset_face_assignee_link_suppressions")
    .select("asset_face_id, asset_materialization_id, asset_id, project_face_assignee_id, reason")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("asset_id", { ascending: true })
    .order("project_face_assignee_id", { ascending: true });

  if (filters?.assetId) {
    query = query.eq("asset_id", filters.assetId);
  }

  if (filters?.consentId) {
    const assigneeId = await getConsentAssigneeId(context, filters.consentId);
    if (!assigneeId) {
      return [];
    }
    query = query.eq("project_face_assignee_id", assigneeId);
  }

  const { data, error } = await query;
  assertNoError(error, "select face suppressions");
  const rows = (data ?? []) as Array<{
    asset_face_id: string;
    asset_materialization_id: string;
    asset_id: string;
    project_face_assignee_id: string;
    reason: "manual_unlink" | "manual_replace";
  }>;
  const assigneeIds = Array.from(new Set(rows.map((row) => row.project_face_assignee_id)));
  let consentIdByAssigneeId = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: assignees, error: assigneeError } = await admin
      .from("project_face_assignees")
      .select("id, consent_id")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", context.projectId)
      .in("id", assigneeIds);
    assertNoError(assigneeError, "select suppression assignees");
    consentIdByAssigneeId = new Map(
      ((assignees ?? []) as Array<{ id: string; consent_id: string | null }>)
        .filter((row) => typeof row.consent_id === "string" && row.consent_id.length > 0)
        .map((row) => [row.id, row.consent_id as string] as const),
    );
  }

  return rows
    .map((row) => ({
      asset_face_id: row.asset_face_id,
      asset_materialization_id: row.asset_materialization_id,
      asset_id: row.asset_id,
      consent_id: consentIdByAssigneeId.get(row.project_face_assignee_id) ?? "",
      reason: row.reason,
    }))
    .filter((row) => row.consent_id.length > 0);
}

async function getFallbackRows(
  context: ProjectContext,
  filters?: {
    assetId?: string;
    consentId?: string;
  },
) {
  let query = admin
    .from("asset_assignee_links")
    .select("asset_id, project_face_assignee_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("asset_id", { ascending: true })
    .order("project_face_assignee_id", { ascending: true });

  if (filters?.assetId) {
    query = query.eq("asset_id", filters.assetId);
  }

  if (filters?.consentId) {
    const assigneeId = await getConsentAssigneeId(context, filters.consentId);
    if (!assigneeId) {
      return [];
    }

    query = query.eq("project_face_assignee_id", assigneeId);
  }

  const { data, error } = await query;
  assertNoError(error, "select fallback rows");
  const rows = (data ?? []) as Array<{
    asset_id: string;
    project_face_assignee_id: string;
  }>;
  const assigneeIds = Array.from(new Set(rows.map((row) => row.project_face_assignee_id)));
  let consentIdByAssigneeId = new Map<string, string>();
  if (assigneeIds.length > 0) {
    const { data: assignees, error: assigneeError } = await admin
      .from("project_face_assignees")
      .select("id, consent_id")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", context.projectId)
      .in("id", assigneeIds);
    assertNoError(assigneeError, "select fallback assignees");
    consentIdByAssigneeId = new Map(
      ((assignees ?? []) as Array<{ id: string; consent_id: string | null }>)
        .filter((row) => typeof row.consent_id === "string" && row.consent_id.length > 0)
        .map((row) => [row.id, row.consent_id as string] as const),
    );
  }

  return rows
    .map((row) => ({
      asset_id: row.asset_id,
      consent_id: consentIdByAssigneeId.get(row.project_face_assignee_id) ?? "",
    }))
    .filter((row) => row.consent_id.length > 0);
}

async function getFallbackSuppressions(
  context: ProjectContext,
  filters?: {
    assetId?: string;
    consentId?: string;
  },
) {
  let query = admin
    .from("asset_consent_manual_photo_fallback_suppressions")
    .select("asset_id, consent_id, reason")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("asset_id", { ascending: true })
    .order("consent_id", { ascending: true });

  if (filters?.assetId) {
    query = query.eq("asset_id", filters.assetId);
  }

  if (filters?.consentId) {
    query = query.eq("consent_id", filters.consentId);
  }

  const { data, error } = await query;
  assertNoError(error, "select fallback suppressions");
  return (data ?? []) as Array<{
    asset_id: string;
    consent_id: string;
    reason: "manual_unlink";
  }>;
}

async function countRows(table: string, filters: Array<[column: string, value: string]>) {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;
  assertNoError(error, `count ${table}`);
  return count ?? 0;
}

async function getLatestMaterializeJob(context: ProjectContext, assetId: string) {
  const { data, error } = await admin
    .from("face_match_jobs")
    .select("id, status, attempt_count, requeue_count, last_requeue_reason, payload")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("job_type", "materialize_asset_faces")
    .eq("scope_asset_id", assetId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assertNoError(error, "select latest materialize job");
  return (data ?? null) as
    | {
        id: string;
        status: string;
        attempt_count: number;
        requeue_count: number;
        last_requeue_reason: string | null;
        payload: Record<string, unknown> | null;
      }
    | null;
}

async function revokeConsent(context: ProjectContext, consentId: string) {
  const { error } = await admin
    .from("consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", consentId);
  assertNoError(error, "revoke consent");
}

async function replaceHeadshotLink(
  context: ProjectContext,
  consentId: string,
  oldHeadshotAssetId: string,
  newHeadshotAssetId: string,
) {
  const { error: deleteError } = await admin
    .from("asset_consent_links")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("consent_id", consentId)
    .eq("asset_id", oldHeadshotAssetId);
  assertNoError(deleteError, "delete old headshot link");

  const { error: insertError } = await admin.from("asset_consent_links").upsert(
    {
      asset_id: newHeadshotAssetId,
      consent_id: consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: null,
      reviewed_by: null,
      matcher_version: null,
    },
    { onConflict: "asset_id,consent_id" },
  );
  assertNoError(insertError, "insert replacement headshot link");
}

async function expectHttpError(
  promise: Promise<unknown>,
  expectedStatus: number,
  expectedCode: string,
) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof HttpError, `Expected HttpError, received ${String(error)}`);
    assert.equal(error.status, expectedStatus);
    assert.equal(error.code, expectedCode);
    return;
  }

  assert.fail(`Expected ${expectedCode} (${expectedStatus}) to be thrown`);
}

function faceSeed(count: number) {
  return Array.from({ length: count }, (_, faceRank) => ({ faceRank }));
}

function getAboveThresholdConfidence() {
  return Math.min(0.99, getAutoMatchConfidenceThreshold() + 0.05);
}

test("manual link state materializes directly on demand and stays compatible with project progress", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const matcher = createMaterializationOnlyMatcher({
    [photoAssetId]: faceSeed(1),
  });

  const state = await getManualPhotoLinkState({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: photoAssetId,
    matcher,
  });

  assert.equal(state.materializationStatus, "ready");
  assert.equal(state.assetId, photoAssetId);
  assert.ok(state.materializationId);
  assert.equal(state.detectedFaceCount, 1);
  assert.equal(state.faces.length, 1);
  assert.equal(state.currentConsentLink, null);
  assert.equal(
    await countRows("face_match_jobs", [
      ["tenant_id", context.tenantId],
      ["project_id", context.projectId],
      ["job_type", "materialize_asset_faces"],
      ["scope_asset_id", photoAssetId],
    ]),
    0,
  );

  const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId, context.workspaceId);
  assert.equal(typeof progress.isMatchingInProgress, "boolean");
});

test("manual link state returns ready from an existing materialization without queueing", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const materializedPhoto = await materializeAsset(context, photoAssetId, faceSeed(1));

  const readyState = await getManualPhotoLinkState({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: photoAssetId,
  });

  assert.equal(readyState.materializationStatus, "ready");
  assert.equal(readyState.materializationId, materializedPhoto.materialization.id);
  assert.equal(readyState.detectedFaceCount, 1);
  assert.equal(readyState.faces.length, 1);
  assert.equal(readyState.faces[0]?.assetFaceId, materializedPhoto.faces[0]?.id);
});

test("manual link state rematerializes an existing stale zero-face photo before reporting fallback-only state", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const staleMaterialization = await materializeAsset(context, photoAssetId, []);

  const repairedState = await getManualPhotoLinkState({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: photoAssetId,
    matcher: createMaterializationOnlyMatcher({
      [photoAssetId]: faceSeed(1),
    }),
  });

  assert.equal(repairedState.materializationStatus, "ready");
  assert.equal(repairedState.materializationId, staleMaterialization.materialization.id);
  assert.equal(repairedState.detectedFaceCount, 1);
  assert.equal(repairedState.faces.length, 1);
  assert.equal(repairedState.fallbackAllowed, false);
});

test("concurrent manual link state reads do not fail on direct materialization races", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const matcher = createMaterializationOnlyMatcher({
    [photoAssetId]: faceSeed(1),
  });

  const results = await Promise.all([
    getManualPhotoLinkState({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetId: photoAssetId,
      matcher,
    }),
    getManualPhotoLinkState({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetId: photoAssetId,
      matcher,
    }),
  ]);

  assert.equal(results.length, 2);
  assert.ok(results.every((state) => state.materializationStatus === "ready"));
  assert.equal(
    await countRows("asset_face_materializations", [
      ["tenant_id", context.tenantId],
      ["project_id", context.projectId],
      ["asset_id", photoAssetId],
    ]),
    1,
  );
  assert.equal(
    await countRows("face_match_jobs", [
      ["tenant_id", context.tenantId],
      ["project_id", context.projectId],
      ["job_type", "materialize_asset_faces"],
      ["scope_asset_id", photoAssetId],
    ]),
    0,
  );
});

test("manual link state direct materialization is not blocked by unrelated queued backlog", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const backlogAssetIds = await Promise.all([
    createAsset(admin, context, { assetType: "photo" }),
    createAsset(admin, context, { assetType: "photo" }),
  ]);
  const matcher = createMaterializationOnlyMatcher({
    [photoAssetId]: faceSeed(2),
  });

  for (const backlogAssetId of backlogAssetIds) {
    await enqueueMaterializeAssetFacesJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: backlogAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      supabase: admin,
    });
  }

  assert.equal(
    await countRows("face_match_jobs", [
      ["tenant_id", context.tenantId],
      ["project_id", context.projectId],
      ["job_type", "materialize_asset_faces"],
    ]),
    backlogAssetIds.length,
  );

  const state = await getManualPhotoLinkState({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: photoAssetId,
    matcher,
  });

  assert.equal(state.materializationStatus, "ready");
  assert.equal(state.detectedFaceCount, 2);
  assert.equal(state.faces.length, 2);
  assert.equal(
    await countRows("face_match_jobs", [
      ["tenant_id", context.tenantId],
      ["project_id", context.projectId],
      ["job_type", "materialize_asset_faces"],
    ]),
    backlogAssetIds.length,
  );
  assert.equal(
    await countRows("face_match_jobs", [
      ["tenant_id", context.tenantId],
      ["project_id", context.projectId],
      ["job_type", "materialize_asset_faces"],
      ["scope_asset_id", photoAssetId],
    ]),
    0,
  );
});

test("manual link state falls back to repair-requeue when direct materialization fails", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const dedupeKey = buildMaterializeAssetFacesDedupeKey(photoAssetId, getAutoMatchMaterializerVersion());

  const { error: insertError } = await admin.from("face_match_jobs").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    scope_asset_id: photoAssetId,
    scope_consent_id: null,
    job_type: "materialize_asset_faces",
    dedupe_key: dedupeKey,
    payload: {
      materializerVersion: getAutoMatchMaterializerVersion(),
      source: "stale_test",
    },
    status: "dead",
    attempt_count: 5,
    max_attempts: 5,
    run_after: new Date(Date.now() - 60_000).toISOString(),
    last_error_code: "stale_dead_test",
    last_error_message: "stale dead job",
    last_error_at: new Date().toISOString(),
  });
  assertNoError(insertError, "insert stale dead materialize job");

  const state = await getManualPhotoLinkState({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: photoAssetId,
    matcher: createFailingMaterializationMatcher(),
  });

  assert.ok(state.materializationStatus === "queued" || state.materializationStatus === "processing");
  const repairedJob = await getLatestMaterializeJob(context, photoAssetId);
  assert.ok(repairedJob);
  assert.ok(repairedJob.status === "queued" || repairedJob.status === "processing");
  assert.equal(repairedJob.attempt_count, 0);
  assert.ok((repairedJob.requeue_count ?? 0) >= 1);
  assert.equal(repairedJob.last_requeue_reason, "manual_link_state");
});

test("materialized compares are recomputed when a current materialization is refreshed in place", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));
  const staleHeadshot = await materializeAsset(context, consent.headshotAssetId, []);

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: staleHeadshot.materialization.id,
    headshotFaceId: null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: null,
    winningAssetFaceRank: null,
    winningSimilarity: 0,
    compareStatus: "source_unusable",
    targetFaceCount: photo.faces.length,
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const repairedHeadshot = await ensureAssetFaceMaterialization({
    supabase: admin,
    matcher: createMaterializationOnlyMatcher({
      [consent.headshotAssetId]: faceSeed(1),
    }),
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: consent.headshotAssetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    includeFaces: true,
    forceRematerialize: true,
  });

  assert.ok(repairedHeadshot);
  assert.equal(repairedHeadshot?.materialization.id, staleHeadshot.materialization.id);
  assert.equal(repairedHeadshot?.faces.length, 1);

  const compare = await ensureMaterializedFaceCompare({
    supabase: admin,
    matcher: createEmbeddingCompareMatcher([0.93]),
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: repairedHeadshot?.materialization.id as string,
    assetMaterializationId: photo.materialization.id,
    compareVersion: getAutoMatchCompareVersion(),
  });

  assert.equal(compare.compare.compare_status, "matched");
  assert.equal(compare.compare.winning_asset_face_id, photo.faces[0]?.id ?? null);
  assert.equal(compare.compare.winning_asset_face_rank, photo.faces[0]?.face_rank ?? null);
  assert.equal(compare.compare.headshot_face_id, repairedHeadshot?.faces[0]?.id ?? null);
  assert.equal(compare.compare.winning_similarity, 0.93);
});

test("manual linking defaults the only detected face and duplicate writes stay idempotent", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));

  const firstResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
  });
  const secondResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
  });

  assert.equal(firstResult.kind, "linked");
  assert.equal(firstResult.mode, "face");
  assert.equal(secondResult.kind, "already_linked");

  const faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.asset_face_id, photo.faces[0]?.id);
  assert.equal(faceLinks[0]?.consent_id, consent.consentId);
  assert.equal(faceLinks[0]?.link_source, "manual");
  assert.equal((await getFaceSuppressions(context, { assetId: photoAssetId })).length, 0);
});

test("manual linking requires an explicit face selection when multiple faces exist", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializeAsset(context, photoAssetId, faceSeed(2));

  await expectHttpError(
    manualLinkPhotoToConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      actorUserId: context.userId,
      assetId: photoAssetId,
    }),
    409,
    "asset_face_selection_required",
  );

  const explicitResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[1]?.id,
    mode: "face",
  });

  assert.equal(explicitResult.kind, "linked");
  const faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.asset_face_id, photo.faces[1]?.id);
});

test("zero-face fallback stays separate from face ownership and duplicate unlinks are idempotent", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  await materializeAsset(context, photoAssetId, []);

  const linkResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    mode: "asset_fallback",
  });
  const duplicateLinkResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    mode: "asset_fallback",
  });

  assert.equal(linkResult.kind, "linked");
  assert.equal(duplicateLinkResult.kind, "already_linked");
  assert.equal((await getFaceLinks(context, { assetId: photoAssetId })).length, 0);
  assert.equal((await getFallbackRows(context, { assetId: photoAssetId })).length, 1);

  await expectHttpError(
    manualLinkPhotoToConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      actorUserId: context.userId,
      assetId: photoAssetId,
      mode: "face",
    }),
    409,
    "photo_zero_faces_only_fallback",
  );

  await manualUnlinkPhotoFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    mode: "asset_fallback",
  });
  await manualUnlinkPhotoFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    mode: "asset_fallback",
  });

  assert.equal((await getFallbackRows(context, { assetId: photoAssetId })).length, 0);
  const fallbackSuppressions = await getFallbackSuppressions(context, { assetId: photoAssetId });
  assert.equal(fallbackSuppressions.length, 1);
  assert.equal(fallbackSuppressions[0]?.reason, "manual_unlink");
});

test("reconcile keeps only one auto winner per face and applies deterministic tie breaks", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consentA = await createOptedInConsentWithHeadshot(admin, context);
  const consentB = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));
  const headshotA = await materializeAsset(context, consentA.headshotAssetId, faceSeed(1));
  const headshotB = await materializeAsset(context, consentB.headshotAssetId, faceSeed(1));

  const higherConfidence = getAboveThresholdConfidence();
  const lowerConfidence = Math.max(getAutoMatchConfidenceThreshold(), higherConfidence - 0.03);

  await seedCompareRow({
    context,
    consentId: consentA.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshotA.materialization.id,
    headshotFaceId: headshotA.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: lowerConfidence,
    targetFaceCount: photo.faces.length,
  });
  await seedCompareRow({
    context,
    consentId: consentB.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshotB.materialization.id,
    headshotFaceId: headshotB.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: higherConfidence,
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  let faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, consentB.consentId);
  assert.equal(faceLinks[0]?.link_source, "auto");

  const tieConfidence = higherConfidence;
  await seedCompareRow({
    context,
    consentId: consentA.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshotA.materialization.id,
    headshotFaceId: headshotA.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: tieConfidence,
    targetFaceCount: photo.faces.length,
  });
  await seedCompareRow({
    context,
    consentId: consentB.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshotB.materialization.id,
    headshotFaceId: headshotB.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: tieConfidence,
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, [consentA.consentId, consentB.consentId].sort()[0]);
});

test("manual link replaces auto on the same face and blocks later auto overwrite", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const autoConsent = await createOptedInConsentWithHeadshot(admin, context);
  const manualConsent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));
  const autoHeadshot = await materializeAsset(context, autoConsent.headshotAssetId, faceSeed(1));
  const manualHeadshot = await materializeAsset(context, manualConsent.headshotAssetId, faceSeed(1));

  const confidence = getAboveThresholdConfidence();
  await seedCompareRow({
    context,
    consentId: autoConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: autoHeadshot.materialization.id,
    headshotFaceId: autoHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: confidence,
    targetFaceCount: photo.faces.length,
  });
  await seedCompareRow({
    context,
    consentId: manualConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: manualHeadshot.materialization.id,
    headshotFaceId: manualHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: confidence - 0.01,
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  let faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, autoConsent.consentId);
  assert.equal(faceLinks[0]?.link_source, "auto");

  const manualResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: manualConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id,
    mode: "face",
  });

  assert.equal(manualResult.kind, "linked");
  faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, manualConsent.consentId);
  assert.equal(faceLinks[0]?.link_source, "manual");

  const suppressions = await getFaceSuppressions(context, { assetId: photoAssetId });
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.consent_id, autoConsent.consentId);
  assert.equal(suppressions[0]?.reason, "manual_replace");

  await seedCompareRow({
    context,
    consentId: autoConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: autoHeadshot.materialization.id,
    headshotFaceId: autoHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: Math.min(0.99, confidence + 0.02),
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, manualConsent.consentId);
  assert.equal(faceLinks[0]?.link_source, "manual");
});

test("manual conflicts require forceReplace and duplicate manual replacements stay idempotent", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const firstConsent = await createOptedInConsentWithHeadshot(admin, context);
  const secondConsent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: firstConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id,
    mode: "face",
  });

  const conflict = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: secondConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id,
    mode: "face",
  });

  assert.equal(conflict.kind, "manual_conflict");
  assert.equal(conflict.canForceReplace, true);

  const replaceResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: secondConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id,
    mode: "face",
    forceReplace: true,
  });
  const duplicateReplaceResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: secondConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id,
    mode: "face",
    forceReplace: true,
  });

  assert.equal(replaceResult.kind, "linked");
  assert.equal(duplicateReplaceResult.kind, "already_linked");

  const faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, secondConsent.consentId);
  assert.equal(faceLinks[0]?.link_source, "manual");

  const suppressions = await getFaceSuppressions(context, { assetId: photoAssetId });
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.consent_id, firstConsent.consentId);
  assert.equal(suppressions[0]?.reason, "manual_replace");
});

test("manual unlink creates a face-specific suppression and blocks auto replay", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));
  const headshot = await materializeAsset(context, consent.headshotAssetId, faceSeed(1));

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshot.materialization.id,
    headshotFaceId: headshot.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence(),
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  await manualUnlinkPhotoFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
  });
  await manualUnlinkPhotoFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
  });

  assert.equal((await getFaceLinks(context, { assetId: photoAssetId })).length, 0);
  const suppressions = await getFaceSuppressions(context, { assetId: photoAssetId });
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.consent_id, consent.consentId);
  assert.equal(suppressions[0]?.reason, "manual_unlink");

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  assert.equal((await getFaceLinks(context, { assetId: photoAssetId })).length, 0);
});

test("group photos can assign different consents to different faces", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const leftConsent = await createOptedInConsentWithHeadshot(admin, context);
  const rightConsent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, faceSeed(2));
  const leftHeadshot = await materializeAsset(context, leftConsent.headshotAssetId, faceSeed(1));
  const rightHeadshot = await materializeAsset(context, rightConsent.headshotAssetId, faceSeed(1));

  await seedCompareRow({
    context,
    consentId: leftConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: leftHeadshot.materialization.id,
    headshotFaceId: leftHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence(),
    targetFaceCount: photo.faces.length,
  });
  await seedCompareRow({
    context,
    consentId: rightConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: rightHeadshot.materialization.id,
    headshotFaceId: rightHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[1]?.id ?? null,
    winningAssetFaceRank: photo.faces[1]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence() - 0.01,
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  const faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 2);
  assert.deepEqual(
    new Set(faceLinks.map((row) => `${row.asset_face_id}:${row.consent_id}`)),
    new Set([
      `${photo.faces[0]?.id}:${leftConsent.consentId}`,
      `${photo.faces[1]?.id}:${rightConsent.consentId}`,
    ]),
  );
});

test("the same consent can move between faces in one asset but cannot keep two current faces", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializeAsset(context, photoAssetId, faceSeed(2));

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id,
    mode: "face",
  });
  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[1]?.id,
    mode: "face",
  });

  const faceLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(faceLinks.length, 1);
  assert.equal(faceLinks[0]?.consent_id, consent.consentId);
  assert.equal(faceLinks[0]?.asset_face_id, photo.faces[1]?.id);

  const suppressions = await getFaceSuppressions(context, { assetId: photoAssetId, consentId: consent.consentId });
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.asset_face_id, photo.faces[0]?.id);
});

test("headshot replacement helpers clear auto links and suppressions for that consent but preserve manual rows and fallbacks", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const replacementHeadshotAssetId = await createAsset(admin, context, {
    assetType: "headshot",
    retentionDays: 30,
  });

  const autoPhotoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const manualPhotoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const suppressedPhotoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const fallbackPhotoAssetId = await createAsset(admin, context, { assetType: "photo" });

  const currentHeadshot = await materializeAsset(context, consent.headshotAssetId, faceSeed(1));
  const replacementHeadshot = await materializeAsset(context, replacementHeadshotAssetId, faceSeed(1));
  const autoPhoto = await materializeAsset(context, autoPhotoAssetId, faceSeed(1));
  const manualPhoto = await materializeAsset(context, manualPhotoAssetId, faceSeed(1));
  const suppressedPhoto = await materializeAsset(context, suppressedPhotoAssetId, faceSeed(1));
  await materializeAsset(context, fallbackPhotoAssetId, []);

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: autoPhotoAssetId,
    headshotMaterializationId: currentHeadshot.materialization.id,
    headshotFaceId: currentHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: autoPhoto.materialization.id,
    winningAssetFaceId: autoPhoto.faces[0]?.id ?? null,
    winningAssetFaceRank: autoPhoto.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence(),
    targetFaceCount: autoPhoto.faces.length,
  });
  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: autoPhotoAssetId,
  });

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: manualPhotoAssetId,
    assetFaceId: manualPhoto.faces[0]?.id,
    mode: "face",
  });
  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: fallbackPhotoAssetId,
    mode: "asset_fallback",
  });

  const suppressedAssigneeId = await getConsentAssigneeId(context, consent.consentId);
  assert.ok(suppressedAssigneeId);

  const { error: suppressionError } = await admin.from("asset_face_assignee_link_suppressions").upsert(
    {
      asset_face_id: suppressedPhoto.faces[0]?.id,
      asset_materialization_id: suppressedPhoto.materialization.id,
      asset_id: suppressedPhotoAssetId,
      project_face_assignee_id: suppressedAssigneeId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      reason: "manual_unlink",
      created_by: context.userId,
    },
    { onConflict: "asset_face_id,project_face_assignee_id" },
  );
  assertNoError(suppressionError, "seed face suppression");

  const { error: fallbackSuppressionError } = await admin.from("asset_consent_manual_photo_fallback_suppressions").upsert(
    {
      asset_id: fallbackPhotoAssetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      reason: "manual_unlink",
      created_by: context.userId,
    },
    { onConflict: "asset_id,consent_id" },
  );
  assertNoError(fallbackSuppressionError, "seed fallback suppression");

  await replaceHeadshotLink(context, consent.consentId, consent.headshotAssetId, replacementHeadshotAssetId);
  await clearConsentPhotoSuppressions({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
  });
  await clearConsentAutoPhotoFaceLinks({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
  });

  assert.equal((await getFaceLinks(context, { assetId: autoPhotoAssetId })).length, 0);
  const manualFaceLinks = await getFaceLinks(context, { assetId: manualPhotoAssetId });
  assert.equal(manualFaceLinks.length, 1);
  assert.equal(manualFaceLinks[0]?.link_source, "manual");
  assert.equal((await getFaceSuppressions(context, { consentId: consent.consentId })).length, 0);
  assert.equal((await getFallbackSuppressions(context, { consentId: consent.consentId })).length, 0);
  assert.equal((await getFallbackRows(context, { assetId: fallbackPhotoAssetId })).length, 1);

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: autoPhotoAssetId,
    headshotMaterializationId: replacementHeadshot.materialization.id,
    headshotFaceId: replacementHeadshot.faces[0]?.id ?? null,
    assetMaterializationId: autoPhoto.materialization.id,
    winningAssetFaceId: autoPhoto.faces[0]?.id ?? null,
    winningAssetFaceRank: autoPhoto.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence(),
    targetFaceCount: autoPhoto.faces.length,
  });
  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: autoPhotoAssetId,
  });

  const rebuiltAutoFaceLinks = await getFaceLinks(context, { assetId: autoPhotoAssetId });
  assert.equal(rebuiltAutoFaceLinks.length, 1);
  assert.equal(rebuiltAutoFaceLinks[0]?.consent_id, consent.consentId);
  assert.equal(rebuiltAutoFaceLinks[0]?.link_source, "auto");
});

test("revoked consents keep existing rows but cannot gain new manual or auto assignments", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const existingPhotoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const newPhotoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const existingPhoto = await materializeAsset(context, existingPhotoAssetId, faceSeed(1));
  const newPhoto = await materializeAsset(context, newPhotoAssetId, faceSeed(1));
  const headshot = await materializeAsset(context, consent.headshotAssetId, faceSeed(1));

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: existingPhotoAssetId,
    assetFaceId: existingPhoto.faces[0]?.id,
    mode: "face",
  });

  await revokeConsent(context, consent.consentId);

  await expectHttpError(
    manualLinkPhotoToConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      actorUserId: context.userId,
      assetId: newPhotoAssetId,
      assetFaceId: newPhoto.faces[0]?.id,
      mode: "face",
    }),
    409,
    "consent_revoked",
  );
  await expectHttpError(
    getManualPhotoLinkState({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetId: newPhotoAssetId,
    }),
    409,
    "consent_revoked",
  );

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: newPhotoAssetId,
    headshotMaterializationId: headshot.materialization.id,
    headshotFaceId: headshot.faces[0]?.id ?? null,
    assetMaterializationId: newPhoto.materialization.id,
    winningAssetFaceId: newPhoto.faces[0]?.id ?? null,
    winningAssetFaceRank: newPhoto.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence(),
    targetFaceCount: newPhoto.faces.length,
  });
  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: newPhotoAssetId,
  });

  const existingRows = await getFaceLinks(context, { assetId: existingPhotoAssetId });
  assert.equal(existingRows.length, 1);
  assert.equal(existingRows[0]?.consent_id, consent.consentId);
  assert.equal((await getFaceLinks(context, { assetId: newPhotoAssetId })).length, 0);
});

test("project repair recreates deterministic face-level auto state from current compare rows", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consentA = await createOptedInConsentWithHeadshot(admin, context);
  const consentB = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, faceSeed(1));
  const headshotA = await materializeAsset(context, consentA.headshotAssetId, faceSeed(1));
  const headshotB = await materializeAsset(context, consentB.headshotAssetId, faceSeed(1));

  await seedCompareRow({
    context,
    consentId: consentA.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshotA.materialization.id,
    headshotFaceId: headshotA.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence() - 0.02,
    targetFaceCount: photo.faces.length,
  });
  await seedCompareRow({
    context,
    consentId: consentB.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshotB.materialization.id,
    headshotFaceId: headshotB.faces[0]?.id ?? null,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photo.faces[0]?.id ?? null,
    winningAssetFaceRank: photo.faces[0]?.face_rank ?? null,
    winningSimilarity: getAboveThresholdConfidence(),
    targetFaceCount: photo.faces.length,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  const originalWinner = (await getFaceLinks(context, { assetId: photoAssetId }))[0];
  assert.ok(originalWinner);

  const { error: deleteError } = await admin
    .from("asset_face_consent_links")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId);
  assertNoError(deleteError, "delete canonical face links");

  const repairResult = await runProjectMatchingRepair({
    projectId: context.projectId,
    batchSize: 20,
    reason: "feature031_missing_face_links",
    supabase: admin,
  });
  assert.ok(repairResult.scannedPhotos >= 1);

  const rebuiltLinks = await getFaceLinks(context, { assetId: photoAssetId });
  assert.equal(rebuiltLinks.length, 1);
  assert.equal(rebuiltLinks[0]?.consent_id, originalWinner.consent_id);
  assert.equal(rebuiltLinks[0]?.asset_face_id, originalWinner.asset_face_id);
});
