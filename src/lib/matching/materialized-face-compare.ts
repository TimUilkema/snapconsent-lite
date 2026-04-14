import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAutoMatchCompareVersion } from "@/lib/matching/auto-match-config";
import type {
  AssetFaceMaterializationFaceRow,
  AssetFaceMaterializationRow,
} from "@/lib/matching/face-materialization";
import type { AutoMatcher } from "@/lib/matching/auto-matcher";

export type AssetConsentFaceCompareStatus = "matched" | "source_unusable" | "target_empty" | "no_match";

export type AssetConsentFaceCompareRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  asset_id: string;
  consent_id: string;
  headshot_materialization_id: string;
  asset_materialization_id: string;
  headshot_face_id: string | null;
  winning_asset_face_id: string | null;
  winning_asset_face_rank: number | null;
  winning_similarity: number;
  compare_status: AssetConsentFaceCompareStatus;
  compare_version: string;
  provider: string;
  provider_mode: string;
  provider_plugin_versions: Record<string, unknown> | null;
  target_face_count: number;
  compared_at: string;
  created_at: string;
};

export type EnsuredMaterializedFaceCompare = {
  compare: AssetConsentFaceCompareRow;
  headshotMaterialization: AssetFaceMaterializationRow;
  assetMaterialization: AssetFaceMaterializationRow;
  headshotFace: AssetFaceMaterializationFaceRow | null;
  winningAssetFace: AssetFaceMaterializationFaceRow | null;
};

type EnsureMaterializedFaceCompareInput = {
  supabase: SupabaseClient;
  matcher: AutoMatcher;
  tenantId: string;
  projectId: string;
  consentId: string;
  assetId: string;
  headshotMaterializationId: string;
  assetMaterializationId: string;
  compareVersion?: string;
};

type MaterializationWithFaces = {
  materialization: AssetFaceMaterializationRow;
  faces: AssetFaceMaterializationFaceRow[];
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

async function loadMaterializationFaces(
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

async function loadMaterialization(
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

async function loadMaterializationWithFaces(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  materializationId: string,
): Promise<MaterializationWithFaces> {
  const materialization = await loadMaterialization(supabase, tenantId, projectId, materializationId);
  const faces = await loadMaterializationFaces(supabase, materialization.id);
  return {
    materialization,
    faces,
  };
}

async function loadFaceCompare(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
  assetId: string,
  headshotMaterializationId: string,
  assetMaterializationId: string,
  compareVersion: string,
) {
  const { data, error } = await supabase
    .from("asset_consent_face_compares")
    .select(
      "id, tenant_id, project_id, asset_id, consent_id, headshot_materialization_id, asset_materialization_id, headshot_face_id, winning_asset_face_id, winning_asset_face_rank, winning_similarity, compare_status, compare_version, provider, provider_mode, provider_plugin_versions, target_face_count, compared_at, created_at",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("consent_id", consentId)
    .eq("asset_id", assetId)
    .eq("headshot_materialization_id", headshotMaterializationId)
    .eq("asset_materialization_id", assetMaterializationId)
    .eq("compare_version", compareVersion)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_compare_lookup_failed", "Unable to load materialized compare row.");
  }

  return (data as AssetConsentFaceCompareRow | null) ?? null;
}

function pickWinningFace(
  targetFaces: AssetFaceMaterializationFaceRow[],
  targetSimilarities: number[],
): { winningAssetFace: AssetFaceMaterializationFaceRow | null; winningSimilarity: number } {
  let winningAssetFace: AssetFaceMaterializationFaceRow | null = null;
  let winningSimilarity = 0;

  targetFaces.forEach((face, index) => {
    const parsedSimilarity = Number(targetSimilarities[index]);
    const similarity = Number.isFinite(parsedSimilarity) ? Math.max(0, Math.min(1, parsedSimilarity)) : 0;

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

async function loadFaceById(
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

async function syncFaceCompareScores(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
  assetId: string;
  headshotMaterializationId: string;
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
    asset_id: input.assetId,
    consent_id: input.consentId,
    headshot_materialization_id: input.headshotMaterializationId,
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
    const { error: upsertError } = await input.supabase.from("asset_consent_face_compare_scores").upsert(rows, {
      onConflict:
        "tenant_id,project_id,consent_id,asset_id,headshot_materialization_id,asset_materialization_id,asset_face_id,compare_version",
    });

    if (upsertError) {
      throw new HttpError(500, "face_compare_score_write_failed", "Unable to persist face compare scores.");
    }
  }

  const { data: existingRows, error: existingRowsError } = await input.supabase
    .from("asset_consent_face_compare_scores")
    .select("asset_face_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("asset_id", input.assetId)
    .eq("headshot_materialization_id", input.headshotMaterializationId)
    .eq("asset_materialization_id", input.assetMaterializationId)
    .eq("compare_version", input.compareVersion);

  if (existingRowsError) {
    throw new HttpError(500, "face_compare_score_lookup_failed", "Unable to load stored face compare scores.");
  }

  const keepFaceIds = new Set(rows.map((row) => row.asset_face_id));
  const staleFaceIds = ((existingRows ?? []) as Array<{ asset_face_id: string }>).filter(
    (row) => !keepFaceIds.has(row.asset_face_id),
  );
  if (staleFaceIds.length === 0) {
    return;
  }

  const { error: staleDeleteError } = await input.supabase
    .from("asset_consent_face_compare_scores")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("asset_id", input.assetId)
    .eq("headshot_materialization_id", input.headshotMaterializationId)
    .eq("asset_materialization_id", input.assetMaterializationId)
    .eq("compare_version", input.compareVersion)
    .in(
      "asset_face_id",
      staleFaceIds.map((row) => row.asset_face_id),
    );

  if (staleDeleteError) {
    throw new HttpError(500, "face_compare_score_delete_failed", "Unable to remove stale face compare scores.");
  }
}

async function hydrateCompare(
  supabase: SupabaseClient,
  headshotMaterialization: AssetFaceMaterializationRow,
  assetMaterialization: AssetFaceMaterializationRow,
  compare: AssetConsentFaceCompareRow,
  sourceFaces: AssetFaceMaterializationFaceRow[],
): Promise<EnsuredMaterializedFaceCompare> {
  const headshotFace =
    compare.headshot_face_id
      ? sourceFaces.find((face) => face.id === compare.headshot_face_id) ?? (await loadFaceById(supabase, compare.headshot_face_id))
      : null;

  return {
    compare,
    headshotMaterialization,
    assetMaterialization,
    headshotFace,
    winningAssetFace: await loadFaceById(supabase, compare.winning_asset_face_id),
  };
}

function toMillis(value: string | null | undefined) {
  const millis = Date.parse(String(value ?? ""));
  return Number.isFinite(millis) ? millis : null;
}

function isStoredCompareCurrent(input: {
  compare: AssetConsentFaceCompareRow;
  headshotMaterialization: AssetFaceMaterializationRow;
  assetMaterialization: AssetFaceMaterializationRow;
}) {
  const comparedAt = toMillis(input.compare.compared_at);
  const headshotMaterializedAt = toMillis(input.headshotMaterialization.materialized_at);
  const assetMaterializedAt = toMillis(input.assetMaterialization.materialized_at);

  if (comparedAt === null || headshotMaterializedAt === null || assetMaterializedAt === null) {
    return false;
  }

  return comparedAt >= headshotMaterializedAt && comparedAt >= assetMaterializedAt;
}

export async function ensureMaterializedFaceCompare(
  input: EnsureMaterializedFaceCompareInput,
): Promise<EnsuredMaterializedFaceCompare> {
  const compareVersion = input.compareVersion ?? getAutoMatchCompareVersion();
  const headshot = await loadMaterializationWithFaces(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.headshotMaterializationId,
  );
  const asset = await loadMaterializationWithFaces(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetMaterializationId,
  );

  if (headshot.materialization.asset_type !== "headshot") {
    throw new HttpError(400, "face_compare_invalid_source", "Headshot materialization must come from a headshot asset.");
  }

  if (asset.materialization.asset_type !== "photo") {
    throw new HttpError(400, "face_compare_invalid_target", "Asset materialization must come from a photo asset.");
  }

  if (headshot.materialization.asset_id !== headshot.faces[0]?.asset_id && headshot.faces.length > 0) {
    throw new HttpError(500, "face_compare_invalid_source_faces", "Headshot face rows do not match their materialization.");
  }

  if (asset.materialization.asset_id !== input.assetId) {
    throw new HttpError(400, "face_compare_asset_mismatch", "Asset materialization does not match compare asset.");
  }

  const existing = await loadFaceCompare(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.consentId,
    input.assetId,
    input.headshotMaterializationId,
    input.assetMaterializationId,
    compareVersion,
  );
  if (existing) {
    if (isStoredCompareCurrent({
      compare: existing,
      headshotMaterialization: headshot.materialization,
      assetMaterialization: asset.materialization,
    })) {
      return hydrateCompare(input.supabase, headshot.materialization, asset.materialization, existing, headshot.faces);
    }
  }

  const sourceFace = headshot.materialization.usable_for_compare ? headshot.faces[0] ?? null : null;
  const targetFaces = asset.faces.filter(
    (face): face is AssetFaceMaterializationFaceRow & { embedding: number[] } =>
      face.face_source === "detector" && Array.isArray(face.embedding) && face.embedding.length > 0,
  );
  let compareStatus: AssetConsentFaceCompareStatus = "no_match";
  let winningAssetFace: AssetFaceMaterializationFaceRow | null = null;
  let winningSimilarity = 0;
  let targetSimilarities: number[] = [];
  let provider = asset.materialization.provider;
  let providerMode = "materialized_skip";
  let providerPluginVersions: Record<string, unknown> | null = asset.materialization.provider_plugin_versions ?? null;

  if (!sourceFace?.embedding || sourceFace.face_source !== "detector") {
    compareStatus = "source_unusable";
  } else if (targetFaces.length === 0) {
    compareStatus = "target_empty";
  } else {
    const compareEmbeddings = requireEmbeddingComparer(input.matcher);
    const compareResult = await compareEmbeddings({
      sourceEmbedding: sourceFace.embedding,
      targetEmbeddings: targetFaces.map((face) => face.embedding),
    });

    provider = compareResult.providerMetadata.provider;
    providerMode = compareResult.providerMetadata.providerMode;
    providerPluginVersions = compareResult.providerMetadata.providerPluginVersions ?? null;
    targetSimilarities = compareResult.targetSimilarities;

    const winning = pickWinningFace(targetFaces, compareResult.targetSimilarities);
    winningAssetFace = winning.winningAssetFace;
    winningSimilarity = winning.winningSimilarity;
    compareStatus = winningAssetFace ? "matched" : "no_match";
  }

  const nowIso = new Date().toISOString();
  const compareUpsert = {
    tenant_id: input.tenantId,
    project_id: input.projectId,
    asset_id: input.assetId,
    consent_id: input.consentId,
    headshot_materialization_id: headshot.materialization.id,
    asset_materialization_id: asset.materialization.id,
    headshot_face_id: sourceFace?.id ?? null,
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
    .from("asset_consent_face_compares")
    .upsert(compareUpsert, {
      onConflict:
        "tenant_id,project_id,consent_id,asset_id,headshot_materialization_id,asset_materialization_id,compare_version",
    })
    .select(
      "id, tenant_id, project_id, asset_id, consent_id, headshot_materialization_id, asset_materialization_id, headshot_face_id, winning_asset_face_id, winning_asset_face_rank, winning_similarity, compare_status, compare_version, provider, provider_mode, provider_plugin_versions, target_face_count, compared_at, created_at",
    )
    .single();

  if (error || !data) {
    throw new HttpError(500, "face_compare_write_failed", "Unable to persist materialized face compare.");
  }

  await syncFaceCompareScores({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    consentId: input.consentId,
    assetId: input.assetId,
    headshotMaterializationId: headshot.materialization.id,
    assetMaterializationId: asset.materialization.id,
    compareVersion,
    provider,
    providerMode,
    providerPluginVersions,
    comparedAt: nowIso,
    targetFaces,
    targetSimilarities,
  });

  return {
    compare: data as AssetConsentFaceCompareRow,
    headshotMaterialization: headshot.materialization,
    assetMaterialization: asset.materialization,
    headshotFace: sourceFace,
    winningAssetFace,
  };
}
