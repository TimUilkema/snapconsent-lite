import { HttpError, jsonError } from "@/lib/http/errors";
import { SAFE_IN_FILTER_CHUNK_SIZE, chunkValues } from "@/lib/supabase/safe-in-filter";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PreflightFile = {
  name?: string;
  size?: number;
  contentType?: string;
  contentHash?: string;
};

type PreflightBody = {
  assetType?: string;
  files?: PreflightFile[];
};

const MAX_PREFLIGHT_FILES = 2000;

function normalizeAssetType(value: unknown): "photo" | "headshot" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "photo") {
    return "photo";
  }

  if (normalized === "headshot") {
    return "headshot";
  }

  throw new HttpError(400, "invalid_asset_type", "Invalid asset type.");
}

function normalizeSize(value: unknown): number | null {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }
  return Math.floor(size);
}

function normalizeContentHash(value: unknown): string | null {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId } = await context.params;
    const body = (await request.json().catch(() => null)) as PreflightBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const assetType = normalizeAssetType(body.assetType);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      throw new HttpError(400, "invalid_files", "At least one file is required.");
    }
    if (files.length > MAX_PREFLIGHT_FILES) {
      throw new HttpError(400, "files_too_large", "Too many files were provided.");
    }
    const sizes = files
      .map((file) => normalizeSize(file.size))
      .filter((size): size is number => size !== null);
    const uniqueSizes = Array.from(new Set(sizes));

    let candidateSizes: number[] = [];
    if (uniqueSizes.length > 0) {
      const foundSizes = new Set<number>();
      const sizeChunks = chunkValues(uniqueSizes, SAFE_IN_FILTER_CHUNK_SIZE);
      for (const sizeChunk of sizeChunks) {
        // safe-in-filter: preflight size lookup is request-bounded and chunked by shared helper.
        const { data, error } = await supabase
          .from("assets")
          .select("file_size_bytes")
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .eq("asset_type", assetType)
          .in("file_size_bytes", sizeChunk);

        if (error) {
          throw new HttpError(500, "asset_size_lookup_failed", "Unable to preflight assets.");
        }

        (data ?? [])
          .map((row) => Number(row.file_size_bytes))
          .filter((size) => Number.isFinite(size) && size > 0)
          .forEach((size) => foundSizes.add(size));
      }

      candidateSizes = Array.from(foundSizes);
    }

    const hashes = files
      .map((file) => normalizeContentHash(file.contentHash))
      .filter((hash): hash is string => hash !== null);
    const uniqueHashes = Array.from(new Set(hashes));

    let duplicateHashes: string[] = [];
    if (uniqueHashes.length > 0) {
      const foundHashes = new Set<string>();
      const hashChunks = chunkValues(uniqueHashes, SAFE_IN_FILTER_CHUNK_SIZE);
      for (const hashChunk of hashChunks) {
        // safe-in-filter: preflight hash lookup is request-bounded and chunked by shared helper.
        const { data, error } = await supabase
          .from("assets")
          .select("content_hash")
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .eq("asset_type", assetType)
          .in("content_hash", hashChunk);

        if (error) {
          throw new HttpError(500, "asset_hash_lookup_failed", "Unable to preflight assets.");
        }

        (data ?? [])
          .map((row) => normalizeContentHash(row.content_hash))
          .filter((hash): hash is string => hash !== null)
          .forEach((hash) => foundHashes.add(hash));
      }

      duplicateHashes = Array.from(foundHashes);
    }

    return Response.json({ candidateSizes, duplicateHashes }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
