import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  assetNeedsCurrentImageDerivative,
  getAssetDisplayFallbackState,
  getAssetImageDerivativeSpec,
  getAssetImageDerivativeRowForUse,
  loadAssetImageDerivativesForAssetIds,
  queueAssetImageDerivativesForAssetIds,
  type AssetImageDerivativeRow,
  type AssetUrlSignableAsset,
  type AssetDisplayUrlState,
  type AssetUrlUse,
} from "@/lib/assets/asset-image-derivatives";

const SIGNED_URL_TTL_SECONDS = 120;
const DEFAULT_THUMBNAIL_WIDTH = 320;
const DEFAULT_THUMBNAIL_HEIGHT = 320;
const DEFAULT_THUMBNAIL_QUALITY = 70;

type ThumbnailSizeOptions = {
  width?: number;
  height?: number;
  quality?: number;
  resize?: "cover" | "contain";
};

type SignAssetUrlOptions = ThumbnailSizeOptions & {
  tenantId?: string | null;
  projectId?: string | null;
  use?: AssetUrlUse;
  fallback?: "transform" | "original" | "none";
  enqueueMissingDerivative?: boolean;
};

export type SignedAssetDisplayUrl = {
  url: string | null;
  state: AssetDisplayUrlState;
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

function getTransformOptionsForUse(options: SignAssetUrlOptions | undefined) {
  const use = options?.use;
  if (!use) {
    return getThumbnailTransform(options);
  }

  const derivativeSpec = getAssetImageDerivativeSpec(use);
  return {
    width: Number.isFinite(options?.width) ? options?.width : derivativeSpec.width,
    height: Number.isFinite(options?.height) ? options?.height : derivativeSpec.height,
    resize: options?.resize ?? ("contain" as const),
    quality: options?.quality ?? derivativeSpec.quality,
  };
}

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

async function signOriginalAssetUrl(
  admin: ReturnType<typeof createStorageSigningClient>,
  asset: AssetUrlSignableAsset,
) {
  if (asset.status !== "uploaded" || !asset.storage_bucket || !asset.storage_path) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

async function signTransformedAssetUrl(
  admin: ReturnType<typeof createStorageSigningClient>,
  asset: AssetUrlSignableAsset,
  options?: SignAssetUrlOptions,
) {
  if (asset.status !== "uploaded" || !asset.storage_bucket || !asset.storage_path) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(asset.storage_bucket)
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS, {
      transform: getTransformOptionsForUse(options),
    });

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

async function signDerivativeUrl(
  admin: ReturnType<typeof createStorageSigningClient>,
  derivative: {
    storage_bucket: string;
    storage_path: string;
  } | null | undefined,
) {
  if (!derivative?.storage_bucket || !derivative.storage_path) {
    return null;
  }

  const { data, error } = await admin.storage
    .from(derivative.storage_bucket)
    .createSignedUrl(derivative.storage_path, SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}

async function maybeEnqueueMissingDerivatives(input: {
  admin: ReturnType<typeof createStorageSigningClient>;
  assets: AssetUrlSignableAsset[];
  tenantId?: string | null;
  projectId?: string | null;
  enqueueMissingDerivative?: boolean;
}) {
  if (!input.enqueueMissingDerivative || !input.tenantId || !input.projectId || input.assets.length === 0) {
    return;
  }

  try {
    const derivatives = await loadAssetImageDerivativesForAssetIds(
      input.admin as unknown as SupabaseClient,
      String(input.tenantId),
      String(input.projectId),
      input.assets.map((asset) => asset.id),
    );
    const assetIdsNeedingRepair = input.assets
      .filter((asset) => assetNeedsCurrentImageDerivative(derivatives, asset.id))
      .map((asset) => asset.id);

    if (assetIdsNeedingRepair.length === 0) {
      return;
    }

    await queueAssetImageDerivativesForAssetIds({
      supabase: input.admin as unknown as SupabaseClient,
      tenantId: String(input.tenantId),
      projectId: String(input.projectId),
      assetIds: assetIdsNeedingRepair,
    });
  } catch (error) {
    console.warn("[assets][display] derivative_repair_enqueue_failed", {
      tenantId: input.tenantId ?? null,
      projectId: input.projectId ?? null,
      assetCount: input.assets.length,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

async function loadDerivativeMapForAssets(
  admin: ReturnType<typeof createStorageSigningClient>,
  assets: AssetUrlSignableAsset[],
  options?: SignAssetUrlOptions,
) {
  if (!options?.tenantId || !options?.projectId || assets.length === 0) {
    return null;
  }

  return loadAssetImageDerivativesForAssetIds(
    admin as unknown as SupabaseClient,
    String(options.tenantId),
    String(options.projectId),
    assets.map((asset) => asset.id),
  );
}

async function resolveSignedAssetUrl(
  admin: ReturnType<typeof createStorageSigningClient>,
  asset: AssetUrlSignableAsset,
  derivativeMap: Map<string, AssetImageDerivativeRow> | null,
  options?: SignAssetUrlOptions,
): Promise<SignedAssetDisplayUrl> {
  if (asset.status !== "uploaded" || !asset.storage_bucket || !asset.storage_path) {
    return {
      url: null,
      state: "unavailable",
    };
  }

  const fallback = options?.fallback ?? "transform";
  const use = options?.use ?? "thumbnail";
  const derivative = derivativeMap ? getAssetImageDerivativeRowForUse(derivativeMap, asset.id, use) : null;
  if (derivative?.status === "ready") {
    const signedDerivative = await signDerivativeUrl(admin, derivative);
    if (signedDerivative) {
      return {
        url: signedDerivative,
        state: "ready_derivative",
      };
    }
  }

  if (fallback === "original") {
    const originalUrl = await signOriginalAssetUrl(admin, asset);
    return {
      url: originalUrl,
      state: originalUrl ? "transform_fallback" : getAssetDisplayFallbackState(derivative),
    };
  }

  if (fallback === "none") {
    return {
      url: null,
      state: getAssetDisplayFallbackState(derivative),
    };
  }

  const transformedUrl = await signTransformedAssetUrl(admin, asset, options);
  if (transformedUrl) {
    return {
      url: transformedUrl,
      state: "transform_fallback",
    };
  }

  return {
    url: null,
    state: getAssetDisplayFallbackState(derivative),
  };
}

export async function resolveSignedAssetDisplayUrl(
  _supabase: unknown,
  asset: AssetUrlSignableAsset,
  options?: SignAssetUrlOptions,
) {
  if (asset.status !== "uploaded" || !asset.storage_bucket || !asset.storage_path) {
    return {
      url: null,
      state: "unavailable",
    } satisfies SignedAssetDisplayUrl;
  }

  try {
    const admin = createStorageSigningClient();
    await maybeEnqueueMissingDerivatives({
      admin,
      assets: [asset],
      tenantId: options?.tenantId,
      projectId: options?.projectId,
      enqueueMissingDerivative: options?.enqueueMissingDerivative,
    });
    const derivativeMap = await loadDerivativeMapForAssets(admin, [asset], options);
    return await resolveSignedAssetUrl(admin, asset, derivativeMap, options);
  } catch {
    return {
      url: null,
      state: "unavailable",
    } satisfies SignedAssetDisplayUrl;
  }
}

export async function resolveSignedAssetDisplayUrlsForAssets(
  _supabase: unknown,
  assets: AssetUrlSignableAsset[],
  options?: SignAssetUrlOptions,
) {
  try {
    const admin = createStorageSigningClient();
    await maybeEnqueueMissingDerivatives({
      admin,
      assets,
      tenantId: options?.tenantId,
      projectId: options?.projectId,
      enqueueMissingDerivative: options?.enqueueMissingDerivative,
    });
    const derivativeMap = await loadDerivativeMapForAssets(admin, assets, options);
    const urlEntries = await Promise.all(
      assets.map(async (asset) => [asset.id, await resolveSignedAssetUrl(admin, asset, derivativeMap, options)] as const),
    );

    return new Map<string, SignedAssetDisplayUrl>(urlEntries);
  } catch {
    const fallbackEntries = assets.map(
      (asset) =>
        [
          asset.id,
          {
            url: null,
            state: "unavailable",
          } satisfies SignedAssetDisplayUrl,
        ] as const,
    );
    return new Map<string, SignedAssetDisplayUrl>(fallbackEntries);
  }
}

export async function signThumbnailUrl(
  _supabase: unknown,
  asset: AssetUrlSignableAsset,
  options?: SignAssetUrlOptions,
) {
  const resolved = await resolveSignedAssetDisplayUrl(_supabase, asset, options);
  return resolved.url;
}

export async function signThumbnailUrlsForAssets(
  _supabase: unknown,
  assets: AssetUrlSignableAsset[],
  options?: SignAssetUrlOptions,
) {
  const resolved = await resolveSignedAssetDisplayUrlsForAssets(_supabase, assets, options);
  return new Map<string, string | null>(
    Array.from(resolved.entries()).map(([assetId, value]) => [assetId, value.url] as const),
  );
}
