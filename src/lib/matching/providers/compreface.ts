import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { HttpError } from "@/lib/http/errors";
import { getAutoMatchProviderConcurrency, getCompreFaceConfig } from "@/lib/matching/auto-match-config";
import type {
  AutoMatcher,
  AutoMatcherCandidate,
  AutoMatcherEmbeddingCompareInput,
  AutoMatcherEmbeddingCompareResult,
  AutoMatcherFaceBox,
  AutoMatcherFaceEvidence,
  AutoMatcherMatch,
  AutoMatcherMaterializationResult,
  AutoMatcherMaterializedFace,
  AutoMatcherProviderMetadata,
  AutoMatcherStorageRef,
} from "@/lib/matching/auto-matcher";
import { MatcherProviderError } from "@/lib/matching/provider-errors";

type DownloadedImage = {
  base64: string;
  byteSize: number;
};

type PreparedMaterializationImage = {
  base64: string;
  byteSize: number;
  orientedSourceBuffer: Buffer;
  sourceWidth: number;
  sourceHeight: number;
  processedWidth: number;
  processedHeight: number;
};

type DownloadCache = Map<string, DownloadedImage>;
type DownloadInFlight = Map<string, Promise<DownloadedImage | null>>;
type DownloadTarget = "photo" | "headshot";
type VerifyContext = {
  assetId: string;
  consentId: string;
  jobType: string;
  photoByteSize: number;
  headshotByteSize: number;
};

type CompreFaceFaceBox = {
  probability?: number;
  x_max?: number;
  y_max?: number;
  x_min?: number;
  y_min?: number;
};

type CompreFaceVerifyResponse = {
  result?: Array<{
    source_image_face?: {
      box?: CompreFaceFaceBox;
      embedding?: number[];
    };
    face_matches?: Array<{
      similarity?: number;
      box?: CompreFaceFaceBox;
      embedding?: number[];
      face?: {
        box?: CompreFaceFaceBox;
        embedding?: number[];
      };
    }>;
    plugins_versions?: Record<string, unknown>;
  }>;
  plugins_versions?: Record<string, unknown>;
};

type CompreFaceDetectionResponse = {
  result?: Array<{
    box?: CompreFaceFaceBox;
    embedding?: number[];
    plugins_versions?: Record<string, unknown>;
  }>;
  plugins_versions?: Record<string, unknown>;
};

type CompreFaceEmbeddingVerifyResponse = {
  result?: Array<{
    similarity?: number;
    embedding?: number[];
  }>;
};

export const COMPREFACE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PHOTO_LONGEST_SIDE_CAP = 1920;
const HEADSHOT_LONGEST_SIDE_CAP = 1280;
const MIN_LONGEST_SIDE_CAP = 480;
const RESIZE_ATTEMPTS = 5;
const QUALITY_STEPS = [82, 76, 70, 64, 58, 52, 46];
const PASSTHROUGH_FORMATS = new Set(["jpeg", "png"]);
const REVIEW_CROP_SIZE = 256;

function isDevelopmentLoggingEnabled() {
  return process.env.NODE_ENV !== "production";
}

function logCompreFaceDevelopment(event: string, fields: Record<string, unknown>) {
  if (!isDevelopmentLoggingEnabled()) {
    return;
  }

  console.info(`[matching][compreface] ${event}`, fields);
}

function percentile(values: number[], p: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const position = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[position] ?? 0;
}

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getStorageClient(supabase?: SupabaseClient) {
  return supabase ?? createServiceRoleClient();
}

function normalizeConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, Number(value)));
}

function parseSimilarity(data: CompreFaceVerifyResponse | null) {
  if (!data?.result || data.result.length === 0) {
    return 0;
  }

  const confidence = data.result[0]?.face_matches?.[0]?.similarity;
  return normalizeConfidence(confidence);
}

function normalizeFaceBox(
  box: CompreFaceFaceBox | null | undefined,
): AutoMatcherFaceBox | null {
  if (!box) {
    return null;
  }

  const xMin = Number(box.x_min);
  const yMin = Number(box.y_min);
  const xMax = Number(box.x_max);
  const yMax = Number(box.y_max);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin) || !Number.isFinite(xMax) || !Number.isFinite(yMax)) {
    return null;
  }

  if (xMax < xMin || yMax < yMin) {
    return null;
  }

  const probability = Number(box.probability);
  return {
    xMin,
    yMin,
    xMax,
    yMax,
    probability: Number.isFinite(probability) ? normalizeConfidence(probability) : null,
  };
}

function normalizeEmbedding(embedding: number[] | null | undefined) {
  if (!Array.isArray(embedding) || embedding.length === 0) {
    return null;
  }

  const normalized = embedding
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  if (normalized.length !== embedding.length) {
    return null;
  }

  return normalized;
}

function getEmbeddingKey(embedding: number[] | null | undefined) {
  const normalized = normalizeEmbedding(embedding);
  if (!normalized) {
    return null;
  }

  return JSON.stringify(normalized);
}

function parsePluginVersions(data: CompreFaceVerifyResponse | null) {
  if (data?.plugins_versions && typeof data.plugins_versions === "object" && !Array.isArray(data.plugins_versions)) {
    return data.plugins_versions;
  }

  const resultItemPluginVersions = data?.result?.[0]?.plugins_versions;
  if (
    resultItemPluginVersions
    && typeof resultItemPluginVersions === "object"
    && !Array.isArray(resultItemPluginVersions)
  ) {
    return resultItemPluginVersions;
  }

  return null;
}

function parseFaceEvidence(data: CompreFaceVerifyResponse | null): AutoMatcherFaceEvidence[] {
  if (!data?.result || data.result.length === 0) {
    return [];
  }

  const faces: AutoMatcherFaceEvidence[] = [];
  data.result.forEach((resultItem) => {
    const sourceFaceBox = normalizeFaceBox(resultItem.source_image_face?.box);
    const sourceEmbedding = normalizeEmbedding(resultItem.source_image_face?.embedding);
    (resultItem.face_matches ?? []).forEach((faceMatch, providerFaceIndex) => {
      const faceGeometry = faceMatch.face ?? faceMatch;
      faces.push({
        similarity: normalizeConfidence(faceMatch.similarity),
        sourceFaceBox,
        targetFaceBox: normalizeFaceBox(faceGeometry.box),
        sourceEmbedding,
        targetEmbedding: normalizeEmbedding(faceGeometry.embedding),
        providerFaceIndex,
      });
    });
  });

  return faces.sort((left, right) => {
    if (right.similarity !== left.similarity) {
      return right.similarity - left.similarity;
    }

    const leftIndex = left.providerFaceIndex ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = right.providerFaceIndex ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return JSON.stringify(left.targetFaceBox ?? {}).localeCompare(JSON.stringify(right.targetFaceBox ?? {}));
  });
}

function isNoFaceDetectedMessage(providerMessage: string | null) {
  const normalized = String(providerMessage ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return false;
  }

  return normalized.includes("no face");
}

function getLongestSideCap(target: DownloadTarget) {
  if (target === "headshot") {
    return HEADSHOT_LONGEST_SIDE_CAP;
  }

  return PHOTO_LONGEST_SIDE_CAP;
}

function normalizeImageFormat(format: string | undefined | null) {
  const normalized = String(format ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "jpg") {
    return "jpeg";
  }

  return normalized;
}

export async function preprocessImageForCompreFace(
  sourceBuffer: Buffer,
  target: DownloadTarget,
) {
  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(sourceBuffer, { failOn: "error" }).metadata();
  } catch {
    throw new MatcherProviderError(
      "compreface_image_preprocess_failed",
      "Unable to decode image before CompreFace upload.",
      false,
    );
  }

  const normalizedFormat = normalizeImageFormat(metadata.format);
  const canPassthrough = PASSTHROUGH_FORMATS.has(normalizedFormat);
  if (sourceBuffer.length <= COMPREFACE_MAX_IMAGE_BYTES && canPassthrough) {
    return sourceBuffer;
  }

  const sourceLongestSide = Math.max(metadata.width ?? 0, metadata.height ?? 0);
  const initialCap = sourceLongestSide > 0 ? Math.min(sourceLongestSide, getLongestSideCap(target)) : getLongestSideCap(target);

  for (let attempt = 0; attempt < RESIZE_ATTEMPTS; attempt += 1) {
    const scale = Math.pow(0.82, attempt);
    const longestSideCap = Math.max(MIN_LONGEST_SIDE_CAP, Math.floor(initialCap * scale));

    for (const quality of QUALITY_STEPS) {
      try {
        const resized = await sharp(sourceBuffer, { failOn: "error" })
          .rotate()
          .resize({
            width: longestSideCap,
            height: longestSideCap,
            fit: "inside",
            withoutEnlargement: true,
          })
          .jpeg({
            quality,
            mozjpeg: true,
          })
          .toBuffer();

        if (resized.length <= COMPREFACE_MAX_IMAGE_BYTES) {
          return resized;
        }
      } catch {
        throw new MatcherProviderError(
          "compreface_image_preprocess_failed",
          "Unable to preprocess image for CompreFace.",
          false,
        );
      }
    }
  }

  throw new MatcherProviderError(
    "compreface_image_too_large",
    "Image remains above CompreFace size limit after preprocessing.",
    false,
  );
}

async function downloadStorageRefBuffer(
  supabase: SupabaseClient,
  ref: AutoMatcherStorageRef,
) {
  const { data, error } = await supabase.storage.from(ref.storageBucket).download(ref.storagePath);
  if (error || !data) {
    return null;
  }

  const bytes = await data.arrayBuffer();
  if (bytes.byteLength === 0) {
    return null;
  }

  return Buffer.from(bytes);
}

async function getOrientedImageBuffer(sourceBuffer: Buffer) {
  try {
    const oriented = await sharp(sourceBuffer, { failOn: "error" }).rotate().toBuffer();
    const metadata = await sharp(oriented, { failOn: "error" }).metadata();
    return {
      buffer: oriented,
      width: metadata.width ?? 0,
      height: metadata.height ?? 0,
      format: normalizeImageFormat(metadata.format),
    };
  } catch {
    throw new MatcherProviderError(
      "compreface_image_preprocess_failed",
      "Unable to decode image before CompreFace upload.",
      false,
    );
  }
}

async function prepareImageForCompreFaceMaterialization(
  sourceBuffer: Buffer,
  target: DownloadTarget,
): Promise<PreparedMaterializationImage> {
  const oriented = await getOrientedImageBuffer(sourceBuffer);
  const canPassthrough = PASSTHROUGH_FORMATS.has(oriented.format);
  if (oriented.buffer.length <= COMPREFACE_MAX_IMAGE_BYTES && canPassthrough) {
    return {
      base64: oriented.buffer.toString("base64"),
      byteSize: oriented.buffer.length,
      orientedSourceBuffer: oriented.buffer,
      sourceWidth: oriented.width,
      sourceHeight: oriented.height,
      processedWidth: oriented.width,
      processedHeight: oriented.height,
    };
  }

  const processedBuffer = await preprocessImageForCompreFace(oriented.buffer, target);
  let processedMetadata: sharp.Metadata;
  try {
    processedMetadata = await sharp(processedBuffer, { failOn: "error" }).metadata();
  } catch {
    throw new MatcherProviderError(
      "compreface_image_preprocess_failed",
      "Unable to preprocess image for CompreFace.",
      false,
    );
  }

  return {
    base64: processedBuffer.toString("base64"),
    byteSize: processedBuffer.length,
    orientedSourceBuffer: oriented.buffer,
    sourceWidth: oriented.width,
    sourceHeight: oriented.height,
    processedWidth: processedMetadata.width ?? oriented.width,
    processedHeight: processedMetadata.height ?? oriented.height,
  };
}

function clampDimension(value: number, max: number) {
  return Math.max(0, Math.min(max, value));
}

function toNormalizedFaceBox(faceBox: AutoMatcherFaceBox, width: number, height: number): AutoMatcherFaceBox | null {
  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    xMin: clampDimension(faceBox.xMin / width, 1),
    yMin: clampDimension(faceBox.yMin / height, 1),
    xMax: clampDimension(faceBox.xMax / width, 1),
    yMax: clampDimension(faceBox.yMax / height, 1),
    probability: faceBox.probability ?? null,
  };
}

function buildReviewCropRect(
  normalizedFaceBox: AutoMatcherFaceBox,
  sourceWidth: number,
  sourceHeight: number,
) {
  const xMin = clampDimension(normalizedFaceBox.xMin * sourceWidth, sourceWidth);
  const yMin = clampDimension(normalizedFaceBox.yMin * sourceHeight, sourceHeight);
  const xMax = clampDimension(normalizedFaceBox.xMax * sourceWidth, sourceWidth);
  const yMax = clampDimension(normalizedFaceBox.yMax * sourceHeight, sourceHeight);
  const faceWidth = Math.max(1, xMax - xMin);
  const faceHeight = Math.max(1, yMax - yMin);
  const side = Math.max(faceWidth, faceHeight) * 1.6;
  const centerX = (xMin + xMax) / 2;
  const centerY = (yMin + yMax) / 2;
  const left = clampDimension(centerX - side / 2, sourceWidth);
  const top = clampDimension(centerY - side / 2, sourceHeight);
  const right = clampDimension(centerX + side / 2, sourceWidth);
  const bottom = clampDimension(centerY + side / 2, sourceHeight);
  const width = Math.max(1, Math.round(right - left));
  const height = Math.max(1, Math.round(bottom - top));
  return {
    left: Math.max(0, Math.min(sourceWidth - 1, Math.round(left))),
    top: Math.max(0, Math.min(sourceHeight - 1, Math.round(top))),
    width: Math.min(width, sourceWidth),
    height: Math.min(height, sourceHeight),
  };
}

async function createReviewCrop(
  orientedSourceBuffer: Buffer,
  normalizedFaceBox: AutoMatcherFaceBox,
  sourceWidth: number,
  sourceHeight: number,
) {
  try {
    const rect = buildReviewCropRect(normalizedFaceBox, sourceWidth, sourceHeight);
    const buffer = await sharp(orientedSourceBuffer, { failOn: "error" })
      .extract(rect)
      .resize({
        width: REVIEW_CROP_SIZE,
        height: REVIEW_CROP_SIZE,
        fit: "cover",
        position: "centre",
      })
      .webp({ quality: 84 })
      .toBuffer();

    return {
      derivativeKind: "review_square_256" as const,
      contentType: "image/webp" as const,
      data: buffer,
      width: REVIEW_CROP_SIZE,
      height: REVIEW_CROP_SIZE,
    };
  } catch {
    return null;
  }
}

async function downloadAsBase64(
  supabase: SupabaseClient,
  candidate: AutoMatcherCandidate,
  target: DownloadTarget,
  cache: DownloadCache,
  inFlight: DownloadInFlight,
) {
  const ref = target === "photo" ? candidate.photo : candidate.headshot;
  return downloadStorageRefAsBase64(supabase, ref, target, cache, inFlight);
}

async function downloadStorageRefAsBase64(
  supabase: SupabaseClient,
  ref: AutoMatcherStorageRef,
  target: DownloadTarget,
  cache: DownloadCache,
  inFlight: DownloadInFlight,
) {
  if (!ref.storageBucket || !ref.storagePath) {
    return null;
  }

  const cacheKey = `${ref.storageBucket}:${ref.storagePath}`;
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pending = inFlight.get(cacheKey);
  if (pending) {
    return pending;
  }

  const downloadPromise = (async () => {
    const sourceBuffer = await downloadStorageRefBuffer(supabase, ref);
    if (!sourceBuffer) {
      return null;
    }

    const preprocessedBuffer = await preprocessImageForCompreFace(sourceBuffer, target);
    const encodedImage: DownloadedImage = {
      base64: preprocessedBuffer.toString("base64"),
      byteSize: preprocessedBuffer.length,
    };
    cache.set(cacheKey, encodedImage);
    return encodedImage;
  })()
    .finally(() => {
      inFlight.delete(cacheKey);
    });

  inFlight.set(cacheKey, downloadPromise);
  return downloadPromise;
}

function throwCompreFaceResponseError(
  response: Response,
  providerMessage: string | null,
  action: "detect" | "verify" | "compare_embeddings",
) {
  if (response.status === 404) {
    const serviceAction = action === "verify" ? "verification" : action;
    throw new MatcherProviderError(
      `${serviceAction}_service_not_found`,
      `CompreFace ${serviceAction} service was not found for the provided API key.`,
      false,
    );
  }

  if (response.status === 401 || response.status === 403) {
    throw new MatcherProviderError(
      "provider_auth_error",
      "CompreFace credentials were rejected.",
      false,
    );
  }

  if (response.status === 400) {
    throw new MatcherProviderError(
      "provider_bad_request",
      `CompreFace rejected the ${action} request payload.`,
      false,
    );
  }

  if (response.status === 413) {
    throw new MatcherProviderError(
      "provider_payload_too_large",
      "CompreFace rejected the image payload as too large.",
      true,
    );
  }

  if (response.status === 415) {
    throw new MatcherProviderError(
      "provider_unsupported_format",
      "CompreFace rejected the image format.",
      false,
    );
  }

  if (response.status >= 500) {
    throw new MatcherProviderError(
      "provider_server_error",
      `CompreFace ${action} failed with status ${response.status}.`,
      true,
    );
  }

  throw new MatcherProviderError(
    "compreface_request_failed",
    providerMessage
      ? `CompreFace ${action} failed: ${providerMessage}`
      : `CompreFace ${action} failed with status ${response.status}.`,
    false,
  );
}

async function parseDetectionFaces(
  data: CompreFaceDetectionResponse | null,
  preparedImage: PreparedMaterializationImage,
): Promise<AutoMatcherMaterializedFace[]> {
  if (!data?.result || data.result.length === 0) {
    return [];
  }

  const faces: AutoMatcherMaterializedFace[] = [];
  for (const [index, resultItem] of data.result.entries()) {
    const faceBox = normalizeFaceBox(resultItem.box);
    const embedding = normalizeEmbedding(resultItem.embedding);
    if (!faceBox || !embedding) {
      continue;
    }

    const normalizedFaceBox = toNormalizedFaceBox(
      faceBox,
      preparedImage.processedWidth,
      preparedImage.processedHeight,
    );
    const reviewCrop = normalizedFaceBox
      ? await createReviewCrop(
          preparedImage.orientedSourceBuffer,
          normalizedFaceBox,
          preparedImage.sourceWidth,
          preparedImage.sourceHeight,
        )
      : null;

    faces.push({
      faceRank: index,
      providerFaceIndex: index,
      detectionProbability: faceBox.probability ?? null,
      faceBox,
      normalizedFaceBox,
      reviewCrop,
      embedding,
    });
  }

  return faces;
}

async function detectFacesWithCompreFace(
  preparedImage: PreparedMaterializationImage,
  target: DownloadTarget,
  assetId: string,
): Promise<AutoMatcherMaterializationResult> {
  const config = getCompreFaceConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  logCompreFaceDevelopment("detect_request", {
    assetId,
    target,
    byteSize: preparedImage.byteSize,
  });

  try {
    const detectUrl = new URL(`${config.baseUrl}/api/v1/detection/detect`);
    detectUrl.searchParams.set("face_plugins", "calculator");
    detectUrl.searchParams.set("status", "true");

    const response = await fetch(detectUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.detectionApiKey,
      },
      body: JSON.stringify({
        file: preparedImage.base64,
      }),
      signal: controller.signal,
    });

    const parsedResponse = await parseCompreFaceResponse(response);
    if (!response.ok) {
      if (response.status === 422 || (response.status === 400 && isNoFaceDetectedMessage(parsedResponse.providerMessage))) {
        return {
          faces: [],
          sourceImage: {
            width: preparedImage.sourceWidth,
            height: preparedImage.sourceHeight,
            coordinateSpace: "oriented_original",
          },
          providerMetadata: {
            provider: "compreface",
            providerMode: "detection",
            providerPluginVersions: null,
          },
        };
      }

      throwCompreFaceResponseError(response, parsedResponse.providerMessage, "detect");
    }

    const responseData = (parsedResponse.responseBody as CompreFaceDetectionResponse | null) ?? null;
    return {
      faces: await parseDetectionFaces(responseData, preparedImage),
      sourceImage: {
        width: preparedImage.sourceWidth,
        height: preparedImage.sourceHeight,
        coordinateSpace: "oriented_original",
      },
      providerMetadata: {
        provider: "compreface",
        providerMode: "detection",
        providerPluginVersions: parsePluginVersions(responseData as CompreFaceVerifyResponse | null),
      },
    };
  } catch (error) {
    if (error instanceof MatcherProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new MatcherProviderError(
        "compreface_timeout",
        "CompreFace request timed out.",
        true,
      );
    }

    throw new MatcherProviderError(
      "compreface_network_error",
      "Unable to reach CompreFace service.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseEmbeddingCompareSimilarities(
  data: CompreFaceEmbeddingVerifyResponse | null,
  targetEmbeddings: number[][],
) {
  if (targetEmbeddings.length === 0) {
    return {
      targetSimilarities: [],
      usedFallback: false,
      alignmentIssue: null,
    } as const;
  }

  if (targetEmbeddings.length === 1) {
    return {
      targetSimilarities: [normalizeConfidence(data?.result?.[0]?.similarity)],
      usedFallback: false,
      alignmentIssue: null,
    } as const;
  }

  const requestIndicesByKey = new Map<string, number>();
  targetEmbeddings.forEach((embedding, index) => {
    const key = getEmbeddingKey(embedding);
    if (!key) {
      return;
    }

    if (requestIndicesByKey.has(key)) {
      requestIndicesByKey.set(key, -1);
      return;
    }

    requestIndicesByKey.set(key, index);
  });

  if ([...requestIndicesByKey.values()].some((index) => index < 0)) {
    return {
      targetSimilarities: null,
      usedFallback: true,
      alignmentIssue: "duplicate_request_target" as const,
    } as const;
  }

  const targetSimilarities = new Array<number>(targetEmbeddings.length).fill(0);
  const mappedIndices = new Set<number>();

  for (const row of data?.result ?? []) {
    const key = getEmbeddingKey(row.embedding);
    if (!key) {
      return {
        targetSimilarities: null,
        usedFallback: true,
        alignmentIssue: "missing_response_embedding" as const,
      } as const;
    }

    const requestIndex = requestIndicesByKey.get(key);
    if (typeof requestIndex !== "number") {
      return {
        targetSimilarities: null,
        usedFallback: true,
        alignmentIssue: "unknown_response_embedding" as const,
      } as const;
    }

    if (mappedIndices.has(requestIndex)) {
      return {
        targetSimilarities: null,
        usedFallback: true,
        alignmentIssue: "duplicate_response_embedding" as const,
      } as const;
    }

    mappedIndices.add(requestIndex);
    targetSimilarities[requestIndex] = normalizeConfidence(row.similarity);
  }

  if (mappedIndices.size !== targetEmbeddings.length) {
    return {
      targetSimilarities: null,
      usedFallback: true,
      alignmentIssue: "missing_response_rows" as const,
    } as const;
  }

  return {
    targetSimilarities,
    usedFallback: false,
    alignmentIssue: null,
  } as const;
}

async function requestEmbeddingCompareWithCompreFace(
  sourceEmbedding: number[],
  targetEmbeddings: number[][],
) {
  const config = getCompreFaceConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const verifyUrl = new URL(`${config.baseUrl}/api/v1/verification/embeddings/verify`);
    const response = await fetch(verifyUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.verificationApiKey,
      },
      body: JSON.stringify({
        source: sourceEmbedding,
        targets: targetEmbeddings,
      }),
      signal: controller.signal,
    });

    const parsedResponse = await parseCompreFaceResponse(response);
    if (!response.ok) {
      throwCompreFaceResponseError(response, parsedResponse.providerMessage, "compare_embeddings");
    }

    return (parsedResponse.responseBody as CompreFaceEmbeddingVerifyResponse | null) ?? null;
  } catch (error) {
    if (error instanceof MatcherProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new MatcherProviderError(
        "compreface_timeout",
        "CompreFace request timed out.",
        true,
      );
    }

    throw new MatcherProviderError(
      "compreface_network_error",
      "Unable to reach CompreFace service.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function compareEmbeddingsIndividuallyWithCompreFace(
  input: AutoMatcherEmbeddingCompareInput,
) {
  return Promise.all(
    input.targetEmbeddings.map(async (targetEmbedding) => {
      const responseData = await requestEmbeddingCompareWithCompreFace(input.sourceEmbedding, [targetEmbedding]);
      return normalizeConfidence(responseData?.result?.[0]?.similarity);
    }),
  );
}

async function compareEmbeddingsWithCompreFace(
  input: AutoMatcherEmbeddingCompareInput,
): Promise<AutoMatcherEmbeddingCompareResult> {
  const responseData = await requestEmbeddingCompareWithCompreFace(input.sourceEmbedding, input.targetEmbeddings);
  const parsed = parseEmbeddingCompareSimilarities(responseData, input.targetEmbeddings);

  let targetSimilarities = parsed.targetSimilarities;
  if (!targetSimilarities) {
    logCompreFaceDevelopment("embedding_compare_alignment_fallback", {
      targetCount: input.targetEmbeddings.length,
      alignmentIssue: parsed.alignmentIssue,
    });
    targetSimilarities = await compareEmbeddingsIndividuallyWithCompreFace(input);
  }

  return {
    targetSimilarities,
    providerMetadata: {
      provider: "compreface",
      providerMode: "verification_embeddings",
      providerPluginVersions: null,
    },
  };
}

async function mapWithConcurrency<TInput, TOutput>(
  inputs: TInput[],
  concurrency: number,
  handler: (item: TInput, index: number) => Promise<TOutput>,
) {
  if (inputs.length === 0) {
    return [] as TOutput[];
  }

  const normalizedConcurrency = Math.max(1, Math.min(concurrency, inputs.length));
  const results = new Array<TOutput>(inputs.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= inputs.length) {
        return;
      }

      results[current] = await handler(inputs[current], current);
    }
  }

  await Promise.all(Array.from({ length: normalizedConcurrency }, () => runWorker()));
  return results;
}

async function parseCompreFaceResponse(response: Response) {
  const responseText = await response.text().catch(() => "");
  let responseBody: Record<string, unknown> | null = null;

  if (responseText) {
    try {
      const parsed = JSON.parse(responseText) as unknown;
      if (parsed && typeof parsed === "object") {
        responseBody = parsed as Record<string, unknown>;
      }
    } catch {
      // Ignore non-JSON response payloads.
    }
  }

  const providerMessage =
    typeof responseBody?.message === "string"
      ? responseBody.message
      : null;

  return {
    responseBody,
    providerMessage,
  };
}

async function verifyPairWithCompreFace(
  sourceImage: string,
  targetImage: string,
  context: VerifyContext,
) {
  const config = getCompreFaceConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

  logCompreFaceDevelopment("request", {
    assetId: context.assetId,
    consentId: context.consentId,
    jobType: context.jobType,
    photoByteSize: context.photoByteSize,
    headshotByteSize: context.headshotByteSize,
  });

  try {
    const verifyUrl = new URL(`${config.baseUrl}/api/v1/verification/verify`);
    verifyUrl.searchParams.set("face_plugins", "calculator");
    verifyUrl.searchParams.set("status", "true");

    const response = await fetch(verifyUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": config.verificationApiKey,
      },
      body: JSON.stringify({
        source_image: sourceImage,
        target_image: targetImage,
      }),
      signal: controller.signal,
    });

    const parsedResponse = await parseCompreFaceResponse(response);
      if (!response.ok) {
        if (response.status === 422 || (response.status === 400 && isNoFaceDetectedMessage(parsedResponse.providerMessage))) {
          logCompreFaceDevelopment("response", {
            status: response.status,
            parsedSimilarity: 0,
          providerMessage: parsedResponse.providerMessage,
        });
        return {
          confidence: 0,
          faces: [],
          providerMetadata: {
            provider: "compreface",
            providerMode: "verification",
            providerPluginVersions: null,
          } satisfies AutoMatcherProviderMetadata,
        };
      }

      logCompreFaceDevelopment("response", {
        status: response.status,
        parsedSimilarity: null,
        providerMessage: parsedResponse.providerMessage,
      });

        throwCompreFaceResponseError(response, parsedResponse.providerMessage, "verify");
      }

    const responseData = (parsedResponse.responseBody as CompreFaceVerifyResponse | null) ?? null;
    const similarity = parseSimilarity(responseData);
    const faces = parseFaceEvidence(responseData);
    const providerPluginVersions = parsePluginVersions(responseData);
    logCompreFaceDevelopment("response", {
      status: response.status,
      parsedSimilarity: similarity,
      providerMessage: parsedResponse.providerMessage,
    });
    return {
      confidence: similarity,
      faces,
      providerMetadata: {
        provider: "compreface",
        providerMode: "verification",
        providerPluginVersions,
      } satisfies AutoMatcherProviderMetadata,
    };
  } catch (error) {
    if (error instanceof MatcherProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === "AbortError") {
      throw new MatcherProviderError(
        "compreface_timeout",
        "CompreFace request timed out.",
        true,
      );
    }

    throw new MatcherProviderError(
      "compreface_network_error",
      "Unable to reach CompreFace service.",
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function createCompreFaceAutoMatcher(): AutoMatcher {
  return {
    version: "compreface-v1",
    async materializeAssetFaces(input) {
      const supabase = getStorageClient(input.supabase);
      const sourceBuffer = await downloadStorageRefBuffer(supabase, input.storage);
      if (!sourceBuffer) {
        return {
          faces: [],
          sourceImage: null,
          providerMetadata: {
            provider: "compreface",
            providerMode: "detection",
            providerPluginVersions: null,
          },
        };
      }

      const preparedImage = await prepareImageForCompreFaceMaterialization(sourceBuffer, input.assetType);
      return detectFacesWithCompreFace(preparedImage, input.assetType, input.assetId);
    },
    async compareEmbeddings(input) {
      return compareEmbeddingsWithCompreFace(input);
    },
    async match(input) {
      const startedAt = performance.now();
      const supabase = getStorageClient(input.supabase);
      const cache: DownloadCache = new Map();
      const inFlightDownloads: DownloadInFlight = new Map();
      const concurrency = getAutoMatchProviderConcurrency();
      const verifyDurationsMs: number[] = [];

      const matches = await mapWithConcurrency(input.candidates, concurrency, async (candidate) => {
        const sourceImage = await downloadAsBase64(supabase, candidate, "headshot", cache, inFlightDownloads);
        const targetImage = await downloadAsBase64(supabase, candidate, "photo", cache, inFlightDownloads);
        if (!sourceImage || !targetImage) {
          return {
            assetId: candidate.assetId,
            consentId: candidate.consentId,
            confidence: 0,
          } satisfies AutoMatcherMatch;
        }

        const verifyStartedAt = performance.now();
        const result = await verifyPairWithCompreFace(sourceImage.base64, targetImage.base64, {
          assetId: candidate.assetId,
          consentId: candidate.consentId,
          jobType: input.jobType,
          photoByteSize: targetImage.byteSize,
          headshotByteSize: sourceImage.byteSize,
        });
        verifyDurationsMs.push(performance.now() - verifyStartedAt);
        return {
          assetId: candidate.assetId,
          consentId: candidate.consentId,
          confidence: result.confidence,
          faces: result.faces,
          providerMetadata: result.providerMetadata,
        } satisfies AutoMatcherMatch;
      });

      const durationMs = performance.now() - startedAt;
      const providerCalls = verifyDurationsMs.length;
      const totalVerifyMs = verifyDurationsMs.reduce((sum, value) => sum + value, 0);
      const avgVerifyMs = providerCalls > 0 ? totalVerifyMs / providerCalls : 0;
      const p95VerifyMs = percentile(verifyDurationsMs, 0.95);
      const pairsPerSecond = durationMs > 0 ? (input.candidates.length * 1000) / durationMs : 0;
      logCompreFaceDevelopment("batch_metrics", {
        candidateCount: input.candidates.length,
        providerCalls,
        concurrency,
        durationMs: Math.round(durationMs),
        verifyAvgMs: Math.round(avgVerifyMs),
        verifyP95Ms: Math.round(p95VerifyMs),
        pairsPerSecond: Number(pairsPerSecond.toFixed(2)),
      });

      return matches;
    },
  };
}
