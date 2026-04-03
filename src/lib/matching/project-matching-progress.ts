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

function toProgressPercent(processedImages: number, totalImages: number) {
  if (totalImages <= 0) {
    return 0;
  }

  const rawPercent = Math.round((processedImages / totalImages) * 100);
  return Math.max(0, Math.min(100, rawPercent));
}

export async function getProjectMatchingProgress(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectMatchingProgress> {
  const pipelineMode = getAutoMatchPipelineMode();
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
