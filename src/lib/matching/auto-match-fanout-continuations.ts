import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";
import { getAutoMatchCompareVersion } from "@/lib/matching/auto-match-config";
import {
  enqueueCompareMaterializedPairJob,
  enqueueCompareRecurringProfileMaterializedPairJob,
  enqueueMaterializeAssetFacesJob,
  type RepairFaceMatchJobResult,
} from "@/lib/matching/auto-match-jobs";
import {
  getCurrentProjectRecurringSourceBoundary,
  listReadyProjectRecurringSourcesPage,
  resolveAutoEligibleProjectRecurringSource,
  type ReadyProjectRecurringSource,
} from "@/lib/matching/project-recurring-sources";
import {
  loadConsentHeadshotMaterialization,
  loadCurrentAssetFaceMaterialization,
  loadEligibleAssetForMaterialization,
} from "@/lib/matching/face-materialization";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

export type PhotoFanoutBoundary = {
  boundarySnapshotAt: string;
  boundaryConsentCreatedAt: string | null;
  boundaryConsentId: string | null;
};

export type HeadshotFanoutBoundary = {
  boundarySnapshotAt: string;
  boundaryPhotoUploadedAt: string | null;
  boundaryPhotoAssetId: string | null;
};

export type RecurringProfileFanoutBoundary = {
  boundarySnapshotAt: string;
  boundaryParticipantCreatedAt: string | null;
  boundaryProjectProfileParticipantId: string | null;
};

export type FanoutDirection =
  | "photo_to_headshots"
  | "headshot_to_photos"
  | "photo_to_recurring_profiles"
  | "recurring_profile_to_photos";
export type FanoutDispatchMode = "normal" | "backfill_repair";

export const FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS = 50;

type FanoutBoundaryPhotoRow = {
  boundary_snapshot_at: string;
  boundary_uploaded_at: string | null;
  boundary_asset_id: string | null;
};

type FanoutBoundaryHeadshotRow = {
  boundary_snapshot_at: string;
  boundary_consent_created_at: string | null;
  boundary_consent_id: string | null;
};

type UploadedPhotoPageRow = {
  asset_id: string;
  uploaded_at: string | null;
};

type CurrentConsentHeadshotPageRow = {
  consent_id: string;
  consent_created_at: string | null;
  headshot_asset_id: string;
  headshot_uploaded_at: string | null;
};

export type UploadedPhotoPageItem = {
  assetId: string;
  uploadedAt: string | null;
};

export type CurrentConsentHeadshotPageItem = {
  consentId: string;
  consentCreatedAt: string | null;
  headshotAssetId: string;
  headshotUploadedAt: string | null;
};

type EnqueueFanoutContinuationRow = {
  continuation_id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  enqueued: boolean;
  requeued: boolean;
  already_processing: boolean;
  already_queued: boolean;
};

export type EnqueueFanoutContinuationResult = {
  continuationId: string;
  status: string;
  attemptCount: number;
  maxAttempts: number;
  runAfter: string;
  enqueued: boolean;
  requeued: boolean;
  alreadyProcessing: boolean;
  alreadyQueued: boolean;
};

export type ClaimedFanoutContinuationRow = {
  continuation_id: string;
  tenant_id: string;
  project_id: string;
  direction: FanoutDirection;
  source_asset_id: string | null;
  source_consent_id: string | null;
  source_project_profile_participant_id: string | null;
  source_profile_id: string | null;
  source_headshot_id: string | null;
  source_selection_face_id: string | null;
  source_materialization_id: string;
  source_materializer_version: string;
  compare_version: string;
  boundary_snapshot_at: string;
  boundary_sort_at: string | null;
  boundary_asset_id: string | null;
  boundary_consent_id: string | null;
  boundary_project_profile_participant_id: string | null;
  cursor_sort_at: string | null;
  cursor_asset_id: string | null;
  cursor_consent_id: string | null;
  cursor_project_profile_participant_id: string | null;
  dispatch_mode: FanoutDispatchMode;
  status: string;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  lock_token: string | null;
  lease_expires_at: string | null;
  reclaimed: boolean;
  reclaim_count: number;
  started_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

type CompleteFanoutContinuationRow = {
  continuation_id: string;
  status: string | null;
  completed_at: string | null;
  updated_at: string;
  outcome: "completed" | "lost_lease" | "missing" | "not_processing";
};

type FailFanoutContinuationRow = {
  continuation_id: string;
  status: string | null;
  attempt_count: number | null;
  max_attempts: number | null;
  run_after: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  updated_at: string;
  outcome: "retried" | "dead" | "lost_lease" | "missing" | "not_processing";
};

type FanoutContinuationBatchResult = {
  skippedIneligible: boolean;
  itemsExamined: number;
  compareJobsScheduled: number;
  materializeJobsScheduled: number;
  completed: boolean;
  superseded: boolean;
  nextCursorSortAt: string | null;
  nextCursorAssetId: string | null;
  nextCursorConsentId: string | null;
  nextCursorProjectProfileParticipantId: string | null;
};

type CompareExistsRow = {
  consent_id: string;
  asset_id: string;
  headshot_materialization_id: string;
  asset_materialization_id: string;
};

type RecurringCompareExistsRow = {
  project_profile_participant_id: string;
  asset_id: string;
  recurring_selection_face_id: string;
  asset_materialization_id: string;
};

type MaterializationHeaderRow = {
  id: string;
  asset_id: string;
};

type IntakeJobBoundaryRow = {
  payload: Record<string, unknown> | null;
  scope_consent_id: string | null;
};

type FanoutContinuationTestHooks = {
  beforeDownstreamSchedule?: (input: {
    continuationId: string;
    direction: FanoutDirection;
    kind: "compare" | "materialize";
    scheduledCount: number;
    targetAssetId: string;
    targetConsentId: string | null;
  }) => Promise<void> | void;
  beforeBatchFinalize?: (input: {
    continuationId: string;
    direction: FanoutDirection;
    compareJobsScheduled: number;
    materializeJobsScheduled: number;
    itemsExamined: number;
  }) => Promise<void> | void;
};

let fanoutContinuationTestHooks: FanoutContinuationTestHooks | null = null;

export function __setFanoutContinuationTestHooks(hooks: FanoutContinuationTestHooks | null) {
  fanoutContinuationTestHooks = hooks;
}

function parsePayloadTimestamp(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function parsePayloadUuid(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoundarySnapshotAt(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : new Date().toISOString();
}

export async function getPhotoFanoutBoundary(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId?: string | null,
): Promise<HeadshotFanoutBoundary> {
  if (workspaceId) {
    const { data, error } = await supabase
      .from("assets")
      .select("id, uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .eq("asset_type", "photo")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .order("uploaded_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "face_match_photo_boundary_failed", "Unable to load project photo boundary.");
    }

    return {
      boundarySnapshotAt: normalizeBoundarySnapshotAt(new Date().toISOString()),
      boundaryPhotoUploadedAt: data?.uploaded_at ?? null,
      boundaryPhotoAssetId: data?.id ?? null,
    };
  }

  const { data, error } = await supabase.rpc("get_photo_fanout_boundary", {
    p_tenant_id: tenantId,
    p_project_id: projectId,
  });

  if (error) {
    throw new HttpError(500, "face_match_photo_boundary_failed", "Unable to load project photo boundary.");
  }

  const row = ((data ?? []) as FanoutBoundaryPhotoRow[])[0] ?? null;
  return {
    boundarySnapshotAt: normalizeBoundarySnapshotAt(row?.boundary_snapshot_at ?? null),
    boundaryPhotoUploadedAt: row?.boundary_uploaded_at ?? null,
    boundaryPhotoAssetId: row?.boundary_asset_id ?? null,
  };
}

export async function getCurrentConsentHeadshotFanoutBoundary(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId?: string | null,
): Promise<PhotoFanoutBoundary> {
  if (workspaceId) {
    const { data, error } = await supabase
      .from("consents")
      .select("id, created_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("workspace_id", workspaceId)
      .eq("face_match_opt_in", true)
      .is("revoked_at", null)
      .is("superseded_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "face_match_consent_boundary_failed", "Unable to load consent headshot boundary.");
    }

    return {
      boundarySnapshotAt: normalizeBoundarySnapshotAt(new Date().toISOString()),
      boundaryConsentCreatedAt: data?.created_at ?? null,
      boundaryConsentId: data?.id ?? null,
    };
  }

  const { data, error } = await supabase.rpc("get_current_consent_headshot_fanout_boundary", {
    p_tenant_id: tenantId,
    p_project_id: projectId,
  });

  if (error) {
    throw new HttpError(500, "face_match_consent_boundary_failed", "Unable to load consent headshot boundary.");
  }

  const row = ((data ?? []) as FanoutBoundaryHeadshotRow[])[0] ?? null;
  return {
    boundarySnapshotAt: normalizeBoundarySnapshotAt(row?.boundary_snapshot_at ?? null),
    boundaryConsentCreatedAt: row?.boundary_consent_created_at ?? null,
    boundaryConsentId: row?.boundary_consent_id ?? null,
  };
}

export async function listUploadedProjectPhotosPage(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    limit: number;
    cursorUploadedAt?: string | null;
    cursorAssetId?: string | null;
    boundaryUploadedAt: string;
    boundaryAssetId: string;
  },
): Promise<UploadedPhotoPageItem[]> {
  const { data, error } = await supabase.rpc("list_uploaded_project_photos_page", {
    p_tenant_id: input.tenantId,
    p_project_id: input.projectId,
    p_limit: input.limit,
    p_cursor_uploaded_at: input.cursorUploadedAt ?? null,
    p_cursor_asset_id: input.cursorAssetId ?? null,
    p_boundary_uploaded_at: input.boundaryUploadedAt,
    p_boundary_asset_id: input.boundaryAssetId,
  });

  if (error) {
    throw new HttpError(500, "face_match_photo_page_failed", "Unable to load paged project photos.");
  }

  return ((data ?? []) as UploadedPhotoPageRow[]).map((row) => ({
    assetId: row.asset_id,
    uploadedAt: row.uploaded_at ?? null,
  }));
}

export async function listCurrentProjectConsentHeadshotsPage(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    boundarySnapshotAt: string;
    limit: number;
    cursorConsentCreatedAt?: string | null;
    cursorConsentId?: string | null;
    boundaryConsentCreatedAt: string;
    boundaryConsentId: string;
  },
): Promise<CurrentConsentHeadshotPageItem[]> {
  const { data, error } = await supabase.rpc("list_current_project_consent_headshots_page", {
    p_tenant_id: input.tenantId,
    p_project_id: input.projectId,
    p_boundary_snapshot_at: input.boundarySnapshotAt,
    p_opt_in_only: true,
    p_not_revoked_only: true,
    p_limit: input.limit,
    p_cursor_consent_created_at: input.cursorConsentCreatedAt ?? null,
    p_cursor_consent_id: input.cursorConsentId ?? null,
    p_boundary_consent_created_at: input.boundaryConsentCreatedAt,
    p_boundary_consent_id: input.boundaryConsentId,
  });

  if (error) {
    const normalized = normalizePostgrestError(error, "face_match_headshot_page_failed");
    throw new HttpError(500, normalized.code, "Unable to load paged consent headshots.");
  }

  return ((data ?? []) as CurrentConsentHeadshotPageRow[]).map((row) => ({
    consentId: row.consent_id,
    consentCreatedAt: row.consent_created_at ?? null,
    headshotAssetId: row.headshot_asset_id,
    headshotUploadedAt: row.headshot_uploaded_at ?? null,
  }));
}

export async function enqueueFaceMatchFanoutContinuation(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    direction: FanoutDirection;
    sourceAssetId?: string | null;
    sourceConsentId?: string | null;
    sourceProjectProfileParticipantId?: string | null;
    sourceProfileId?: string | null;
    sourceHeadshotId?: string | null;
    sourceSelectionFaceId?: string | null;
    sourceMaterializationId: string;
    sourceMaterializerVersion: string;
    compareVersion: string;
    boundarySnapshotAt: string;
    boundarySortAt?: string | null;
    boundaryAssetId?: string | null;
    boundaryConsentId?: string | null;
    boundaryProjectProfileParticipantId?: string | null;
    dispatchMode: FanoutDispatchMode;
    resetTerminal?: boolean;
  },
): Promise<EnqueueFanoutContinuationResult> {
  const { data, error } = await supabase.rpc("enqueue_face_match_fanout_continuation", {
    p_tenant_id: input.tenantId,
    p_project_id: input.projectId,
    p_direction: input.direction,
    p_source_asset_id: input.sourceAssetId ?? null,
    p_source_consent_id: input.sourceConsentId ?? null,
    p_source_project_profile_participant_id: input.sourceProjectProfileParticipantId ?? null,
    p_source_profile_id: input.sourceProfileId ?? null,
    p_source_headshot_id: input.sourceHeadshotId ?? null,
    p_source_selection_face_id: input.sourceSelectionFaceId ?? null,
    p_source_materialization_id: input.sourceMaterializationId,
    p_source_materializer_version: input.sourceMaterializerVersion,
    p_compare_version: input.compareVersion,
    p_boundary_snapshot_at: input.boundarySnapshotAt,
    p_boundary_sort_at: input.boundarySortAt ?? null,
    p_boundary_asset_id: input.boundaryAssetId ?? null,
    p_boundary_consent_id: input.boundaryConsentId ?? null,
    p_boundary_project_profile_participant_id: input.boundaryProjectProfileParticipantId ?? null,
    p_dispatch_mode: input.dispatchMode,
    p_max_attempts: FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS,
    p_run_after: null,
    p_reset_terminal: input.resetTerminal === true,
  });

  if (error) {
    throw new HttpError(500, "face_match_fanout_enqueue_failed", "Unable to enqueue fan-out continuation.");
  }

  const row = (data?.[0] ?? null) as EnqueueFanoutContinuationRow | null;
  if (!row) {
    throw new HttpError(500, "face_match_fanout_enqueue_failed", "Fan-out continuation enqueue returned no row.");
  }

  return {
    continuationId: row.continuation_id,
    status: row.status,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    runAfter: row.run_after,
    enqueued: row.enqueued,
    requeued: row.requeued,
    alreadyProcessing: row.already_processing,
    alreadyQueued: row.already_queued,
  };
}

export async function claimFaceMatchFanoutContinuations(
  supabase: SupabaseClient,
  workerId: string,
  batchSize: number,
  leaseSeconds: number,
): Promise<ClaimedFanoutContinuationRow[]> {
  const { data, error } = await supabase.rpc("claim_face_match_fanout_continuations", {
    p_locked_by: workerId,
    p_batch_size: batchSize,
    p_lease_seconds: leaseSeconds,
  });

  if (error) {
    throw new HttpError(500, "face_match_fanout_claim_failed", "Unable to claim fan-out continuations.");
  }

  return ((data ?? []) as ClaimedFanoutContinuationRow[]) ?? [];
}

export async function completeFaceMatchFanoutContinuationBatch(
  supabase: SupabaseClient,
  input: {
    continuationId: string;
    lockToken: string | null;
    nextStatus: "queued" | "completed" | "superseded";
    cursorSortAt?: string | null;
    cursorAssetId?: string | null;
    cursorConsentId?: string | null;
    cursorProjectProfileParticipantId?: string | null;
  },
) {
  if (!input.lockToken) {
    throw new HttpError(409, "face_match_fanout_complete_conflict", "Fan-out continuation lock token is missing.");
  }

  const { data, error } = await supabase.rpc("complete_face_match_fanout_continuation_batch", {
    p_continuation_id: input.continuationId,
    p_lock_token: input.lockToken,
    p_next_status: input.nextStatus,
    p_run_after: null,
    p_cursor_sort_at: input.cursorSortAt ?? null,
    p_cursor_asset_id: input.cursorAssetId ?? null,
    p_cursor_consent_id: input.cursorConsentId ?? null,
    p_cursor_project_profile_participant_id: input.cursorProjectProfileParticipantId ?? null,
  });

  if (error) {
    throw new HttpError(500, "face_match_fanout_complete_failed", "Unable to complete fan-out continuation batch.");
  }

  const row = (data?.[0] ?? null) as CompleteFanoutContinuationRow | null;
  if (!row) {
    throw new HttpError(409, "face_match_fanout_complete_conflict", "Fan-out continuation completion returned no row.");
  }

  return row;
}

export async function failFaceMatchFanoutContinuation(
  supabase: SupabaseClient,
  input: {
    continuationId: string;
    lockToken: string | null;
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
  },
) {
  if (!input.lockToken) {
    throw new HttpError(409, "face_match_fanout_fail_conflict", "Fan-out continuation lock token is missing.");
  }

  const { data, error } = await supabase.rpc("fail_face_match_fanout_continuation", {
    p_continuation_id: input.continuationId,
    p_lock_token: input.lockToken,
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
    p_retryable: input.retryable,
    p_retry_delay_seconds: null,
  });

  if (error) {
    throw new HttpError(500, "face_match_fanout_fail_failed", "Unable to fail fan-out continuation.");
  }

  const row = (data?.[0] ?? null) as FailFanoutContinuationRow | null;
  if (!row) {
    throw new HttpError(409, "face_match_fanout_fail_conflict", "Fan-out continuation failure returned no row.");
  }

  return row;
}

function parsePhotoBoundaryFromPayload(payload: Record<string, unknown> | null | undefined): PhotoFanoutBoundary | null {
  const boundarySnapshotAt = parsePayloadTimestamp(payload?.boundarySnapshotAt);
  const boundaryConsentCreatedAt = parsePayloadTimestamp(payload?.boundaryConsentCreatedAt);
  const boundaryConsentId = parsePayloadUuid(payload?.boundaryConsentId);
  if (!boundarySnapshotAt || !boundaryConsentCreatedAt || !boundaryConsentId) {
    return null;
  }

  return {
    boundarySnapshotAt,
    boundaryConsentCreatedAt,
    boundaryConsentId,
  };
}

function parseHeadshotBoundaryFromPayload(payload: Record<string, unknown> | null | undefined): HeadshotFanoutBoundary | null {
  const boundarySnapshotAt = parsePayloadTimestamp(payload?.boundarySnapshotAt);
  const boundaryPhotoUploadedAt = parsePayloadTimestamp(payload?.boundaryPhotoUploadedAt);
  const boundaryPhotoAssetId = parsePayloadUuid(payload?.boundaryPhotoAssetId);
  if (!boundarySnapshotAt || !boundaryPhotoUploadedAt || !boundaryPhotoAssetId) {
    return null;
  }

  return {
    boundarySnapshotAt,
    boundaryPhotoUploadedAt,
    boundaryPhotoAssetId,
  };
}

function parseRecurringBoundaryFromPayload(
  payload: Record<string, unknown> | null | undefined,
): RecurringProfileFanoutBoundary | null {
  const boundarySnapshotAt = parsePayloadTimestamp(payload?.recurringBoundarySnapshotAt);
  const boundaryParticipantCreatedAt = parsePayloadTimestamp(payload?.recurringBoundaryParticipantCreatedAt);
  const boundaryProjectProfileParticipantId = parsePayloadUuid(payload?.recurringBoundaryParticipantId);
  if (!boundarySnapshotAt || !boundaryParticipantCreatedAt || !boundaryProjectProfileParticipantId) {
    return null;
  }

  return {
    boundarySnapshotAt,
    boundaryParticipantCreatedAt,
    boundaryProjectProfileParticipantId,
  };
}

async function loadPhotoIntakeBoundary(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
) {
  const { data, error } = await supabase
    .from("face_match_jobs")
    .select("payload")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "photo_uploaded")
    .eq("scope_asset_id", assetId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_match_photo_intake_lookup_failed", "Unable to load photo intake boundary.");
  }

  return parsePhotoBoundaryFromPayload((data as IntakeJobBoundaryRow | null)?.payload ?? null);
}

async function loadPhotoIntakeRecurringBoundary(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
) {
  const { data, error } = await supabase
    .from("face_match_jobs")
    .select("payload")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "photo_uploaded")
    .eq("scope_asset_id", assetId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "face_match_photo_intake_lookup_failed",
      "Unable to load recurring photo intake boundary.",
    );
  }

  return parseRecurringBoundaryFromPayload((data as IntakeJobBoundaryRow | null)?.payload ?? null);
}

async function loadHeadshotIntakeBoundaries(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
) {
  const { data, error } = await supabase
    .from("face_match_jobs")
    .select("scope_consent_id, payload")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "consent_headshot_ready")
    .contains("payload", { headshotAssetId: assetId })
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "face_match_headshot_intake_lookup_failed", "Unable to load headshot intake boundaries.");
  }

  return ((data ?? []) as IntakeJobBoundaryRow[])
    .map((row) => ({
      consentId: row.scope_consent_id,
      boundary: parseHeadshotBoundaryFromPayload(row.payload),
    }))
    .filter((row): row is { consentId: string; boundary: HeadshotFanoutBoundary | null } => Boolean(row.consentId));
}

async function loadCurrentMaterializationHeadersByAssetId(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
  materializerVersion: string,
) {
  if (assetIds.length === 0) {
    return new Map<string, MaterializationHeaderRow>();
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materializations")
      .select("id, asset_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("materializer_version", materializerVersion)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_materialization_lookup_failed", "Unable to load materialization headers.");
    }

    return ((data ?? []) as MaterializationHeaderRow[]) ?? [];
  });

  return new Map(rows.map((row) => [row.asset_id, row]));
}

async function loadExistingPhotoToHeadshotCompareKeys(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    sourceAssetId: string;
    assetMaterializationId: string;
    compareVersion: string;
    consentIds: string[];
  },
) {
  if (input.consentIds.length === 0) {
    return new Set<string>();
  }

  const rows = await runChunkedRead(input.consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_face_compares")
      .select("consent_id, headshot_materialization_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_id", input.sourceAssetId)
      .eq("asset_materialization_id", input.assetMaterializationId)
      .eq("compare_version", input.compareVersion)
      .in("consent_id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_compare_lookup_failed", "Unable to load existing compare rows.");
    }

    return ((data ?? []) as Array<Pick<CompareExistsRow, "consent_id" | "headshot_materialization_id">>) ?? [];
  });

  return new Set(rows.map((row) => `${row.consent_id}:${row.headshot_materialization_id}`));
}

async function loadExistingHeadshotToPhotoCompareKeys(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    sourceConsentId: string;
    headshotMaterializationId: string;
    compareVersion: string;
    assetIds: string[];
  },
) {
  if (input.assetIds.length === 0) {
    return new Set<string>();
  }

  const rows = await runChunkedRead(input.assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_face_compares")
      .select("asset_id, asset_materialization_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_id", input.sourceConsentId)
      .eq("headshot_materialization_id", input.headshotMaterializationId)
      .eq("compare_version", input.compareVersion)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_compare_lookup_failed", "Unable to load existing compare rows.");
    }

    return ((data ?? []) as Array<Pick<CompareExistsRow, "asset_id" | "asset_materialization_id">>) ?? [];
  });

  return new Set(rows.map((row) => `${row.asset_id}:${row.asset_materialization_id}`));
}

async function loadExistingPhotoToRecurringCompareKeys(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    sourceAssetId: string;
    assetMaterializationId: string;
    compareVersion: string;
    projectProfileParticipantIds: string[];
  },
) {
  if (input.projectProfileParticipantIds.length === 0) {
    return new Set<string>();
  }

  const rows = await runChunkedRead(input.projectProfileParticipantIds, async (participantIdChunk) => {
    const { data, error } = await supabase
      .from("asset_project_profile_face_compares")
      .select("project_profile_participant_id, recurring_selection_face_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_id", input.sourceAssetId)
      .eq("asset_materialization_id", input.assetMaterializationId)
      .eq("compare_version", input.compareVersion)
      .in("project_profile_participant_id", participantIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_compare_lookup_failed", "Unable to load existing recurring compare rows.");
    }

    return ((data ?? []) as Array<Pick<RecurringCompareExistsRow, "project_profile_participant_id" | "recurring_selection_face_id">>) ?? [];
  });

  return new Set(rows.map((row) => `${row.project_profile_participant_id}:${row.recurring_selection_face_id}`));
}

async function loadExistingRecurringToPhotoCompareKeys(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    projectProfileParticipantId: string;
    recurringSelectionFaceId: string;
    compareVersion: string;
    assetIds: string[];
  },
) {
  if (input.assetIds.length === 0) {
    return new Set<string>();
  }

  const rows = await runChunkedRead(input.assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_project_profile_face_compares")
      .select("asset_id, asset_materialization_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("project_profile_participant_id", input.projectProfileParticipantId)
      .eq("recurring_selection_face_id", input.recurringSelectionFaceId)
      .eq("compare_version", input.compareVersion)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_compare_lookup_failed", "Unable to load existing recurring compare rows.");
    }

    return ((data ?? []) as Array<Pick<RecurringCompareExistsRow, "asset_id" | "asset_materialization_id">>) ?? [];
  });

  return new Set(rows.map((row) => `${row.asset_id}:${row.asset_materialization_id}`));
}

export async function loadConsentEligibility(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
) {
  const { data, error } = await supabase
    .from("consents")
    .select("id, face_match_opt_in, revoked_at, superseded_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", consentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_match_consent_lookup_failed", "Unable to load consent eligibility.");
  }

  return data && data.face_match_opt_in === true && data.revoked_at === null && data.superseded_at === null;
}

export async function createOrResetFanoutContinuationsForMaterializedAsset(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    assetId: string;
    assetType: "photo" | "headshot";
    sourceMaterializationId: string;
    sourceMaterializerVersion: string;
    compareVersion?: string;
    repairRequested: boolean;
  },
) {
  const compareVersion = input.compareVersion ?? getAutoMatchCompareVersion();
  let scheduledCount = 0;

  if (input.assetType === "photo") {
    const boundary = input.repairRequested
      ? await getCurrentConsentHeadshotFanoutBoundary(supabase, input.tenantId, input.projectId)
      : ((await loadPhotoIntakeBoundary(supabase, input.tenantId, input.projectId, input.assetId))
          ?? (await getCurrentConsentHeadshotFanoutBoundary(supabase, input.tenantId, input.projectId)));
    const recurringBoundary = input.repairRequested
      ? await getCurrentProjectRecurringSourceBoundary(supabase, {
          tenantId: input.tenantId,
          projectId: input.projectId,
        })
      : ((await loadPhotoIntakeRecurringBoundary(supabase, input.tenantId, input.projectId, input.assetId))
          ?? (await getCurrentProjectRecurringSourceBoundary(supabase, {
            tenantId: input.tenantId,
            projectId: input.projectId,
          })));

    if (boundary.boundaryConsentCreatedAt && boundary.boundaryConsentId) {
      const result = await enqueueFaceMatchFanoutContinuation(supabase, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        direction: "photo_to_headshots",
        sourceAssetId: input.assetId,
        sourceMaterializationId: input.sourceMaterializationId,
        sourceMaterializerVersion: input.sourceMaterializerVersion,
        compareVersion,
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundarySortAt: boundary.boundaryConsentCreatedAt,
        boundaryConsentId: boundary.boundaryConsentId,
        dispatchMode: input.repairRequested ? "backfill_repair" : "normal",
        resetTerminal: input.repairRequested,
      });

      if (result.enqueued || result.requeued || result.alreadyProcessing || result.alreadyQueued) {
        scheduledCount += 1;
      }
    }

    if (recurringBoundary.boundaryParticipantCreatedAt && recurringBoundary.boundaryProjectProfileParticipantId) {
      const result = await enqueueFaceMatchFanoutContinuation(supabase, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        direction: "photo_to_recurring_profiles",
        sourceAssetId: input.assetId,
        sourceMaterializationId: input.sourceMaterializationId,
        sourceMaterializerVersion: input.sourceMaterializerVersion,
        compareVersion,
        boundarySnapshotAt: recurringBoundary.boundarySnapshotAt,
        boundarySortAt: recurringBoundary.boundaryParticipantCreatedAt,
        boundaryProjectProfileParticipantId: recurringBoundary.boundaryProjectProfileParticipantId,
        dispatchMode: input.repairRequested ? "backfill_repair" : "normal",
        resetTerminal: input.repairRequested,
      });

      if (result.enqueued || result.requeued || result.alreadyProcessing || result.alreadyQueued) {
        scheduledCount += 1;
      }
    }

    return scheduledCount;
  }

  const headshotBoundaries = input.repairRequested
    ? await (async () => {
        const { data, error } = await supabase
          .from("asset_consent_links")
          .select("consent_id")
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("asset_id", input.assetId);

        if (error) {
          throw new HttpError(500, "face_match_headshot_repair_lookup_failed", "Unable to load repair headshot consents.");
        }

        const boundary = await getPhotoFanoutBoundary(supabase, input.tenantId, input.projectId);
        const consentIds = Array.from(new Set(((data ?? []) as Array<{ consent_id: string }>).map((row) => row.consent_id)));
        const eligibleConsentIds = await runChunkedRead(consentIds, async (consentIdChunk) => {
          const { data: consents, error: consentsError } = await supabase
            .from("consents")
            .select("id")
            .eq("tenant_id", input.tenantId)
            .eq("project_id", input.projectId)
            .eq("face_match_opt_in", true)
            .is("revoked_at", null)
            .in("id", consentIdChunk);

          if (consentsError) {
            throw new HttpError(500, "face_match_headshot_repair_lookup_failed", "Unable to validate repair headshot consents.");
          }

          return ((consents ?? []) as Array<{ id: string }>).map((row) => row.id);
        });

        return eligibleConsentIds.map((consentId) => ({
          consentId,
          boundary,
        }));
      })()
    : await loadHeadshotIntakeBoundaries(supabase, input.tenantId, input.projectId, input.assetId);

  for (const row of headshotBoundaries) {
    const boundary = row.boundary ?? (await getPhotoFanoutBoundary(supabase, input.tenantId, input.projectId));
    if (!boundary.boundaryPhotoUploadedAt || !boundary.boundaryPhotoAssetId) {
      continue;
    }

    const result = await enqueueFaceMatchFanoutContinuation(supabase, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      direction: "headshot_to_photos",
      sourceAssetId: input.assetId,
      sourceConsentId: row.consentId,
      sourceMaterializationId: input.sourceMaterializationId,
      sourceMaterializerVersion: input.sourceMaterializerVersion,
      compareVersion,
      boundarySnapshotAt: boundary.boundarySnapshotAt,
      boundarySortAt: boundary.boundaryPhotoUploadedAt,
      boundaryAssetId: boundary.boundaryPhotoAssetId,
      dispatchMode: input.repairRequested ? "backfill_repair" : "normal",
      resetTerminal: input.repairRequested,
    });

    if (result.enqueued || result.requeued || result.alreadyProcessing || result.alreadyQueued) {
      scheduledCount += 1;
    }
  }

  return scheduledCount;
}

function isBatchExhausted(
  continuation: ClaimedFanoutContinuationRow,
  lastItem: UploadedPhotoPageItem | CurrentConsentHeadshotPageItem | ReadyProjectRecurringSource | null,
  itemsExamined: number,
  batchLimit: number,
) {
  if (!lastItem) {
    return true;
  }

  if (itemsExamined < batchLimit) {
    return true;
  }

  if (continuation.direction === "photo_to_headshots") {
    const typedItem = lastItem as CurrentConsentHeadshotPageItem;
    return (
      typedItem.consentCreatedAt === continuation.boundary_sort_at &&
      typedItem.consentId === continuation.boundary_consent_id
    );
  }

  if (continuation.direction === "photo_to_recurring_profiles") {
    const typedItem = lastItem as ReadyProjectRecurringSource;
    return (
      typedItem.participantCreatedAt === continuation.boundary_sort_at &&
      typedItem.projectProfileParticipantId === continuation.boundary_project_profile_participant_id
    );
  }

  const typedItem = lastItem as UploadedPhotoPageItem;
  return typedItem.uploadedAt === continuation.boundary_sort_at && typedItem.assetId === continuation.boundary_asset_id;
}

function isPendingOrScheduled(result: RepairFaceMatchJobResult) {
  return result.enqueued || result.requeued || result.alreadyProcessing || result.alreadyQueued;
}

function wasNewlyScheduled(result: RepairFaceMatchJobResult) {
  return result.enqueued || result.requeued;
}

async function scheduleMaterializeJobForContinuation(
  supabase: SupabaseClient,
  continuation: ClaimedFanoutContinuationRow,
  assetId: string,
  scheduledCount: number,
) {
  await fanoutContinuationTestHooks?.beforeDownstreamSchedule?.({
    continuationId: continuation.continuation_id,
    direction: continuation.direction,
    kind: "materialize",
    scheduledCount,
    targetAssetId: assetId,
    targetConsentId: continuation.direction === "photo_to_headshots" ? null : continuation.source_consent_id,
  });

  const result = await enqueueMaterializeAssetFacesJob({
    tenantId: continuation.tenant_id,
    projectId: continuation.project_id,
    assetId,
    materializerVersion: continuation.source_materializer_version,
    mode: "repair_requeue",
    requeueReason: `fanout_continuation:${continuation.continuation_id}:materialize_asset_faces`,
    payload: {
      source: "fanout_continuation",
      continuationId: continuation.continuation_id,
    },
    supabase,
  }) as RepairFaceMatchJobResult;

  if (!isPendingOrScheduled(result)) {
    throw new HttpError(
      500,
      "face_match_fanout_downstream_schedule_incomplete",
      "Unable to make asset materialization work pending for fan-out continuation.",
    );
  }

  return {
    newlyScheduled: wasNewlyScheduled(result),
  };
}

async function scheduleCompareJobForContinuation(
  supabase: SupabaseClient,
  continuation: ClaimedFanoutContinuationRow,
  input: {
    assetId: string;
    assetMaterializationId: string;
    scheduledCount: number;
    consentId?: string;
    headshotMaterializationId?: string;
    projectProfileParticipantId?: string;
    profileId?: string;
    recurringHeadshotId?: string;
    recurringHeadshotMaterializationId?: string;
    recurringSelectionFaceId?: string;
  },
) {
  await fanoutContinuationTestHooks?.beforeDownstreamSchedule?.({
    continuationId: continuation.continuation_id,
    direction: continuation.direction,
    kind: "compare",
    scheduledCount: input.scheduledCount,
    targetAssetId: input.assetId,
    targetConsentId: input.consentId ?? null,
  });

  let result: RepairFaceMatchJobResult;
  if (continuation.direction === "photo_to_headshots" || continuation.direction === "headshot_to_photos") {
    if (!input.consentId || !input.headshotMaterializationId) {
      throw new HttpError(
        400,
        "face_match_fanout_invalid_compare_scope",
        "Consent fan-out compare scheduling requires consent and headshot materialization scope.",
      );
    }

    result = await enqueueCompareMaterializedPairJob({
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      consentId: input.consentId,
      assetId: input.assetId,
      headshotMaterializationId: input.headshotMaterializationId,
      assetMaterializationId: input.assetMaterializationId,
      compareVersion: continuation.compare_version,
      mode: "repair_requeue",
      requeueReason: `fanout_continuation:${continuation.continuation_id}:compare_materialized_pair`,
      payload: {
        source: "fanout_continuation",
        continuationId: continuation.continuation_id,
      },
      supabase,
    }) as RepairFaceMatchJobResult;
  } else {
    if (
      !input.projectProfileParticipantId
      || !input.profileId
      || !input.recurringHeadshotId
      || !input.recurringHeadshotMaterializationId
      || !input.recurringSelectionFaceId
    ) {
      throw new HttpError(
        400,
        "face_match_fanout_invalid_compare_scope",
        "Recurring fan-out compare scheduling requires participant, source, and selection scope.",
      );
    }

    result = await enqueueCompareRecurringProfileMaterializedPairJob({
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      projectProfileParticipantId: input.projectProfileParticipantId,
      profileId: input.profileId,
      assetId: input.assetId,
      recurringHeadshotId: input.recurringHeadshotId,
      recurringHeadshotMaterializationId: input.recurringHeadshotMaterializationId,
      recurringSelectionFaceId: input.recurringSelectionFaceId,
      assetMaterializationId: input.assetMaterializationId,
      compareVersion: continuation.compare_version,
      mode: "repair_requeue",
      requeueReason: `fanout_continuation:${continuation.continuation_id}:compare_recurring_profile_materialized_pair`,
      payload: {
        source: "fanout_continuation",
        continuationId: continuation.continuation_id,
      },
      supabase,
    }) as RepairFaceMatchJobResult;
  }

  if (!isPendingOrScheduled(result)) {
    throw new HttpError(
      500,
      "face_match_fanout_downstream_schedule_incomplete",
      "Unable to make compare work pending for fan-out continuation.",
    );
  }

  return {
    newlyScheduled: wasNewlyScheduled(result),
  };
}

function buildSupersededBatchResult(continuation: ClaimedFanoutContinuationRow): FanoutContinuationBatchResult {
  return {
    skippedIneligible: true,
    itemsExamined: 0,
    compareJobsScheduled: 0,
    materializeJobsScheduled: 0,
    completed: false,
    superseded: true,
    nextCursorSortAt: continuation.cursor_sort_at,
    nextCursorAssetId: continuation.cursor_asset_id,
    nextCursorConsentId: continuation.cursor_consent_id,
    nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
  };
}

export async function supersedeRecurringProfileFanoutContinuations(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    projectProfileParticipantId: string;
    keepSourceMaterializationId?: string | null;
    keepSelectionFaceId?: string | null;
  },
) {
  const { data, error } = await supabase
    .from("face_match_fanout_continuations")
    .select("id, source_materialization_id, source_selection_face_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("direction", "recurring_profile_to_photos")
    .eq("source_project_profile_participant_id", input.projectProfileParticipantId)
    .in("status", ["queued", "processing"]);

  if (error) {
    throw new HttpError(
      500,
      "face_match_fanout_supersede_failed",
      "Unable to load recurring fan-out continuations for supersede.",
    );
  }

  const staleIds = ((data ?? []) as Array<{
    id: string;
    source_materialization_id: string | null;
    source_selection_face_id: string | null;
  }>).filter((row) => {
    if (!input.keepSourceMaterializationId || !input.keepSelectionFaceId) {
      return true;
    }

    return !(
      row.source_materialization_id === input.keepSourceMaterializationId
      && row.source_selection_face_id === input.keepSelectionFaceId
    );
  }).map((row) => row.id);

  if (staleIds.length === 0) {
    return 0;
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("face_match_fanout_continuations")
    .update({
      status: "superseded",
      locked_at: null,
      locked_by: null,
      lock_token: null,
      lease_expires_at: null,
      completed_at: nowIso,
      updated_at: nowIso,
    })
    .in("id", staleIds);

  if (updateError) {
    throw new HttpError(
      500,
      "face_match_fanout_supersede_failed",
      "Unable to supersede recurring fan-out continuations.",
    );
  }

  return staleIds.length;
}

export async function processClaimedFanoutContinuation(
  supabase: SupabaseClient,
  continuation: ClaimedFanoutContinuationRow,
  maxComparisonsPerJob: number,
): Promise<FanoutContinuationBatchResult> {
  if (!continuation.lock_token) {
    throw new HttpError(409, "face_match_fanout_missing_lock_token", "Fan-out continuation lock token is missing.");
  }

  const batchLimit = Math.max(1, Math.min(750, maxComparisonsPerJob));
  let compareJobsScheduled = 0;
  let materializeJobsScheduled = 0;
  let downstreamJobsScheduled = 0;

  if (continuation.direction === "photo_to_headshots") {
    const sourceAsset = await loadEligibleAssetForMaterialization(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      continuation.source_asset_id,
    );
    if (!sourceAsset || sourceAsset.assetType !== "photo") {
      return buildSupersededBatchResult(continuation);
    }

    const currentMaterialization = await loadCurrentAssetFaceMaterialization(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      continuation.source_asset_id,
      continuation.source_materializer_version,
      { includeFaces: false },
    );
    if (!currentMaterialization || currentMaterialization.materialization.id !== continuation.source_materialization_id) {
      return buildSupersededBatchResult(continuation);
    }

    if (!continuation.boundary_sort_at || !continuation.boundary_consent_id) {
      return {
        skippedIneligible: false,
        itemsExamined: 0,
        compareJobsScheduled: 0,
        materializeJobsScheduled: 0,
        completed: true,
        superseded: false,
        nextCursorSortAt: continuation.cursor_sort_at,
        nextCursorAssetId: continuation.cursor_asset_id,
        nextCursorConsentId: continuation.cursor_consent_id,
        nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
      };
    }

    const page = await listCurrentProjectConsentHeadshotsPage(supabase, {
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      boundarySnapshotAt: continuation.boundary_snapshot_at,
      limit: batchLimit,
      cursorConsentCreatedAt: continuation.cursor_sort_at,
      cursorConsentId: continuation.cursor_consent_id,
      boundaryConsentCreatedAt: continuation.boundary_sort_at,
      boundaryConsentId: continuation.boundary_consent_id,
    });

    const headshotMaterializations = await loadCurrentMaterializationHeadersByAssetId(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      Array.from(new Set(page.map((row) => row.headshotAssetId))),
      continuation.source_materializer_version,
    );
    const existingKeys = await loadExistingPhotoToHeadshotCompareKeys(supabase, {
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      sourceAssetId: continuation.source_asset_id,
      assetMaterializationId: continuation.source_materialization_id,
      compareVersion: continuation.compare_version,
      consentIds: Array.from(new Set(page.map((row) => row.consentId))),
    });

    for (const item of page) {
      const headshotMaterialization = headshotMaterializations.get(item.headshotAssetId);
      if (!headshotMaterialization) {
        const materializeResult = await scheduleMaterializeJobForContinuation(
          supabase,
          continuation,
          item.headshotAssetId,
          downstreamJobsScheduled,
        );
        if (materializeResult.newlyScheduled) {
          materializeJobsScheduled += 1;
          downstreamJobsScheduled += 1;
        }
        continue;
      }

      const compareKey = `${item.consentId}:${headshotMaterialization.id}`;
      if (existingKeys.has(compareKey)) {
        continue;
      }

      const compareResult = await scheduleCompareJobForContinuation(supabase, continuation, {
        consentId: item.consentId,
        assetId: continuation.source_asset_id,
        headshotMaterializationId: headshotMaterialization.id,
        assetMaterializationId: continuation.source_materialization_id,
        scheduledCount: downstreamJobsScheduled,
      });
      if (compareResult.newlyScheduled) {
        compareJobsScheduled += 1;
        downstreamJobsScheduled += 1;
      }
    }

    await fanoutContinuationTestHooks?.beforeBatchFinalize?.({
      continuationId: continuation.continuation_id,
      direction: continuation.direction,
      compareJobsScheduled,
      materializeJobsScheduled,
      itemsExamined: page.length,
    });

    return {
      skippedIneligible: false,
      itemsExamined: page.length,
      compareJobsScheduled,
      materializeJobsScheduled,
      completed: isBatchExhausted(continuation, page.at(-1) ?? null, page.length, batchLimit),
      superseded: false,
      nextCursorSortAt: page.at(-1)?.consentCreatedAt ?? continuation.cursor_sort_at,
      nextCursorAssetId: continuation.cursor_asset_id,
      nextCursorConsentId: page.at(-1)?.consentId ?? continuation.cursor_consent_id,
      nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
    };
  }

  if (continuation.direction === "photo_to_recurring_profiles") {
    if (!continuation.source_asset_id) {
      return buildSupersededBatchResult(continuation);
    }

    const sourceAsset = await loadEligibleAssetForMaterialization(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      continuation.source_asset_id,
    );
    if (!sourceAsset || sourceAsset.assetType !== "photo") {
      return buildSupersededBatchResult(continuation);
    }

    const currentMaterialization = await loadCurrentAssetFaceMaterialization(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      continuation.source_asset_id,
      continuation.source_materializer_version,
      { includeFaces: false },
    );
    if (!currentMaterialization || currentMaterialization.materialization.id !== continuation.source_materialization_id) {
      return buildSupersededBatchResult(continuation);
    }

    if (!continuation.boundary_sort_at || !continuation.boundary_project_profile_participant_id) {
      return {
        skippedIneligible: false,
        itemsExamined: 0,
        compareJobsScheduled: 0,
        materializeJobsScheduled: 0,
        completed: true,
        superseded: false,
        nextCursorSortAt: continuation.cursor_sort_at,
        nextCursorAssetId: continuation.cursor_asset_id,
        nextCursorConsentId: continuation.cursor_consent_id,
        nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
      };
    }

    const page = await listReadyProjectRecurringSourcesPage(supabase, {
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      boundarySnapshotAt: continuation.boundary_snapshot_at,
      limit: batchLimit,
      cursorParticipantCreatedAt: continuation.cursor_sort_at,
      cursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
      boundaryParticipantCreatedAt: continuation.boundary_sort_at,
      boundaryProjectProfileParticipantId: continuation.boundary_project_profile_participant_id,
    });
    const existingKeys = await loadExistingPhotoToRecurringCompareKeys(supabase, {
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      sourceAssetId: continuation.source_asset_id,
      assetMaterializationId: continuation.source_materialization_id,
      compareVersion: continuation.compare_version,
      projectProfileParticipantIds: Array.from(new Set(page.map((row) => row.projectProfileParticipantId))),
    });

    for (const item of page) {
      const compareKey = `${item.projectProfileParticipantId}:${item.selectionFaceId}`;
      if (existingKeys.has(compareKey)) {
        continue;
      }

      const compareResult = await scheduleCompareJobForContinuation(supabase, continuation, {
        assetId: continuation.source_asset_id,
        assetMaterializationId: continuation.source_materialization_id,
        projectProfileParticipantId: item.projectProfileParticipantId,
        profileId: item.profileId,
        recurringHeadshotId: item.recurringHeadshotId,
        recurringHeadshotMaterializationId: item.recurringHeadshotMaterializationId,
        recurringSelectionFaceId: item.selectionFaceId,
        scheduledCount: downstreamJobsScheduled,
      });
      if (compareResult.newlyScheduled) {
        compareJobsScheduled += 1;
        downstreamJobsScheduled += 1;
      }
    }

    await fanoutContinuationTestHooks?.beforeBatchFinalize?.({
      continuationId: continuation.continuation_id,
      direction: continuation.direction,
      compareJobsScheduled,
      materializeJobsScheduled,
      itemsExamined: page.length,
    });

    return {
      skippedIneligible: false,
      itemsExamined: page.length,
      compareJobsScheduled,
      materializeJobsScheduled,
      completed: isBatchExhausted(continuation, page.at(-1) ?? null, page.length, batchLimit),
      superseded: false,
      nextCursorSortAt: page.at(-1)?.participantCreatedAt ?? continuation.cursor_sort_at,
      nextCursorAssetId: continuation.cursor_asset_id,
      nextCursorConsentId: continuation.cursor_consent_id,
      nextCursorProjectProfileParticipantId:
        page.at(-1)?.projectProfileParticipantId ?? continuation.cursor_project_profile_participant_id,
    };
  }

  if (!continuation.source_consent_id) {
    if (continuation.direction !== "recurring_profile_to_photos") {
      return buildSupersededBatchResult(continuation);
    }
  }

  if (continuation.direction === "headshot_to_photos") {
    if (!continuation.source_consent_id) {
      return buildSupersededBatchResult(continuation);
    }

    const consentEligible = await loadConsentEligibility(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      continuation.source_consent_id,
    );
    if (!consentEligible) {
      return buildSupersededBatchResult(continuation);
    }

    const currentHeadshot = await loadConsentHeadshotMaterialization(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      continuation.source_consent_id,
      continuation.source_materializer_version,
      { includeFaces: false },
    );
    if (!currentHeadshot || currentHeadshot.materialization.id !== continuation.source_materialization_id) {
      return buildSupersededBatchResult(continuation);
    }

    if (!continuation.boundary_sort_at || !continuation.boundary_asset_id) {
      return {
        skippedIneligible: false,
        itemsExamined: 0,
        compareJobsScheduled: 0,
        materializeJobsScheduled: 0,
        completed: true,
        superseded: false,
        nextCursorSortAt: continuation.cursor_sort_at,
        nextCursorAssetId: continuation.cursor_asset_id,
        nextCursorConsentId: continuation.cursor_consent_id,
        nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
      };
    }

    const page = await listUploadedProjectPhotosPage(supabase, {
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      limit: batchLimit,
      cursorUploadedAt: continuation.cursor_sort_at,
      cursorAssetId: continuation.cursor_asset_id,
      boundaryUploadedAt: continuation.boundary_sort_at,
      boundaryAssetId: continuation.boundary_asset_id,
    });
    const photoMaterializations = await loadCurrentMaterializationHeadersByAssetId(
      supabase,
      continuation.tenant_id,
      continuation.project_id,
      Array.from(new Set(page.map((row) => row.assetId))),
      continuation.source_materializer_version,
    );
    const existingKeys = await loadExistingHeadshotToPhotoCompareKeys(supabase, {
      tenantId: continuation.tenant_id,
      projectId: continuation.project_id,
      sourceConsentId: continuation.source_consent_id,
      headshotMaterializationId: continuation.source_materialization_id,
      compareVersion: continuation.compare_version,
      assetIds: Array.from(new Set(page.map((row) => row.assetId))),
    });

    for (const item of page) {
      const photoMaterialization = photoMaterializations.get(item.assetId);
      if (!photoMaterialization) {
        const materializeResult = await scheduleMaterializeJobForContinuation(
          supabase,
          continuation,
          item.assetId,
          downstreamJobsScheduled,
        );
        if (materializeResult.newlyScheduled) {
          materializeJobsScheduled += 1;
          downstreamJobsScheduled += 1;
        }
        continue;
      }

      const compareKey = `${item.assetId}:${photoMaterialization.id}`;
      if (existingKeys.has(compareKey)) {
        continue;
      }

      const compareResult = await scheduleCompareJobForContinuation(supabase, continuation, {
        consentId: continuation.source_consent_id,
        assetId: item.assetId,
        headshotMaterializationId: continuation.source_materialization_id,
        assetMaterializationId: photoMaterialization.id,
        scheduledCount: downstreamJobsScheduled,
      });
      if (compareResult.newlyScheduled) {
        compareJobsScheduled += 1;
        downstreamJobsScheduled += 1;
      }
    }

    await fanoutContinuationTestHooks?.beforeBatchFinalize?.({
      continuationId: continuation.continuation_id,
      direction: continuation.direction,
      compareJobsScheduled,
      materializeJobsScheduled,
      itemsExamined: page.length,
    });

    return {
      skippedIneligible: false,
      itemsExamined: page.length,
      compareJobsScheduled,
      materializeJobsScheduled,
      completed: isBatchExhausted(continuation, page.at(-1) ?? null, page.length, batchLimit),
      superseded: false,
      nextCursorSortAt: page.at(-1)?.uploadedAt ?? continuation.cursor_sort_at,
      nextCursorAssetId: page.at(-1)?.assetId ?? continuation.cursor_asset_id,
      nextCursorConsentId: continuation.cursor_consent_id,
      nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
    };
  }

  if (!continuation.source_project_profile_participant_id || !continuation.source_selection_face_id) {
    return buildSupersededBatchResult(continuation);
  }

  const currentSource = await resolveAutoEligibleProjectRecurringSource(supabase, {
    tenantId: continuation.tenant_id,
    projectId: continuation.project_id,
    projectProfileParticipantId: continuation.source_project_profile_participant_id,
  });
  if (
    !currentSource
    || currentSource.recurringHeadshotMaterializationId !== continuation.source_materialization_id
    || currentSource.selectionFaceId !== continuation.source_selection_face_id
    || currentSource.recurringHeadshotId !== continuation.source_headshot_id
  ) {
    return buildSupersededBatchResult(continuation);
  }

  if (!continuation.boundary_sort_at || !continuation.boundary_asset_id) {
    return {
      skippedIneligible: false,
      itemsExamined: 0,
      compareJobsScheduled: 0,
      materializeJobsScheduled: 0,
      completed: true,
      superseded: false,
      nextCursorSortAt: continuation.cursor_sort_at,
      nextCursorAssetId: continuation.cursor_asset_id,
      nextCursorConsentId: continuation.cursor_consent_id,
      nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
    };
  }

  const page = await listUploadedProjectPhotosPage(supabase, {
    tenantId: continuation.tenant_id,
    projectId: continuation.project_id,
    limit: batchLimit,
    cursorUploadedAt: continuation.cursor_sort_at,
    cursorAssetId: continuation.cursor_asset_id,
    boundaryUploadedAt: continuation.boundary_sort_at,
    boundaryAssetId: continuation.boundary_asset_id,
  });
  const photoMaterializations = await loadCurrentMaterializationHeadersByAssetId(
    supabase,
    continuation.tenant_id,
    continuation.project_id,
    Array.from(new Set(page.map((row) => row.assetId))),
    continuation.source_materializer_version,
  );
  const existingKeys = await loadExistingRecurringToPhotoCompareKeys(supabase, {
    tenantId: continuation.tenant_id,
    projectId: continuation.project_id,
    projectProfileParticipantId: continuation.source_project_profile_participant_id,
    recurringSelectionFaceId: continuation.source_selection_face_id,
    compareVersion: continuation.compare_version,
    assetIds: Array.from(new Set(page.map((row) => row.assetId))),
  });

  for (const item of page) {
    const photoMaterialization = photoMaterializations.get(item.assetId);
    if (!photoMaterialization) {
      const materializeResult = await scheduleMaterializeJobForContinuation(
        supabase,
        continuation,
        item.assetId,
        downstreamJobsScheduled,
      );
      if (materializeResult.newlyScheduled) {
        materializeJobsScheduled += 1;
        downstreamJobsScheduled += 1;
      }
      continue;
    }

    const compareKey = `${item.assetId}:${photoMaterialization.id}`;
    if (existingKeys.has(compareKey)) {
      continue;
    }

    const compareResult = await scheduleCompareJobForContinuation(supabase, continuation, {
      assetId: item.assetId,
      assetMaterializationId: photoMaterialization.id,
      projectProfileParticipantId: currentSource.projectProfileParticipantId,
      profileId: currentSource.profileId,
      recurringHeadshotId: currentSource.recurringHeadshotId,
      recurringHeadshotMaterializationId: currentSource.recurringHeadshotMaterializationId,
      recurringSelectionFaceId: currentSource.selectionFaceId,
      scheduledCount: downstreamJobsScheduled,
    });
    if (compareResult.newlyScheduled) {
      compareJobsScheduled += 1;
      downstreamJobsScheduled += 1;
    }
  }

  await fanoutContinuationTestHooks?.beforeBatchFinalize?.({
    continuationId: continuation.continuation_id,
    direction: continuation.direction,
    compareJobsScheduled,
    materializeJobsScheduled,
    itemsExamined: page.length,
  });

  return {
    skippedIneligible: false,
    itemsExamined: page.length,
    compareJobsScheduled,
    materializeJobsScheduled,
    completed: isBatchExhausted(continuation, page.at(-1) ?? null, page.length, batchLimit),
    superseded: false,
    nextCursorSortAt: page.at(-1)?.uploadedAt ?? continuation.cursor_sort_at,
    nextCursorAssetId: page.at(-1)?.assetId ?? continuation.cursor_asset_id,
    nextCursorConsentId: continuation.cursor_consent_id,
    nextCursorProjectProfileParticipantId: continuation.cursor_project_profile_participant_id,
  };
}
