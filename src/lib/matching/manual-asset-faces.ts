import sharp from "sharp";
import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import { getAutoMatcher } from "@/lib/matching/auto-matcher";
import { createReviewCropFromNormalizedBox } from "@/lib/matching/face-review-crop";
import {
  ensureAssetFaceMaterialization,
  loadCurrentAssetFaceMaterialization,
  persistAssetFaceDerivative,
  type AssetFaceMaterializationFaceRow,
  type AssetFaceMaterializationRow,
} from "@/lib/matching/face-materialization";

type NormalizedFaceBoxInput = {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
};

type CreateManualAssetFaceInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  actorUserId: string;
  faceBoxNormalized: NormalizedFaceBoxInput;
};

type CreateManualAssetFaceResult = {
  created: boolean;
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  faceRank: number;
  faceSource: "detector" | "manual";
};

type LoadedPhotoAsset = {
  id: string;
  storage_bucket: string;
  storage_path: string;
};

type CanonicalNormalizedFaceBox = {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
};

const MIN_NORMALIZED_FACE_BOX_SIZE = 0.02;
const IDEMPOTENT_IOU_THRESHOLD = 0.98;
const OVERLAP_REJECTION_IOU_THRESHOLD = 0.9;
const MAX_INSERT_ATTEMPTS = 3;

function toFiniteNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function validateNormalizedFaceBox(input: NormalizedFaceBoxInput): CanonicalNormalizedFaceBox {
  const xMin = toFiniteNumber(input.x_min);
  const yMin = toFiniteNumber(input.y_min);
  const xMax = toFiniteNumber(input.x_max);
  const yMax = toFiniteNumber(input.y_max);

  if (xMin === null || yMin === null || xMax === null || yMax === null) {
    throw new HttpError(400, "invalid_face_box", "Manual face coordinates must be finite numbers.");
  }

  if (xMin < 0 || yMin < 0 || xMax > 1 || yMax > 1 || xMin >= xMax || yMin >= yMax) {
    throw new HttpError(400, "invalid_face_box", "Manual face coordinates must stay inside the image bounds.");
  }

  if (xMax - xMin < MIN_NORMALIZED_FACE_BOX_SIZE || yMax - yMin < MIN_NORMALIZED_FACE_BOX_SIZE) {
    throw new HttpError(400, "manual_face_too_small", "Manual face box is too small.");
  }

  return { xMin, yMin, xMax, yMax };
}

function deriveRawFaceBox(
  normalizedFaceBox: CanonicalNormalizedFaceBox,
  sourceWidth: number,
  sourceHeight: number,
) {
  const xMin = clamp(Math.floor(normalizedFaceBox.xMin * sourceWidth), 0, sourceWidth);
  const yMin = clamp(Math.floor(normalizedFaceBox.yMin * sourceHeight), 0, sourceHeight);
  const xMax = clamp(Math.ceil(normalizedFaceBox.xMax * sourceWidth), 0, sourceWidth);
  const yMax = clamp(Math.ceil(normalizedFaceBox.yMax * sourceHeight), 0, sourceHeight);

  if (xMin >= xMax || yMin >= yMax) {
    throw new HttpError(400, "invalid_face_box", "Manual face box does not map to a valid pixel rectangle.");
  }

  return {
    x_min: xMin,
    y_min: yMin,
    x_max: xMax,
    y_max: yMax,
    probability: null,
  };
}

function readNormalizedFaceBoxFromRow(
  face: AssetFaceMaterializationFaceRow,
  materialization: AssetFaceMaterializationRow,
): CanonicalNormalizedFaceBox | null {
  const normalized = face.face_box_normalized as Record<string, unknown> | null;
  if (normalized) {
    const xMin = toFiniteNumber(normalized.x_min);
    const yMin = toFiniteNumber(normalized.y_min);
    const xMax = toFiniteNumber(normalized.x_max);
    const yMax = toFiniteNumber(normalized.y_max);
    if (xMin !== null && yMin !== null && xMax !== null && yMax !== null) {
      return { xMin, yMin, xMax, yMax };
    }
  }

  if (!materialization.source_image_width || !materialization.source_image_height) {
    return null;
  }

  const raw = face.face_box as Record<string, unknown>;
  const xMin = toFiniteNumber(raw.x_min);
  const yMin = toFiniteNumber(raw.y_min);
  const xMax = toFiniteNumber(raw.x_max);
  const yMax = toFiniteNumber(raw.y_max);
  if (xMin === null || yMin === null || xMax === null || yMax === null) {
    return null;
  }

  return {
    xMin: xMin / materialization.source_image_width,
    yMin: yMin / materialization.source_image_height,
    xMax: xMax / materialization.source_image_width,
    yMax: yMax / materialization.source_image_height,
  };
}

function computeIntersectionOverUnion(
  left: CanonicalNormalizedFaceBox,
  right: CanonicalNormalizedFaceBox,
) {
  const xMin = Math.max(left.xMin, right.xMin);
  const yMin = Math.max(left.yMin, right.yMin);
  const xMax = Math.min(left.xMax, right.xMax);
  const yMax = Math.min(left.yMax, right.yMax);
  const intersectionWidth = Math.max(0, xMax - xMin);
  const intersectionHeight = Math.max(0, yMax - yMin);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const leftArea = (left.xMax - left.xMin) * (left.yMax - left.yMin);
  const rightArea = (right.xMax - right.xMin) * (right.yMax - right.yMin);
  const unionArea = leftArea + rightArea - intersectionArea;

  if (unionArea <= 0) {
    return 0;
  }

  return intersectionArea / unionArea;
}

function classifyOverlap(
  faces: AssetFaceMaterializationFaceRow[],
  materialization: AssetFaceMaterializationRow,
  normalizedFaceBox: CanonicalNormalizedFaceBox,
) {
  let bestMatch: { face: AssetFaceMaterializationFaceRow; iou: number } | null = null;

  for (const face of faces) {
    const existing = readNormalizedFaceBoxFromRow(face, materialization);
    if (!existing) {
      continue;
    }

    const iou = computeIntersectionOverUnion(existing, normalizedFaceBox);
    if (!bestMatch || iou > bestMatch.iou) {
      bestMatch = { face, iou };
    }
  }

  if (!bestMatch) {
    return { kind: "none" as const };
  }

  if (bestMatch.iou >= IDEMPOTENT_IOU_THRESHOLD) {
    return { kind: "idempotent" as const, face: bestMatch.face };
  }

  if (bestMatch.iou >= OVERLAP_REJECTION_IOU_THRESHOLD) {
    return { kind: "conflict" as const, face: bestMatch.face };
  }

  return { kind: "none" as const };
}

async function loadManualFaceAsset(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
): Promise<LoadedPhotoAsset> {
  const { data, error } = await supabase
    .from("assets")
    .select("id, storage_bucket, storage_path")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", assetId)
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "manual_face_asset_lookup_failed", "Unable to load the photo for manual face creation.");
  }

  if (!data?.id || !data.storage_bucket || !data.storage_path) {
    throw new HttpError(404, "asset_not_found", "Asset not found.");
  }

  return data as LoadedPhotoAsset;
}

async function ensureCurrentPhotoMaterialization(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
}) {
  const current =
    await loadCurrentAssetFaceMaterialization(
      input.supabase,
      input.tenantId,
      input.projectId,
      input.assetId,
      getAutoMatchMaterializerVersion(),
      { includeFaces: true },
    )
    ?? (
      await ensureAssetFaceMaterialization({
        supabase: input.supabase,
        matcher: getAutoMatcher(),
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetId: input.assetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: true,
      })
    );

  if (!current) {
    throw new HttpError(404, "asset_not_found", "Asset not found.");
  }

  if (
    !current.materialization.source_image_width
    || !current.materialization.source_image_height
    || current.materialization.source_coordinate_space !== "oriented_original"
  ) {
    throw new HttpError(
      409,
      "manual_face_source_image_unavailable",
      "The photo source image metadata is not available for manual face creation.",
    );
  }

  return current;
}

async function downloadAssetSourceBuffer(
  supabase: SupabaseClient,
  asset: LoadedPhotoAsset,
) {
  const { data, error } = await supabase.storage.from(asset.storage_bucket).download(asset.storage_path);
  if (error || !data) {
    return null;
  }

  const bytes = await data.arrayBuffer();
  if (bytes.byteLength <= 0) {
    return null;
  }

  return Buffer.from(bytes);
}

function isUniqueRankConflict(error: PostgrestError | null) {
  return error?.code === "23505";
}

async function persistManualFaceReviewCrop(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  asset: LoadedPhotoAsset;
  normalizedFaceBox: CanonicalNormalizedFaceBox;
  sourceWidth: number;
  sourceHeight: number;
}) {
  const sourceBuffer = await downloadAssetSourceBuffer(input.supabase, input.asset);
  if (!sourceBuffer) {
    return;
  }

  const orientedBuffer = await sharp(sourceBuffer, { failOn: "error" }).rotate().toBuffer();
  const derivative = await createReviewCropFromNormalizedBox(
    orientedBuffer,
    input.normalizedFaceBox,
    input.sourceWidth,
    input.sourceHeight,
  );

  if (!derivative) {
    return;
  }

  await persistAssetFaceDerivative({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
    materializationId: input.materializationId,
    assetFaceId: input.assetFaceId,
    derivative,
  });
}

export async function createManualAssetFace(
  input: CreateManualAssetFaceInput,
): Promise<CreateManualAssetFaceResult> {
  const asset = await loadManualFaceAsset(input.supabase, input.tenantId, input.projectId, input.assetId);
  const normalizedFaceBox = validateNormalizedFaceBox(input.faceBoxNormalized);

  let current = await ensureCurrentPhotoMaterialization({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });

  const sourceWidth = current.materialization.source_image_width ?? 0;
  const sourceHeight = current.materialization.source_image_height ?? 0;
  const rawFaceBox = deriveRawFaceBox(normalizedFaceBox, sourceWidth, sourceHeight);

  for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS; attempt += 1) {
    const overlap = classifyOverlap(current.faces, current.materialization, normalizedFaceBox);
    if (overlap.kind === "idempotent") {
      return {
        created: false,
        assetId: input.assetId,
        materializationId: current.materialization.id,
        assetFaceId: overlap.face.id,
        faceRank: overlap.face.face_rank,
        faceSource: overlap.face.face_source,
      };
    }

    if (overlap.kind === "conflict") {
      throw new HttpError(
        409,
        "manual_face_overlaps_existing_face",
        "Manual face overlaps an existing face too closely.",
      );
    }

    const nextFaceRank = current.faces.reduce((maxRank, face) => Math.max(maxRank, face.face_rank), -1) + 1;
    const { data, error } = await input.supabase
      .from("asset_face_materialization_faces")
      .insert({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        asset_id: input.assetId,
        materialization_id: current.materialization.id,
        face_rank: nextFaceRank,
        provider_face_index: null,
        detection_probability: null,
        face_box: rawFaceBox,
        face_box_normalized: {
          x_min: normalizedFaceBox.xMin,
          y_min: normalizedFaceBox.yMin,
          x_max: normalizedFaceBox.xMax,
          y_max: normalizedFaceBox.yMax,
          probability: null,
        },
        embedding: null,
        face_source: "manual",
        created_by: input.actorUserId,
      })
      .select("id, face_rank, face_source")
      .single();

    if (error && isUniqueRankConflict(error) && attempt < MAX_INSERT_ATTEMPTS) {
      current = await ensureCurrentPhotoMaterialization({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetId: input.assetId,
      });
      continue;
    }

    if (error || !data?.id) {
      throw new HttpError(500, "manual_face_create_failed", "Unable to create the manual face.");
    }

    try {
      await persistManualFaceReviewCrop({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetId: input.assetId,
        materializationId: current.materialization.id,
        assetFaceId: data.id,
        asset,
        normalizedFaceBox,
        sourceWidth,
        sourceHeight,
      });
    } catch {
      // Thumbnail creation is best-effort; the manual face remains valid without it.
    }

    return {
      created: true,
      assetId: input.assetId,
      materializationId: current.materialization.id,
      assetFaceId: data.id,
      faceRank: data.face_rank,
      faceSource: data.face_source as "manual",
    };
  }

  throw new HttpError(409, "manual_face_rank_conflict", "Manual face creation conflicted with another write.");
}
