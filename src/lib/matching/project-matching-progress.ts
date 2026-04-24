import type { SupabaseClient } from "@supabase/supabase-js";

import { normalizePostgrestError } from "@/lib/http/postgrest-error";
import {
  getAutoMatchMaterializerVersion,
  getAutoMatchPipelineMode,
} from "@/lib/matching/auto-match-config";

export type ProjectMatchingProgress = {
  totalImages: number;
  processedImages: number;
  progressPercent: number;
  isMatchingInProgress: boolean;
  hasDegradedMatchingState: boolean;
};

type ProjectMatchingProgressRpcRow = {
  total_images: number | string | null;
  processed_images: number | string | null;
  is_matching_in_progress: boolean | null;
  has_degraded_matching_state: boolean | null;
};

type WorkspaceUploadedPhotoRow = {
  id: string;
};

type WorkspaceMaterializationRow = {
  asset_id: string;
};

type WorkspaceFaceMatchJobRow = {
  scope_asset_id: string | null;
  status: string;
  job_type: string;
  lease_expires_at: string | null;
  locked_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type WorkspaceFanoutContinuationRow = {
  status: string;
  attempt_count: number | null;
  last_error_at: string | null;
  lease_expires_at: string | null;
  locked_at: string | null;
  updated_at: string | null;
  created_at: string | null;
};

const ACTIVE_PROGRESS_JOB_TYPES = new Set([
  "photo_uploaded",
  "consent_headshot_ready",
  "materialize_asset_faces",
  "compare_materialized_pair",
]);

function toProgressPercent(processedImages: number, totalImages: number) {
  if (totalImages <= 0) {
    return 0;
  }

  const rawPercent = Math.round((processedImages / totalImages) * 100);
  return Math.max(0, Math.min(100, rawPercent));
}

function coerceIsoToMillis(value: string | null | undefined) {
  const millis = Date.parse(String(value ?? ""));
  return Number.isFinite(millis) ? millis : null;
}

function resolveLeaseExpiryMillis(input: {
  lease_expires_at: string | null;
  locked_at: string | null;
  updated_at: string | null;
  created_at: string | null;
}) {
  return (
    coerceIsoToMillis(input.lease_expires_at) ??
    coerceIsoToMillis(input.locked_at) ??
    coerceIsoToMillis(input.updated_at) ??
    coerceIsoToMillis(input.created_at)
  );
}

function isActivelyLeased(input: {
  lease_expires_at: string | null;
  locked_at: string | null;
  updated_at: string | null;
  created_at: string | null;
}) {
  const expiryMillis = resolveLeaseExpiryMillis(input);
  return expiryMillis !== null && expiryMillis > Date.now();
}

export async function getProjectMatchingProgress(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId?: string | null,
): Promise<ProjectMatchingProgress> {
  const pipelineMode = getAutoMatchPipelineMode();

  if (workspaceId) {
    const [
      uploadedPhotosResult,
      processedMaterializationsResult,
      faceMatchJobsResult,
      fanoutContinuationsResult,
    ] = await Promise.all([
      supabase
        .from("assets")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .eq("asset_type", "photo")
        .eq("status", "uploaded")
        .is("archived_at", null),
      supabase
        .from("asset_face_materializations")
        .select("asset_id")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .eq("materializer_version", getAutoMatchMaterializerVersion()),
      supabase
        .from("face_match_jobs")
        .select("scope_asset_id, status, job_type, lease_expires_at, locked_at, updated_at, created_at")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .in("status", ["queued", "processing", "succeeded", "dead"]),
      supabase
        .from("face_match_fanout_continuations")
        .select("status, attempt_count, last_error_at, lease_expires_at, locked_at, updated_at, created_at")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("workspace_id", workspaceId)
        .in("status", ["queued", "processing", "dead"]),
    ]);

    if (
      uploadedPhotosResult.error ||
      processedMaterializationsResult.error ||
      faceMatchJobsResult.error ||
      fanoutContinuationsResult.error
    ) {
      throw new Error("project_matching_progress_failed:workspace_query_failed");
    }

    const uploadedPhotos = (uploadedPhotosResult.data ?? []) as WorkspaceUploadedPhotoRow[];
    const faceMatchJobs = (faceMatchJobsResult.data ?? []) as WorkspaceFaceMatchJobRow[];
    const fanoutContinuations =
      (fanoutContinuationsResult.data ?? []) as WorkspaceFanoutContinuationRow[];

    const uploadedPhotoIds = new Set(uploadedPhotos.map((row) => row.id));
    const totalImages = uploadedPhotos.length;
    const processedImages = new Set(
      ((processedMaterializationsResult.data ?? []) as WorkspaceMaterializationRow[])
        .map((row) => row.asset_id)
        .filter((assetId) => uploadedPhotoIds.has(assetId)),
    ).size;
    const activeJobCount = faceMatchJobs.filter((job) => {
      if (!ACTIVE_PROGRESS_JOB_TYPES.has(job.job_type)) {
        return false;
      }

      return job.status === "queued" || (job.status === "processing" && isActivelyLeased(job));
    }).length;
    const activeContinuationCount = fanoutContinuations.filter(
      (continuation) =>
        continuation.status === "queued" ||
        (continuation.status === "processing" && isActivelyLeased(continuation)),
    ).length;
    const hasDegradedMatchingState = fanoutContinuations.some((continuation) => {
      if (continuation.status === "dead") {
        return true;
      }

      const retryingWithError =
        (continuation.attempt_count ?? 0) > 0 && continuation.last_error_at !== null;

      if (!retryingWithError) {
        return false;
      }

      if (continuation.status === "queued") {
        return true;
      }

      return continuation.status === "processing" && isActivelyLeased(continuation);
    });

    const processedPhotoIdsFromRawJobs = new Set<string>();

    if (!["materialized_apply", "materialized_shadow"].includes(pipelineMode)) {
      const jobsByAssetId = new Map<string, WorkspaceFaceMatchJobRow[]>();

      for (const job of faceMatchJobs) {
        const assetId = String(job.scope_asset_id ?? "");
        if (!assetId || !uploadedPhotoIds.has(assetId) || job.job_type !== "photo_uploaded") {
          continue;
        }

        const rows = jobsByAssetId.get(assetId) ?? [];
        rows.push(job);
        jobsByAssetId.set(assetId, rows);
      }

      for (const [assetId, jobs] of jobsByAssetId) {
        const hasTerminal = jobs.some((job) => job.status === "succeeded" || job.status === "dead");
        const hasActive = jobs.some(
          (job) => job.status === "queued" || (job.status === "processing" && isActivelyLeased(job)),
        );

        if (hasTerminal && !hasActive) {
          processedPhotoIdsFromRawJobs.add(assetId);
        }
      }
    }

    return {
      totalImages,
      processedImages: ["materialized_apply", "materialized_shadow"].includes(pipelineMode)
        ? processedImages
        : processedPhotoIdsFromRawJobs.size,
      progressPercent: toProgressPercent(
        ["materialized_apply", "materialized_shadow"].includes(pipelineMode)
          ? processedImages
          : processedPhotoIdsFromRawJobs.size,
        totalImages,
      ),
      isMatchingInProgress: activeJobCount > 0 || activeContinuationCount > 0,
      hasDegradedMatchingState,
    };
  }

  const { data, error } = await supabase.rpc("get_project_matching_progress", {
    p_tenant_id: tenantId,
    p_project_id: projectId,
    p_pipeline_mode: pipelineMode,
    p_materializer_version: getAutoMatchMaterializerVersion(),
  });

  if (error) {
    const normalized = normalizePostgrestError(error, "project_matching_progress_failed");
    throw new Error(`project_matching_progress_failed:${normalized.code}`);
  }

  const row = ((data ?? []) as ProjectMatchingProgressRpcRow[])[0] ?? null;
  const totalImages = Number.isFinite(Number(row?.total_images ?? 0)) ? Number(row?.total_images ?? 0) : 0;
  const processedImages = Number.isFinite(Number(row?.processed_images ?? 0)) ? Number(row?.processed_images ?? 0) : 0;
  const isMatchingInProgress = row?.is_matching_in_progress === true;
  const hasDegradedMatchingState = row?.has_degraded_matching_state === true;

  return {
    totalImages,
    processedImages,
    progressPercent: toProgressPercent(processedImages, totalImages),
    isMatchingInProgress,
    hasDegradedMatchingState,
  };
}
