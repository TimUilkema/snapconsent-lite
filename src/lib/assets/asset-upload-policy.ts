export type AssetUploadType = "photo" | "headshot" | "video";
export type ProjectAssetUploadType = "photo" | "video";

export const IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
export const VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

const ACCEPTED_IMAGE_CONTENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/tiff",
] as const;

const ACCEPTED_IMAGE_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".avif",
  ".gif",
  ".bmp",
  ".tif",
  ".tiff",
] as const;

const ACCEPTED_VIDEO_CONTENT_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

const ACCEPTED_VIDEO_EXTENSIONS = [
  ".mp4",
  ".mov",
  ".webm",
] as const;

type AcceptedContentType = (typeof ACCEPTED_IMAGE_CONTENT_TYPES)[number] | (typeof ACCEPTED_VIDEO_CONTENT_TYPES)[number];
type AcceptedExtension = (typeof ACCEPTED_IMAGE_EXTENSIONS)[number] | (typeof ACCEPTED_VIDEO_EXTENSIONS)[number];

type AssetUploadPolicy = {
  contentTypes: readonly AcceptedContentType[];
  extensions: readonly AcceptedExtension[];
  maxFileSizeBytes: number;
};

const IMAGE_UPLOAD_POLICY: AssetUploadPolicy = {
  contentTypes: ACCEPTED_IMAGE_CONTENT_TYPES,
  extensions: ACCEPTED_IMAGE_EXTENSIONS,
  maxFileSizeBytes: IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES,
};

const VIDEO_UPLOAD_POLICY: AssetUploadPolicy = {
  contentTypes: ACCEPTED_VIDEO_CONTENT_TYPES,
  extensions: ACCEPTED_VIDEO_EXTENSIONS,
  maxFileSizeBytes: VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES,
};

function normalizeContentType(contentType: string | null | undefined) {
  return String(contentType ?? "").trim().toLowerCase();
}

function normalizeExtension(filename: string | null | undefined) {
  const normalizedFilename = String(filename ?? "").trim();
  const lastDotIndex = normalizedFilename.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }

  return normalizedFilename.slice(lastDotIndex).trim().toLowerCase();
}

function getAssetUploadPolicy(assetType: AssetUploadType): AssetUploadPolicy {
  return assetType === "video" ? VIDEO_UPLOAD_POLICY : IMAGE_UPLOAD_POLICY;
}

function matchesAcceptedContentType(
  policy: AssetUploadPolicy,
  contentType: string | null | undefined,
) {
  const normalized = normalizeContentType(contentType);
  return policy.contentTypes.includes(normalized as AcceptedContentType);
}

function matchesAcceptedExtension(
  policy: AssetUploadPolicy,
  filename: string | null | undefined,
) {
  const normalized = normalizeExtension(filename);
  return policy.extensions.includes(normalized as AcceptedExtension);
}

export function getAcceptedImageContentTypes() {
  return [...ACCEPTED_IMAGE_CONTENT_TYPES];
}

export function getAcceptedVideoContentTypes() {
  return [...ACCEPTED_VIDEO_CONTENT_TYPES];
}

export function getAcceptedImageUploadAcceptValue() {
  return [...ACCEPTED_IMAGE_CONTENT_TYPES, ...ACCEPTED_IMAGE_EXTENSIONS].join(",");
}

export function getAcceptedProjectAssetUploadAcceptValue() {
  return [
    ...ACCEPTED_IMAGE_CONTENT_TYPES,
    ...ACCEPTED_IMAGE_EXTENSIONS,
    ...ACCEPTED_VIDEO_CONTENT_TYPES,
    ...ACCEPTED_VIDEO_EXTENSIONS,
  ].join(",");
}

export function isAcceptedImageUpload(
  contentType: string | null | undefined,
  originalFilename: string | null | undefined,
) {
  return isAcceptedAssetUpload("photo", contentType, originalFilename);
}

export function isAcceptedAssetUpload(
  assetType: AssetUploadType,
  contentType: string | null | undefined,
  originalFilename: string | null | undefined,
) {
  const policy = getAssetUploadPolicy(assetType);
  const hasAcceptedExtension = matchesAcceptedExtension(policy, originalFilename);
  const normalizedContentType = normalizeContentType(contentType);

  if (assetType !== "video") {
    return matchesAcceptedContentType(policy, normalizedContentType) || hasAcceptedExtension;
  }

  if (!normalizedContentType) {
    return hasAcceptedExtension;
  }

  return matchesAcceptedContentType(policy, normalizedContentType) && hasAcceptedExtension;
}

export function getAssetUploadMaxFileSizeBytes(assetType: AssetUploadType) {
  return getAssetUploadPolicy(assetType).maxFileSizeBytes;
}

export function resolveProjectAssetUploadType(
  contentType: string | null | undefined,
  originalFilename: string | null | undefined,
): ProjectAssetUploadType | null {
  if (isAcceptedAssetUpload("video", contentType, originalFilename)) {
    return "video";
  }

  if (isAcceptedAssetUpload("photo", contentType, originalFilename)) {
    return "photo";
  }

  return null;
}
