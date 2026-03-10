import { createAdminClient } from "@/lib/supabase/admin";

const THUMBNAIL_SIGNED_URL_TTL_SECONDS = 120;
const DEFAULT_THUMBNAIL_WIDTH = 320;
const DEFAULT_THUMBNAIL_HEIGHT = 320;
const DEFAULT_THUMBNAIL_QUALITY = 70;

type ThumbnailSignableAsset = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type ThumbnailSizeOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain";
};

function getThumbnailTransform(options: ThumbnailSizeOptions | undefined) {
  const hasWidth = Number.isFinite(options?.width);
  const hasHeight = Number.isFinite(options?.height);

  return {
    width: hasWidth
      ? options?.width
      : hasHeight
        ? undefined
        : DEFAULT_THUMBNAIL_WIDTH,
    height: hasHeight
      ? options?.height
      : hasWidth
        ? undefined
        : DEFAULT_THUMBNAIL_HEIGHT,
    resize: options?.resize ?? ("cover" as const),
    quality: options?.quality ?? DEFAULT_THUMBNAIL_QUALITY,
  };
}

export async function signThumbnailUrl(
  _supabase: unknown,
  asset: ThumbnailSignableAsset,
  options?: ThumbnailSizeOptions,
) {
  if (asset.status !== "uploaded") {
    return null;
  }

  if (!asset.storage_bucket || !asset.storage_path) {
    return null;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.storage
      .from(asset.storage_bucket)
      .createSignedUrl(asset.storage_path, THUMBNAIL_SIGNED_URL_TTL_SECONDS, {
        transform: getThumbnailTransform(options),
      });

    if (error || !data?.signedUrl) {
      return null;
    }

    return data.signedUrl;
  } catch {
    return null;
  }
}

export async function signThumbnailUrlsForAssets(
  supabase: unknown,
  assets: ThumbnailSignableAsset[],
  options?: ThumbnailSizeOptions,
) {
  const urlEntries = await Promise.all(
    assets.map(async (asset) => {
      const signedUrl = await signThumbnailUrl(supabase, asset, options);
      return [asset.id, signedUrl] as const;
    }),
  );

  return new Map<string, string | null>(urlEntries);
}
