import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import type {
  AutoMatcher,
  AutoMatcherFaceDerivative,
  AutoMatcherMaterializedFace,
  AutoMatcherStorageRef,
} from "@/lib/matching/auto-matcher";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

export type EligibleAssetForMaterialization = {
  assetId: string;
  assetType: "photo" | "headshot";
  storage: AutoMatcherStorageRef;
  contentHash: string | null;
  contentHashAlgo: string | null;
  uploadedAt: string | null;
};

export type AssetFaceMaterializationRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  asset_id: string;
  asset_type: "photo" | "headshot";
  source_content_hash: string | null;
  source_content_hash_algo: string | null;
  source_uploaded_at: string | null;
  materializer_version: string;
  provider: string;
  provider_mode: string;
  provider_plugin_versions: Record<string, unknown> | null;
  face_count: number;
  usable_for_compare: boolean;
  unusable_reason: string | null;
  source_image_width: number | null;
  source_image_height: number | null;
  source_coordinate_space: string;
  materialized_at: string;
  created_at: string;
};

export type AssetFaceMaterializationFaceRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  asset_id: string;
  materialization_id: string;
  face_rank: number;
  provider_face_index: number | null;
  detection_probability: number | null;
  face_box: Record<string, unknown>;
  face_box_normalized: Record<string, unknown> | null;
  embedding: number[] | null;
  face_source: "detector" | "manual";
  created_by: string | null;
  created_at: string;
};

export type AssetFaceImageDerivativeRow = {
  id: string;
  asset_face_id: string;
  materialization_id: string;
  asset_id: string;
  tenant_id: string;
  project_id: string;
  derivative_kind: "review_square_256";
  storage_bucket: string;
  storage_path: string;
  width: number;
  height: number;
  created_at: string;
};

export type EnsuredAssetFaceMaterialization = {
  asset: EligibleAssetForMaterialization;
  materialization: AssetFaceMaterializationRow;
  faces: AssetFaceMaterializationFaceRow[];
  facesLoaded: boolean;
};

export type ConsentHeadshotMaterialization = {
  consentId: string;
  headshotAssetId: string;
  materialization: AssetFaceMaterializationRow;
  faces: AssetFaceMaterializationFaceRow[];
  facesLoaded: boolean;
};

export type LoadedAssetFaceMaterialization = {
  materialization: AssetFaceMaterializationRow;
  faces: AssetFaceMaterializationFaceRow[];
  facesLoaded: boolean;
};

type EnsureAssetFaceMaterializationInput = {
  supabase: SupabaseClient;
  matcher: AutoMatcher;
  tenantId: string;
  projectId: string;
  assetId: string;
  materializerVersion?: string;
  includeFaces?: boolean;
  forceRematerialize?: boolean;
};

type MaterializationLoadOptions = {
  includeFaces?: boolean;
};

type MaterializationReadKind = "materialization" | "faces";
type MaterializationReadSource =
  | "ensure_existing_materialization"
  | "ensure_existing_faces"
  | "ensure_post_write_faces"
  | "current_asset_materialization"
  | "current_asset_faces";

type FaceMaterializationTestHooks = {
  beforeRead?: (input: {
    kind: MaterializationReadKind;
    source: MaterializationReadSource;
    assetId?: string;
    materializationId?: string;
    attempt: number;
    includeFaces: boolean;
  }) => void;
};

const MATERIALIZATION_READ_ATTEMPTS = 3;
const MATERIALIZATION_READ_RETRY_DELAY_MS = 25;

let faceMaterializationTestHooks: FaceMaterializationTestHooks | null = null;

export function __setFaceMaterializationTestHooks(hooks: FaceMaterializationTestHooks | null) {
  faceMaterializationTestHooks = hooks;
}

export function shouldForceRematerializeCurrentMaterialization(
  materialization: AssetFaceMaterializationRow | null | undefined,
) {
  if (!materialization) {
    return false;
  }

  if (materialization.asset_type === "photo") {
    return materialization.face_count <= 0;
  }

  return !materialization.usable_for_compare;
}

function requireMaterializer(matcher: AutoMatcher) {
  if (!matcher.materializeAssetFaces) {
    throw new HttpError(
      500,
      "face_match_provider_capability_missing",
      "Selected matcher provider does not support asset face materialization.",
    );
  }

  return matcher.materializeAssetFaces;
}

async function loadMaterializationFaces(
  supabase: SupabaseClient,
  materializationId: string,
): Promise<AssetFaceMaterializationFaceRow[]> {
  const { data, error } = await supabase
    .from("asset_face_materialization_faces")
    .select("id, tenant_id, project_id, asset_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, face_source, created_by, created_at")
    .eq("materialization_id", materializationId)
    .order("face_rank", { ascending: true });

  if (error) {
    throw new HttpError(500, "face_materialization_lookup_failed", "Unable to load materialized faces.");
  }

  return (data as AssetFaceMaterializationFaceRow[] | null) ?? [];
}

async function loadAssetFaceMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  materializerVersion: string,
) {
  const { data, error } = await supabase
    .from("asset_face_materializations")
    .select("id, tenant_id, project_id, asset_id, asset_type, source_content_hash, source_content_hash_algo, source_uploaded_at, materializer_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .eq("materializer_version", materializerVersion)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_materialization_lookup_failed", "Unable to load face materialization.");
  }

  return (data as AssetFaceMaterializationRow | null) ?? null;
}

function shouldRetryMaterializationRead(error: unknown) {
  return error instanceof HttpError && error.code === "face_materialization_lookup_failed";
}

function waitForMaterializationReadRetry() {
  return new Promise((resolve) => {
    setTimeout(resolve, MATERIALIZATION_READ_RETRY_DELAY_MS);
  });
}

async function runMaterializationReadWithRetry<T>(
  input: {
    kind: MaterializationReadKind;
    source: MaterializationReadSource;
    assetId?: string;
    materializationId?: string;
    includeFaces: boolean;
  },
  operation: () => Promise<T>,
) {
  for (let attempt = 1; attempt <= MATERIALIZATION_READ_ATTEMPTS; attempt += 1) {
    try {
      faceMaterializationTestHooks?.beforeRead?.({
        ...input,
        attempt,
      });
      return await operation();
    } catch (error) {
      if (!shouldRetryMaterializationRead(error) || attempt >= MATERIALIZATION_READ_ATTEMPTS) {
        throw error;
      }

      await waitForMaterializationReadRetry();
    }
  }

  throw new HttpError(500, "face_materialization_lookup_failed", "Unable to load face materialization.");
}

async function loadAssetFaceMaterializationWithRetry(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  materializerVersion: string;
  source: MaterializationReadSource;
  includeFaces: boolean;
}) {
  return runMaterializationReadWithRetry(
    {
      kind: "materialization",
      source: input.source,
      assetId: input.assetId,
      includeFaces: input.includeFaces,
    },
    async () =>
      loadAssetFaceMaterialization(
        input.supabase,
        input.tenantId,
        input.projectId,
        input.assetId,
        input.materializerVersion,
      ),
  );
}

async function loadAssetFaceMaterializationHeadersForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
  materializerVersion: string,
) {
  if (assetIds.length === 0) {
    return new Map<string, AssetFaceMaterializationRow>();
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materializations")
      .select(
        "id, tenant_id, project_id, asset_id, asset_type, source_content_hash, source_content_hash_algo, source_uploaded_at, materializer_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("materializer_version", materializerVersion)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "face_materialization_lookup_failed", "Unable to load face materializations.");
    }

    return (data as AssetFaceMaterializationRow[] | null) ?? [];
  });

  return new Map(rows.map((row) => [row.asset_id, row]));
}

async function loadMaterializationFacesWithRetry(input: {
  supabase: SupabaseClient;
  materializationId: string;
  source: MaterializationReadSource;
  includeFaces: boolean;
}) {
  return runMaterializationReadWithRetry(
    {
      kind: "faces",
      source: input.source,
      materializationId: input.materializationId,
      includeFaces: input.includeFaces,
    },
    async () => loadMaterializationFaces(input.supabase, input.materializationId),
  );
}

export async function loadEligibleAssetForMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("assets")
    .select("id, asset_type, storage_bucket, storage_path, content_hash, content_hash_algo, uploaded_at, retention_expires_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", assetId)
    .eq("status", "uploaded")
    .is("archived_at", null)
    .or(`asset_type.eq.photo,and(asset_type.eq.headshot,or(retention_expires_at.is.null,retention_expires_at.gt.${nowIso}))`)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "face_materialization_asset_lookup_failed", "Unable to load materialization asset.");
  }

  if (!data?.storage_bucket || !data.storage_path) {
    return null;
  }

  const assetType = data.asset_type === "headshot" ? "headshot" : "photo";
  return {
    assetId: data.id,
    assetType,
    storage: {
      storageBucket: data.storage_bucket,
      storagePath: data.storage_path,
    },
    contentHash: data.content_hash ?? null,
    contentHashAlgo: data.content_hash_algo ?? null,
    uploadedAt: data.uploaded_at ?? null,
  } satisfies EligibleAssetForMaterialization;
}

function getHeadshotUsability(faces: AutoMatcherMaterializedFace[]) {
  if (faces.length === 1) {
    return { usableForCompare: true, unusableReason: null };
  }

  if (faces.length === 0) {
    return { usableForCompare: false, unusableReason: "no_face" };
  }

  return { usableForCompare: false, unusableReason: "multiple_faces" };
}

function getMaterializationUsability(assetType: "photo" | "headshot", faces: AutoMatcherMaterializedFace[]) {
  if (assetType === "headshot") {
    return getHeadshotUsability(faces);
  }

  return {
    usableForCompare: true,
    unusableReason: null,
  };
}

function normalizeMaterializedFaceBox(face: AutoMatcherMaterializedFace) {
  return {
    x_min: face.faceBox.xMin,
    y_min: face.faceBox.yMin,
    x_max: face.faceBox.xMax,
    y_max: face.faceBox.yMax,
    probability: face.faceBox.probability ?? null,
  };
}

function normalizeMaterializedNormalizedFaceBox(face: AutoMatcherMaterializedFace) {
  if (!face.normalizedFaceBox) {
    return null;
  }

  return {
    x_min: face.normalizedFaceBox.xMin,
    y_min: face.normalizedFaceBox.yMin,
    x_max: face.normalizedFaceBox.xMax,
    y_max: face.normalizedFaceBox.yMax,
    probability: face.normalizedFaceBox.probability ?? null,
  };
}

export const FACE_DERIVATIVE_BUCKET = "asset-face-derivatives";
const MANUAL_FACE_TEMP_RANK_OFFSET = 1000;

export function buildFaceDerivativeStoragePath(input: {
  tenantId: string;
  projectId: string;
  materializationId: string;
  assetFaceId: string;
  derivativeKind: AutoMatcherFaceDerivative["derivativeKind"];
}) {
  return `tenant/${input.tenantId}/project/${input.projectId}/materialization/${input.materializationId}/face/${input.assetFaceId}/${input.derivativeKind}.webp`;
}

export async function persistAssetFaceDerivative(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  derivative: AutoMatcherFaceDerivative;
}) {
  const storagePath = buildFaceDerivativeStoragePath({
    tenantId: input.tenantId,
    projectId: input.projectId,
    materializationId: input.materializationId,
    assetFaceId: input.assetFaceId,
    derivativeKind: input.derivative.derivativeKind,
  });

  const { error: uploadError } = await input.supabase.storage
    .from(FACE_DERIVATIVE_BUCKET)
    .upload(storagePath, input.derivative.data, {
      contentType: input.derivative.contentType,
      upsert: true,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { error: derivativeError } = await input.supabase
    .from("asset_face_image_derivatives")
    .upsert(
      {
        asset_face_id: input.assetFaceId,
        materialization_id: input.materializationId,
        asset_id: input.assetId,
        tenant_id: input.tenantId,
        project_id: input.projectId,
        derivative_kind: input.derivative.derivativeKind,
        storage_bucket: FACE_DERIVATIVE_BUCKET,
        storage_path: storagePath,
        width: input.derivative.width,
        height: input.derivative.height,
      },
      {
        onConflict: "asset_face_id,derivative_kind",
      },
    );

  if (derivativeError) {
    throw derivativeError;
  }
}

async function persistFaceDerivatives(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  materializationId: string;
  faceRows: AssetFaceMaterializationFaceRow[];
  providerFaces: AutoMatcherMaterializedFace[];
}) {
  const derivatives = input.providerFaces
    .filter((face) => face.reviewCrop)
    .map((face) => {
      const faceRow = input.faceRows.find((row) => row.face_rank === face.faceRank) ?? null;
      const derivative = face.reviewCrop ?? null;
      if (!faceRow || !derivative) {
        return null;
      }

      return {
        faceRow,
        derivative,
      };
    })
    .filter((entry): entry is { faceRow: AssetFaceMaterializationFaceRow; derivative: AutoMatcherFaceDerivative } => Boolean(entry));

  for (const entry of derivatives) {
    try {
      await persistAssetFaceDerivative({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetId: input.assetId,
        materializationId: input.materializationId,
        assetFaceId: entry.faceRow.id,
        derivative: entry.derivative,
      });
    } catch {
      continue;
    }
  }
}

async function deleteMaterializationFaces(
  supabase: SupabaseClient,
  materializationId: string,
) {
  const { error } = await supabase
    .from("asset_face_materialization_faces")
    .delete()
    .eq("materialization_id", materializationId);

  if (error) {
    throw new HttpError(500, "face_materialization_write_failed", "Unable to replace stale materialized faces.");
  }
}

function isManualMaterializedFace(face: AssetFaceMaterializationFaceRow) {
  return face.face_source === "manual";
}

async function deleteDetectorMaterializationFaces(
  supabase: SupabaseClient,
  materializationId: string,
) {
  const { error } = await supabase
    .from("asset_face_materialization_faces")
    .delete()
    .eq("materialization_id", materializationId)
    .eq("face_source", "detector");

  if (error) {
    throw new HttpError(500, "face_materialization_write_failed", "Unable to replace detector materialized faces.");
  }
}

async function updateMaterializationFaceRank(
  supabase: SupabaseClient,
  faceId: string,
  faceRank: number,
) {
  const { error } = await supabase
    .from("asset_face_materialization_faces")
    .update({ face_rank: faceRank })
    .eq("id", faceId);

  if (error) {
    throw new HttpError(500, "face_materialization_write_failed", "Unable to preserve manual face ranks.");
  }
}

async function reassignManualFaceRanks(
  supabase: SupabaseClient,
  manualFaces: AssetFaceMaterializationFaceRow[],
  nextDetectorFaceCount: number,
) {
  const orderedManualFaces = manualFaces
    .slice()
    .sort((left, right) => left.face_rank - right.face_rank);

  if (orderedManualFaces.length === 0) {
    return;
  }

  const tempRankBase = nextDetectorFaceCount + orderedManualFaces.length + MANUAL_FACE_TEMP_RANK_OFFSET;
  for (const [index, face] of orderedManualFaces.entries()) {
    await updateMaterializationFaceRank(supabase, face.id, tempRankBase + index);
  }

  for (const [index, face] of orderedManualFaces.entries()) {
    await updateMaterializationFaceRank(supabase, face.id, nextDetectorFaceCount + index);
  }
}

export async function ensureAssetFaceMaterialization(
  input: EnsureAssetFaceMaterializationInput,
): Promise<EnsuredAssetFaceMaterialization | null> {
  const materializerVersion = input.materializerVersion ?? getAutoMatchMaterializerVersion();
  const includeFaces = input.includeFaces ?? true;
  const forceRematerialize = input.forceRematerialize ?? false;
  const asset = await loadEligibleAssetForMaterialization(input.supabase, input.tenantId, input.projectId, input.assetId);
  if (!asset) {
    return null;
  }

  const existing = await loadAssetFaceMaterializationWithRetry({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
    materializerVersion,
    source: "ensure_existing_materialization",
    includeFaces,
  });
  if (existing && !forceRematerialize) {
    return {
      asset,
      materialization: existing,
      faces: includeFaces
        ? await loadMaterializationFacesWithRetry({
            supabase: input.supabase,
            materializationId: existing.id,
            source: "ensure_existing_faces",
            includeFaces,
          })
        : [],
      facesLoaded: includeFaces,
    };
  }

  const materializeAssetFaces = requireMaterializer(input.matcher);
  const providerResult = await materializeAssetFaces({
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: asset.assetId,
    assetType: asset.assetType,
    storage: asset.storage,
    supabase: input.supabase,
  });
  const usability = getMaterializationUsability(asset.assetType, providerResult.faces);
  const nowIso = new Date().toISOString();

  const materializationUpsert = {
    tenant_id: input.tenantId,
    project_id: input.projectId,
    asset_id: asset.assetId,
    asset_type: asset.assetType,
    source_content_hash: asset.contentHash,
    source_content_hash_algo: asset.contentHashAlgo,
    source_uploaded_at: asset.uploadedAt,
    materializer_version: materializerVersion,
    provider: providerResult.providerMetadata.provider,
    provider_mode: providerResult.providerMetadata.providerMode,
    provider_plugin_versions: providerResult.providerMetadata.providerPluginVersions ?? null,
    face_count: providerResult.faces.length,
    usable_for_compare: usability.usableForCompare,
    unusable_reason: usability.unusableReason,
    source_image_width: providerResult.sourceImage?.width ?? null,
    source_image_height: providerResult.sourceImage?.height ?? null,
    source_coordinate_space: providerResult.sourceImage?.coordinateSpace ?? "oriented_original",
    materialized_at: nowIso,
  };

  const { data: materializationRow, error: materializationError } = await input.supabase
    .from("asset_face_materializations")
    .upsert(materializationUpsert, {
      onConflict: "tenant_id,project_id,asset_id,materializer_version",
    })
    .select("id, tenant_id, project_id, asset_id, asset_type, source_content_hash, source_content_hash_algo, source_uploaded_at, materializer_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at")
    .single();

  if (materializationError || !materializationRow) {
    throw new HttpError(500, "face_materialization_write_failed", "Unable to persist face materialization.");
  }

  const existingFaces =
    existing && asset.assetType === "photo"
      ? await loadMaterializationFacesWithRetry({
          supabase: input.supabase,
          materializationId: existing.id,
          source: "ensure_existing_faces",
          includeFaces: true,
        })
      : [];
  const manualFacesToPreserve = asset.assetType === "photo" ? existingFaces.filter(isManualMaterializedFace) : [];

  if (forceRematerialize && existing?.asset_type === "headshot" && existing.face_count > 0) {
    await deleteMaterializationFaces(input.supabase, materializationRow.id);
  }

  if (asset.assetType === "photo" && existing) {
    await deleteDetectorMaterializationFaces(input.supabase, materializationRow.id);
    await reassignManualFaceRanks(input.supabase, manualFacesToPreserve, providerResult.faces.length);
  }

  const faceRows = providerResult.faces.map((face) => ({
    tenant_id: input.tenantId,
    project_id: input.projectId,
    asset_id: asset.assetId,
    materialization_id: materializationRow.id,
    face_rank: face.faceRank,
    provider_face_index: face.providerFaceIndex ?? null,
    detection_probability: face.detectionProbability ?? null,
    face_box: normalizeMaterializedFaceBox(face),
    face_box_normalized: normalizeMaterializedNormalizedFaceBox(face),
    embedding: face.embedding,
    face_source: "detector" as const,
    created_by: null,
  }));

  if (faceRows.length > 0) {
    const { error: faceError } = await input.supabase.from("asset_face_materialization_faces").upsert(faceRows, {
      onConflict: "materialization_id,face_rank",
    });
    if (faceError) {
      throw new HttpError(500, "face_materialization_write_failed", "Unable to persist materialized faces.");
    }
  }

  const facesNeededForDerivatives = providerResult.faces.some((face) => face.reviewCrop);
  const loadedFaces = (includeFaces || facesNeededForDerivatives)
    ? await loadMaterializationFacesWithRetry({
        supabase: input.supabase,
        materializationId: materializationRow.id,
        source: "ensure_post_write_faces",
        includeFaces: includeFaces || facesNeededForDerivatives,
      })
    : [];

  await persistFaceDerivatives({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: asset.assetId,
    materializationId: materializationRow.id,
    faceRows: loadedFaces,
    providerFaces: providerResult.faces,
  });

  return {
    asset,
    materialization: materializationRow as AssetFaceMaterializationRow,
    faces: includeFaces ? loadedFaces : [],
    facesLoaded: includeFaces,
  };
}

export async function loadCurrentAssetFaceMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  materializerVersion = getAutoMatchMaterializerVersion(),
  options?: MaterializationLoadOptions,
): Promise<LoadedAssetFaceMaterialization | null> {
  const includeFaces = options?.includeFaces ?? true;
  const materialization = await loadAssetFaceMaterializationWithRetry({
    supabase,
    tenantId,
    projectId,
    assetId,
    materializerVersion,
    source: "current_asset_materialization",
    includeFaces,
  });
  if (!materialization) {
    return null;
  }

  return {
    materialization,
    faces: includeFaces
      ? await loadMaterializationFacesWithRetry({
          supabase,
          materializationId: materialization.id,
          source: "current_asset_faces",
          includeFaces,
        })
      : [],
    facesLoaded: includeFaces,
  };
}

export async function loadFaceImageDerivativesForFaceIds(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  faceIds: string[],
  derivativeKind: AssetFaceImageDerivativeRow["derivative_kind"] = "review_square_256",
) {
  if (faceIds.length === 0) {
    return new Map<string, AssetFaceImageDerivativeRow>();
  }

  const rows = await runChunkedRead(faceIds, async (faceIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_image_derivatives")
      .select(
        "id, asset_face_id, materialization_id, asset_id, tenant_id, project_id, derivative_kind, storage_bucket, storage_path, width, height, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("derivative_kind", derivativeKind)
      .in("asset_face_id", faceIdChunk);

    if (error) {
      throw new HttpError(500, "face_derivative_lookup_failed", "Unable to load face review derivatives.");
    }

    return (data as AssetFaceImageDerivativeRow[] | null) ?? [];
  });

  return new Map(rows.map((row) => [row.asset_face_id, row]));
}

type EligibleConsentWithHeadshotAsset = {
  consentId: string;
  headshotAssetId: string;
};

type CurrentProjectConsentHeadshotRow = {
  consent_id: string;
  headshot_asset_id: string;
  headshot_uploaded_at: string | null;
};

export type CurrentProjectConsentHeadshot = {
  consentId: string;
  headshotAssetId: string;
  headshotUploadedAt: string | null;
};

type HeadshotAssetRow = {
  id: string;
  uploaded_at: string | null;
};

export async function loadCurrentProjectConsentHeadshots(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  options?: {
    optInOnly?: boolean;
    notRevokedOnly?: boolean;
    limit?: number | null;
  },
) {
  const { data, error } = await supabase.rpc("list_current_project_consent_headshots", {
    p_tenant_id: tenantId,
    p_project_id: projectId,
    p_opt_in_only: options?.optInOnly ?? true,
    p_not_revoked_only: options?.notRevokedOnly ?? false,
    p_limit: options?.limit ?? null,
  });

  if (error) {
    const normalized = normalizePostgrestError(error, "face_match_headshot_lookup_failed");
    throw new HttpError(
      normalized.httpStatus === 414 ? 500 : 500,
      normalized.code === "request_uri_too_large" ? normalized.code : "face_match_headshot_lookup_failed",
      "Unable to load consent headshots.",
    );
  }

  return ((data ?? []) as CurrentProjectConsentHeadshotRow[]).map((row) => ({
    consentId: row.consent_id,
    headshotAssetId: row.headshot_asset_id,
    headshotUploadedAt: row.headshot_uploaded_at ?? null,
  })) satisfies CurrentProjectConsentHeadshot[];
}

async function loadCurrentHeadshotAssetForConsent(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
) {
  const { data: links, error: linksError } = await supabase
    .from("asset_consent_links")
    .select("asset_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("consent_id", consentId);

  if (linksError) {
    throw new HttpError(500, "face_match_headshot_lookup_failed", "Unable to load consent headshots.");
  }

  const linkedHeadshotIds = Array.from(new Set((links ?? []).map((row) => row.asset_id)));
  if (linkedHeadshotIds.length === 0) {
    return null;
  }

  const nowIso = new Date().toISOString();
  const eligibleHeadshots = await runChunkedRead(linkedHeadshotIds, async (headshotIdChunk) => {
    // safe-in-filter: bounded single-consent headshot validation runs through shared chunking.
    const { data, error } = await supabase
      .from("assets")
      .select("id, uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "headshot")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .or(`retention_expires_at.is.null,retention_expires_at.gt.${nowIso}`)
      // safe-in-filter: headshot validation is batch-bounded and chunked by shared helper.
      .in("id", headshotIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_headshot_lookup_failed", "Unable to validate consent headshots.");
    }

    return (data as HeadshotAssetRow[] | null) ?? [];
  });

  return eligibleHeadshots
    .sort((left, right) => (right.uploaded_at ?? "").localeCompare(left.uploaded_at ?? ""))[0]
    ?? null;
}

async function loadEligibleConsentsWithHeadshotAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  limit: number,
) {
  const rows = await loadCurrentProjectConsentHeadshots(supabase, tenantId, projectId, {
    optInOnly: true,
    notRevokedOnly: true,
    limit,
  });

  return rows.map((row) => ({
    consentId: row.consentId,
    headshotAssetId: row.headshotAssetId,
  })) satisfies EligibleConsentWithHeadshotAsset[];
}

export async function loadEligibleConsentHeadshotMaterializations(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  limit: number,
  materializerVersion = getAutoMatchMaterializerVersion(),
  options?: MaterializationLoadOptions,
) {
  const includeFaces = options?.includeFaces ?? false;
  const eligibleConsents = await loadEligibleConsentsWithHeadshotAssets(supabase, tenantId, projectId, limit);
  if (eligibleConsents.length === 0) {
    return [] as Array<ConsentHeadshotMaterialization>;
  }

  if (!includeFaces) {
    const materializationsByAssetId = await loadAssetFaceMaterializationHeadersForAssets(
      supabase,
      tenantId,
      projectId,
      eligibleConsents.map((row) => row.headshotAssetId),
      materializerVersion,
    );

    return eligibleConsents.flatMap((row) => {
      const materialization = materializationsByAssetId.get(row.headshotAssetId);
      if (!materialization) {
        return [];
      }

      return [
        {
          consentId: row.consentId,
          headshotAssetId: row.headshotAssetId,
          materialization,
          faces: [],
          facesLoaded: false,
        } satisfies ConsentHeadshotMaterialization,
      ];
    });
  }

  const materializations = await Promise.all(
    eligibleConsents.map(async (row) => {
      const loaded = await loadCurrentAssetFaceMaterialization(
        supabase,
        tenantId,
        projectId,
        row.headshotAssetId,
        materializerVersion,
        { includeFaces },
      );
      if (!loaded) {
        return null;
      }

      return {
        consentId: row.consentId,
        headshotAssetId: row.headshotAssetId,
        materialization: loaded.materialization,
        faces: loaded.faces,
        facesLoaded: loaded.facesLoaded,
      } satisfies ConsentHeadshotMaterialization;
    }),
  );

  return materializations.filter((row): row is ConsentHeadshotMaterialization => row !== null);
}

export async function loadConsentHeadshotMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentId: string,
  materializerVersion = getAutoMatchMaterializerVersion(),
  options?: MaterializationLoadOptions,
) {
  const currentHeadshot = await loadCurrentHeadshotAssetForConsent(supabase, tenantId, projectId, consentId);
  if (!currentHeadshot) {
    return null;
  }

  const loaded = await loadCurrentAssetFaceMaterialization(
    supabase,
    tenantId,
    projectId,
    currentHeadshot.id,
    materializerVersion,
    options,
  );
  if (!loaded) {
    return null;
  }

  return {
    consentId,
    headshotAssetId: currentHeadshot.id,
    materialization: loaded.materialization,
    faces: loaded.faces,
    facesLoaded: loaded.facesLoaded,
  };
}

export async function loadEligiblePhotoMaterializations(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  limit: number,
  materializerVersion = getAutoMatchMaterializerVersion(),
  options?: MaterializationLoadOptions,
) {
  const includeFaces = options?.includeFaces ?? false;
  const { data, error } = await supabase
    .from("assets")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .limit(limit);

  if (error) {
    throw new HttpError(500, "face_match_asset_lookup_failed", "Unable to load project photo candidates.");
  }

  const assetIds = ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (assetIds.length === 0) {
    return [] as Array<{
      assetId: string;
      materialization: AssetFaceMaterializationRow;
      faces: AssetFaceMaterializationFaceRow[];
      facesLoaded: boolean;
    }>;
  }

  if (!includeFaces) {
    const materializationsByAssetId = await loadAssetFaceMaterializationHeadersForAssets(
      supabase,
      tenantId,
      projectId,
      assetIds,
      materializerVersion,
    );

    return assetIds.flatMap((assetId) => {
      const materialization = materializationsByAssetId.get(assetId);
      if (!materialization) {
        return [];
      }

      return [
        {
          assetId,
          materialization,
          faces: [],
          facesLoaded: false,
        },
      ];
    });
  }

  const loaded = await Promise.all(
    assetIds.map(async (assetId) => {
      const materialization = await loadCurrentAssetFaceMaterialization(
        supabase,
        tenantId,
        projectId,
        assetId,
        materializerVersion,
        { includeFaces },
      );
      if (!materialization) {
        return null;
      }

      return {
        assetId,
        materialization: materialization.materialization,
        faces: materialization.faces,
        facesLoaded: materialization.facesLoaded,
      };
    }),
  );

  return loaded.filter((row): row is NonNullable<typeof row> => row !== null);
}

export async function loadEligibleConsentsForHeadshotAsset(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  headshotAssetId: string,
) {
  const { data: links, error: linksError } = await supabase
    .from("asset_consent_links")
    .select("consent_id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", headshotAssetId);

  if (linksError) {
    throw new HttpError(500, "face_match_headshot_lookup_failed", "Unable to load headshot-linked consents.");
  }

  const linkedConsentIds = Array.from(new Set((links ?? []).map((row) => row.consent_id)));
  if (linkedConsentIds.length === 0) {
    return [] as string[];
  }

  const consents = await runChunkedRead(linkedConsentIds, async (consentIdChunk) => {
    // safe-in-filter: bounded headshot-linked consent validation runs through shared chunking.
    const { data, error } = await supabase
      .from("consents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("face_match_opt_in", true)
      .is("revoked_at", null)
      // safe-in-filter: consent validation is request-bounded and chunked by shared helper.
      .in("id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "face_match_consent_lookup_failed", "Unable to validate headshot-linked consents.");
    }

    return (data ?? []) as Array<{ id: string }>;
  });

  return consents.map((row) => row.id);
}
