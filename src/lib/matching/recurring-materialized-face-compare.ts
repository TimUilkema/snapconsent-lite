import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAutoMatchCompareVersion } from "@/lib/matching/auto-match-config";
import type {
  AssetFaceMaterializationFaceRow,
  AssetFaceMaterializationRow,
} from "@/lib/matching/face-materialization";
import type { AutoMatcher } from "@/lib/matching/auto-matcher";

export type AssetProjectProfileFaceCompareStatus = "matched" | "source_unusable" | "target_empty" | "no_match";

type RecurringProfileHeadshotMaterializationRow = {
  id: string;
  tenant_id: string;
  headshot_id: string;
  materialization_version: string;
  provider: string;
  provider_mode: string;
  provider_plugin_versions: Record<string, unknown> | null;
  face_count: number;
  usable_for_compare: boolean;
  unusable_reason: string | null;
  materialized_at: string;
  created_at: string;
};

type RecurringProfileHeadshotMaterializationFaceRow = {
  id: string;
  tenant_id: string;
  materialization_id: string;
  face_rank: number;
  provider_face_index: number | null;
  detection_probability: number | null;
  face_box: Record<string, unknown>;
  face_box_normalized: Record<string, unknown> | null;
  embedding: number[] | null;
  created_at: string;
};

export type AssetProjectProfileFaceCompareRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  project_profile_participant_id: string;
  profile_id: string;
  asset_id: string;
  recurring_headshot_id: string;
  recurring_headshot_materialization_id: string;
  recurring_selection_face_id: string;
  asset_materialization_id: string;
  winning_asset_face_id: string | null;
  winning_asset_face_rank: number | null;
  winning_similarity: number;
  compare_status: AssetProjectProfileFaceCompareStatus;
  compare_version: string;
  provider: string;
  provider_mode: string;
  provider_plugin_versions: Record<string, unknown> | null;
  target_face_count: number;
  compared_at: string;
  created_at: string;
};

export type EnsuredRecurringProfileMaterializedFaceCompare = {
  compare: AssetProjectProfileFaceCompareRow;
  recurringHeadshotMaterialization: RecurringProfileHeadshotMaterializationRow;
  assetMaterialization: AssetFaceMaterializationRow;
  selectionFace: RecurringProfileHeadshotMaterializationFaceRow | null;
  winningAssetFace: AssetFaceMaterializationFaceRow | null;
};

type EnsureRecurringProfileMaterializedFaceCompareInput = {
  supabase: SupabaseClient;
  matcher: AutoMatcher;
  tenantId: string;
  projectId: string;
  projectProfileParticipantId: string;
  profileId: string;
  assetId: string;
  recurringHeadshotId: string;
  recurringHeadshotMaterializationId: string;
  recurringSelectionFaceId: string;
  assetMaterializationId: string;
  compareVersion?: string;
};

function normalizeSimilarityScore(value: number | null | undefined) {
  const numeric = Number(value ?? NaN);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function requireEmbeddingComparer(matcher: AutoMatcher) {
  if (!matcher.compareEmbeddings) {
    throw new HttpError(
      500,
      "face_match_provider_capability_missing",
      "Selected matcher provider does not support embedding comparison.",
    );
  }

  return matcher.compareEmbeddings;
}

async function loadAssetMaterializationFaces(
  supabase: SupabaseClient,
  materializationId: string,
): Promise<AssetFaceMaterializationFaceRow[]> {
  const { data, error } = await supabase
    .from("asset_face_materialization_faces")
    .select(
      "id, tenant_id, project_id, asset_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, face_source, created_by, created_at",
    )
    .eq("materialization_id", materializationId)
    .order("face_rank", { ascending: true });

  if (error) {
    throw new HttpError(500, "face_compare_lookup_failed", "Unable to load materialized face rows.");
  }

  return (data as AssetFaceMaterializationFaceRow[] | null) ?? [];
}

async function loadAssetMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  materializationId: string,
): Promise<AssetFaceMaterializationRow> {
  const { data, error } = await supabase
    .from("asset_face_materializations")
    .select(
      "id, tenant_id, project_id, asset_id, asset_type, source_content_hash, source_content_hash_algo, source_uploaded_at, materializer_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, materialized_at, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", materializationId)
    .single();

  if (error || !data) {
    throw new HttpError(404, "face_compare_materialization_missing", "Face materialization was not found.");
  }

  return data as AssetFaceMaterializationRow;
}

async function loadRecurringMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  materializationId: string,
): Promise<RecurringProfileHeadshotMaterializationRow> {
  const { data, error } = await supabase
    .from("recurring_profile_headshot_materializations")
    .select(
      "id, tenant_id, headshot_id, materialization_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, materialized_at, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", materializationId)
    .single();

  if (error || !data) {
    throw new HttpError(
      404,
      "recurring_profile_headshot_materialization_missing",
      "Recurring profile headshot materialization was not found.",
    );
  }

  return data as RecurringProfileHeadshotMaterializationRow;
}

async function loadRecurringMaterializationFaces(
  supabase: SupabaseClient,
  tenantId: string,
  materializationId: string,
): Promise<RecurringProfileHeadshotMaterializationFaceRow[]> {
  const { data, error } = await supabase
    .from("recurring_profile_headshot_materialization_faces")
    .select(
      "id, tenant_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("materialization_id", materializationId)
    .order("face_rank", { ascending: true });

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_faces_lookup_failed",
      "Unable to load recurring profile headshot faces.",
    );
  }

  return (data as RecurringProfileHeadshotMaterializationFaceRow[] | null) ?? [];
}

async function loadRecurringCompare(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  projectProfileParticipantId: string,
  assetId: string,
  recurringSelectionFaceId: string,
  assetMaterializationId: string,
  compareVersion: string,
) {
  const { data, error } = await supabase
    .from("asset_project_profile_face_compares")
    .select(
      "id, tenant_id, project_id, project_profile_participant_id, profile_id, asset_id, recurring_headshot_id, recurring_headshot_materialization_id, recurring_selection_face_id, asset_materialization_id, winning_asset_face_id, winning_asset_face_rank, winning_similarity, compare_status, compare_version, provider, provider_mode, provider_plugin_versions, target_face_count, compared_at, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("project_profile_participant_id", projectProfileParticipantId)
    .eq("asset_id", assetId)
    .eq("recurring_selection_face_id", recurringSelectionFaceId)
    .eq("asset_materialization_id", assetMaterializationId)
    .eq("compare_version", compareVersion)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_compare_lookup_failed", "Unable to load recurring materialized compare row.");
  }

  return (data as AssetProjectProfileFaceCompareRow | null) ?? null;
}

async function loadAssetFaceById(
  supabase: SupabaseClient,
  faceId: string | null,
): Promise<AssetFaceMaterializationFaceRow | null> {
  if (!faceId) {
    return null;
  }

  const { data, error } = await supabase
    .from("asset_face_materialization_faces")
    .select(
      "id, tenant_id, project_id, asset_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, face_source, created_by, created_at",
    )
    .eq("id", faceId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_compare_lookup_failed", "Unable to load face row.");
  }

  return (data as AssetFaceMaterializationFaceRow | null) ?? null;
}

function pickWinningFace(
  targetFaces: AssetFaceMaterializationFaceRow[],
  targetSimilarities: number[],
): { winningAssetFace: AssetFaceMaterializationFaceRow | null; winningSimilarity: number } {
  let winningAssetFace: AssetFaceMaterializationFaceRow | null = null;
  let winningSimilarity = 0;

  targetFaces.forEach((face, index) => {
    const similarity = normalizeSimilarityScore(targetSimilarities[index]);
    if (!winningAssetFace || similarity > winningSimilarity) {
      winningAssetFace = face;
      winningSimilarity = similarity;
      return;
    }

    if (similarity === winningSimilarity && winningAssetFace.face_rank > face.face_rank) {
      winningAssetFace = face;
    }
  });

  if (winningSimilarity <= 0) {
    return {
      winningAssetFace: null,
      winningSimilarity: 0,
    };
  }

  return {
    winningAssetFace,
    winningSimilarity,
  };
}

function toMillis(value: string | null | undefined) {
  const millis = Date.parse(String(value ?? ""));
  return Number.isFinite(millis) ? millis : null;
}

function isStoredCompareCurrent(input: {
  compare: AssetProjectProfileFaceCompareRow;
  recurringHeadshotMaterialization: RecurringProfileHeadshotMaterializationRow;
  assetMaterialization: AssetFaceMaterializationRow;
}) {
  const comparedAt = toMillis(input.compare.compared_at);
  const sourceMaterializedAt = toMillis(input.recurringHeadshotMaterialization.materialized_at);
  const assetMaterializedAt = toMillis(input.assetMaterialization.materialized_at);

  if (comparedAt === null || sourceMaterializedAt === null || assetMaterializedAt === null) {
    return false;
  }

  return comparedAt >= sourceMaterializedAt && comparedAt >= assetMaterializedAt;
}

async function syncRecurringFaceCompareScores(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  projectProfileParticipantId: string;
  profileId: string;
  assetId: string;
  recurringSelectionFaceId: string;
  recurringHeadshotMaterializationId: string;
  assetMaterializationId: string;
  compareVersion: string;
  provider: string;
  providerMode: string;
  providerPluginVersions: Record<string, unknown> | null;
  comparedAt: string;
  targetFaces: AssetFaceMaterializationFaceRow[];
  targetSimilarities: number[];
}) {
  const rows = input.targetFaces.map((face, index) => ({
    tenant_id: input.tenantId,
    project_id: input.projectId,
    project_profile_participant_id: input.projectProfileParticipantId,
    profile_id: input.profileId,
    asset_id: input.assetId,
    recurring_selection_face_id: input.recurringSelectionFaceId,
    recurring_headshot_materialization_id: input.recurringHeadshotMaterializationId,
    asset_materialization_id: input.assetMaterializationId,
    asset_face_id: face.id,
    asset_face_rank: face.face_rank,
    similarity: normalizeSimilarityScore(input.targetSimilarities[index]),
    compare_version: input.compareVersion,
    provider: input.provider,
    provider_mode: input.providerMode,
    provider_plugin_versions: input.providerPluginVersions,
    compared_at: input.comparedAt,
  }));

  if (rows.length > 0) {
    const { error: upsertError } = await input.supabase.from("asset_project_profile_face_compare_scores").upsert(rows, {
      onConflict:
        "tenant_id,project_id,project_profile_participant_id,asset_id,recurring_selection_face_id,asset_materialization_id,asset_face_id,compare_version",
    });

    if (upsertError) {
      throw new HttpError(500, "face_compare_score_write_failed", "Unable to persist recurring face compare scores.");
    }
  }

  const { data: existingRows, error: existingRowsError } = await input.supabase
    .from("asset_project_profile_face_compare_scores")
    .select("asset_face_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("project_profile_participant_id", input.projectProfileParticipantId)
    .eq("asset_id", input.assetId)
    .eq("recurring_selection_face_id", input.recurringSelectionFaceId)
    .eq("asset_materialization_id", input.assetMaterializationId)
    .eq("compare_version", input.compareVersion);

  if (existingRowsError) {
    throw new HttpError(500, "face_compare_score_lookup_failed", "Unable to load stored recurring face compare scores.");
  }

  const keepFaceIds = new Set(rows.map((row) => row.asset_face_id));
  const staleFaceIds = ((existingRows ?? []) as Array<{ asset_face_id: string }>).filter(
    (row) => !keepFaceIds.has(row.asset_face_id),
  );
  if (staleFaceIds.length === 0) {
    return;
  }

  const { error: staleDeleteError } = await input.supabase
    .from("asset_project_profile_face_compare_scores")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("project_profile_participant_id", input.projectProfileParticipantId)
    .eq("asset_id", input.assetId)
    .eq("recurring_selection_face_id", input.recurringSelectionFaceId)
    .eq("asset_materialization_id", input.assetMaterializationId)
    .eq("compare_version", input.compareVersion)
    .in(
      "asset_face_id",
      staleFaceIds.map((row) => row.asset_face_id),
    );

  if (staleDeleteError) {
    throw new HttpError(500, "face_compare_score_delete_failed", "Unable to remove stale recurring face compare scores.");
  }
}

async function hydrateCompare(
  supabase: SupabaseClient,
  recurringHeadshotMaterialization: RecurringProfileHeadshotMaterializationRow,
  assetMaterialization: AssetFaceMaterializationRow,
  compare: AssetProjectProfileFaceCompareRow,
  sourceFaces: RecurringProfileHeadshotMaterializationFaceRow[],
): Promise<EnsuredRecurringProfileMaterializedFaceCompare> {
  return {
    compare,
    recurringHeadshotMaterialization,
    assetMaterialization,
    selectionFace:
      sourceFaces.find((face) => face.id === compare.recurring_selection_face_id)
      ?? null,
    winningAssetFace: await loadAssetFaceById(supabase, compare.winning_asset_face_id),
  };
}

export async function ensureRecurringProfileMaterializedFaceCompare(
  input: EnsureRecurringProfileMaterializedFaceCompareInput,
): Promise<EnsuredRecurringProfileMaterializedFaceCompare> {
  const compareVersion = input.compareVersion ?? getAutoMatchCompareVersion();
  const recurringHeadshotMaterialization = await loadRecurringMaterialization(
    input.supabase,
    input.tenantId,
    input.recurringHeadshotMaterializationId,
  );
  const recurringFaces = await loadRecurringMaterializationFaces(
    input.supabase,
    input.tenantId,
    input.recurringHeadshotMaterializationId,
  );
  const assetMaterialization = await loadAssetMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetMaterializationId,
  );
  const assetFaces = await loadAssetMaterializationFaces(input.supabase, input.assetMaterializationId);

  if (recurringHeadshotMaterialization.headshot_id !== input.recurringHeadshotId) {
    throw new HttpError(400, "face_compare_invalid_source", "Recurring headshot materialization does not match headshot.");
  }

  if (assetMaterialization.asset_type !== "photo") {
    throw new HttpError(400, "face_compare_invalid_target", "Asset materialization must come from a photo asset.");
  }

  if (assetMaterialization.asset_id !== input.assetId) {
    throw new HttpError(400, "face_compare_asset_mismatch", "Asset materialization does not match compare asset.");
  }

  const existing = await loadRecurringCompare(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.projectProfileParticipantId,
    input.assetId,
    input.recurringSelectionFaceId,
    input.assetMaterializationId,
    compareVersion,
  );
  if (
    existing
    && isStoredCompareCurrent({
      compare: existing,
      recurringHeadshotMaterialization,
      assetMaterialization,
    })
  ) {
    return hydrateCompare(
      input.supabase,
      recurringHeadshotMaterialization,
      assetMaterialization,
      existing,
      recurringFaces,
    );
  }

  const selectionFace = recurringFaces.find((face) => face.id === input.recurringSelectionFaceId) ?? null;
  if (!selectionFace) {
    throw new HttpError(
      400,
      "face_compare_invalid_source",
      "Recurring selection face does not belong to the recurring headshot materialization.",
    );
  }

  const targetFaces = assetFaces.filter(
    (face): face is AssetFaceMaterializationFaceRow & { embedding: number[] } =>
      face.face_source === "detector" && Array.isArray(face.embedding) && face.embedding.length > 0,
  );
  let compareStatus: AssetProjectProfileFaceCompareStatus = "no_match";
  let winningAssetFace: AssetFaceMaterializationFaceRow | null = null;
  let winningSimilarity = 0;
  let targetSimilarities: number[] = [];
  let provider = assetMaterialization.provider;
  let providerMode = "materialized_skip";
  let providerPluginVersions: Record<string, unknown> | null = assetMaterialization.provider_plugin_versions ?? null;

  if (!recurringHeadshotMaterialization.usable_for_compare || !Array.isArray(selectionFace.embedding) || selectionFace.embedding.length === 0) {
    compareStatus = "source_unusable";
  } else if (targetFaces.length === 0) {
    compareStatus = "target_empty";
  } else {
    const compareEmbeddings = requireEmbeddingComparer(input.matcher);
    const compareResult = await compareEmbeddings({
      sourceEmbedding: selectionFace.embedding,
      targetEmbeddings: targetFaces.map((face) => face.embedding),
    });

    provider = compareResult.providerMetadata.provider;
    providerMode = compareResult.providerMetadata.providerMode;
    providerPluginVersions = compareResult.providerMetadata.providerPluginVersions ?? null;
    targetSimilarities = compareResult.targetSimilarities;

    const winning = pickWinningFace(targetFaces, targetSimilarities);
    winningAssetFace = winning.winningAssetFace;
    winningSimilarity = winning.winningSimilarity;
    compareStatus = winningAssetFace ? "matched" : "no_match";
  }

  const nowIso = new Date().toISOString();
  const compareUpsert = {
    tenant_id: input.tenantId,
    project_id: input.projectId,
    project_profile_participant_id: input.projectProfileParticipantId,
    profile_id: input.profileId,
    asset_id: input.assetId,
    recurring_headshot_id: input.recurringHeadshotId,
    recurring_headshot_materialization_id: input.recurringHeadshotMaterializationId,
    recurring_selection_face_id: input.recurringSelectionFaceId,
    asset_materialization_id: input.assetMaterializationId,
    winning_asset_face_id: winningAssetFace?.id ?? null,
    winning_asset_face_rank: winningAssetFace?.face_rank ?? null,
    winning_similarity: winningSimilarity,
    compare_status: compareStatus,
    compare_version: compareVersion,
    provider,
    provider_mode: providerMode,
    provider_plugin_versions: providerPluginVersions,
    target_face_count: targetFaces.length,
    compared_at: nowIso,
  };

  const { data, error } = await input.supabase
    .from("asset_project_profile_face_compares")
    .upsert(compareUpsert, {
      onConflict:
        "tenant_id,project_id,project_profile_participant_id,asset_id,recurring_selection_face_id,asset_materialization_id,compare_version",
    })
    .select(
      "id, tenant_id, project_id, project_profile_participant_id, profile_id, asset_id, recurring_headshot_id, recurring_headshot_materialization_id, recurring_selection_face_id, asset_materialization_id, winning_asset_face_id, winning_asset_face_rank, winning_similarity, compare_status, compare_version, provider, provider_mode, provider_plugin_versions, target_face_count, compared_at, created_at",
    )
    .single();

  if (error || !data) {
    throw new HttpError(500, "face_compare_write_failed", "Unable to persist recurring materialized face compare.");
  }

  await syncRecurringFaceCompareScores({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    projectProfileParticipantId: input.projectProfileParticipantId,
    profileId: input.profileId,
    assetId: input.assetId,
    recurringSelectionFaceId: input.recurringSelectionFaceId,
    recurringHeadshotMaterializationId: input.recurringHeadshotMaterializationId,
    assetMaterializationId: input.assetMaterializationId,
    compareVersion,
    provider,
    providerMode,
    providerPluginVersions,
    comparedAt: nowIso,
    targetFaces,
    targetSimilarities,
  });

  return {
    compare: data as AssetProjectProfileFaceCompareRow,
    recurringHeadshotMaterialization,
    assetMaterialization,
    selectionFace,
    winningAssetFace,
  };
}
