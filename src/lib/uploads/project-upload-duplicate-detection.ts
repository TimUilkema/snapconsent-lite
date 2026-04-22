import type { ProjectAssetUploadType } from "@/lib/assets/asset-upload-policy";

export function shouldCheckProjectUploadDuplicates(assetType: ProjectAssetUploadType) {
  return assetType === "photo";
}

export async function hashProjectUploadFile(
  file: Pick<File, "arrayBuffer">,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
) {
  if (!subtle) {
    return null;
  }

  try {
    const buffer = await file.arrayBuffer();
    const digest = await subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return null;
  }
}

export function collectDuplicateContentHashes(
  items: Array<{ contentHash: string | null | undefined }>,
) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  items.forEach((item) => {
    const contentHash = typeof item.contentHash === "string" ? item.contentHash.trim().toLowerCase() : "";
    if (!contentHash) {
      return;
    }
    if (seen.has(contentHash)) {
      duplicates.add(contentHash);
      return;
    }
    seen.add(contentHash);
  });

  return duplicates;
}
