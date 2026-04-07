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

const ACCEPTED_IMAGE_SPECIFIERS = [
  ...ACCEPTED_IMAGE_CONTENT_TYPES,
  ...ACCEPTED_IMAGE_EXTENSIONS,
] as const;

function normalizeExtension(filename: string) {
  const lastDotIndex = filename.lastIndexOf(".");
  if (lastDotIndex < 0) {
    return "";
  }

  return filename.slice(lastDotIndex).trim().toLowerCase();
}

export function getAcceptedImageContentTypes() {
  return [...ACCEPTED_IMAGE_CONTENT_TYPES];
}

export function getAcceptedImageUploadAcceptValue() {
  return ACCEPTED_IMAGE_SPECIFIERS.join(",");
}

export function isAcceptedImageUpload(
  contentType: string | null | undefined,
  originalFilename: string | null | undefined,
) {
  const normalizedContentType = String(contentType ?? "")
    .trim()
    .toLowerCase();
  if (ACCEPTED_IMAGE_CONTENT_TYPES.includes(normalizedContentType as (typeof ACCEPTED_IMAGE_CONTENT_TYPES)[number])) {
    return true;
  }

  const normalizedExtension = normalizeExtension(String(originalFilename ?? ""));
  return ACCEPTED_IMAGE_EXTENSIONS.includes(
    normalizedExtension as (typeof ACCEPTED_IMAGE_EXTENSIONS)[number],
  );
}
