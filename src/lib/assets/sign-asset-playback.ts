import { createClient } from "@supabase/supabase-js";

import type { AssetUrlSignableAsset } from "@/lib/assets/asset-image-derivatives";

export const VIDEO_PLAYBACK_SIGNED_URL_TTL_SECONDS = 900;

type SignAssetPlaybackUrlOptions = {
  ttlSeconds?: number;
};

function createStorageSigningClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function signAssetPlaybackUrl(
  admin: ReturnType<typeof createStorageSigningClient>,
  asset: AssetUrlSignableAsset,
  options?: SignAssetPlaybackUrlOptions,
) {
  if (asset.status !== "uploaded" || !asset.storage_bucket || !asset.storage_path) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, options?.ttlSeconds ?? VIDEO_PLAYBACK_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

export async function signVideoPlaybackUrlsForAssets(
  assets: AssetUrlSignableAsset[],
  options?: SignAssetPlaybackUrlOptions,
) {
  if (assets.length === 0) {
    return new Map<string, string | null>();
  }

  const admin = createStorageSigningClient();
  const entries = await Promise.all(
    assets.map(async (asset) => [asset.id, await signAssetPlaybackUrl(admin, asset, options)] as const),
  );
  return new Map<string, string | null>(entries);
}
