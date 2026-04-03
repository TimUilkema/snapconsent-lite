import { createAssetWithIdempotency } from "@/lib/assets/create-asset";
import { normalizeSubjectRelation } from "@/lib/assets/normalize-subject-relation";
import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { HttpError, jsonError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type CreateAssetBody = {
  originalFilename?: string;
  contentType?: string;
  fileSizeBytes?: number;
  consentIds?: string[];
  contentHash?: string;
  contentHashAlgo?: string;
  assetType?: string;
  duplicatePolicy?: string;
};

type AssetListSort =
  | "created_at_desc"
  | "created_at_asc"
  | "file_size_desc"
  | "file_size_asc";

type DuplicatePolicy = "upload_anyway" | "overwrite" | "ignore";

type AssetRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

type AssetConsentLinkRow = {
  asset_id: string;
  consent_id: string;
  consents:
    | {
        id: string;
        subjects:
          | {
              email: string;
              full_name: string;
            }
          | {
              email: string;
              full_name: string;
            }[]
          | null;
      }
    | {
        id: string;
        subjects:
          | {
              email: string;
              full_name: string;
            }
          | {
              email: string;
              full_name: string;
            }[]
          | null;
      }[]
    | null;
};

type ConsentFilterOptionRow = {
  id: string;
  subjects: Array<{
    email: string;
    full_name: string;
  }> | null;
};

type ConsentFilterOption = {
  id: string;
  subjects: {
    email: string;
    full_name: string;
  } | null;
};

function parseLimit(searchParams: URLSearchParams) {
  const raw = searchParams.get("limit");
  if (!raw) {
    return 24;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 24;
  }

  return Math.min(100, Math.floor(parsed));
}

function parseOffset(searchParams: URLSearchParams) {
  const raw = searchParams.get("offset");
  if (!raw) {
    return 0;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }

  return Math.floor(parsed);
}

function parseSort(searchParams: URLSearchParams): AssetListSort {
  const raw = searchParams.get("sort");
  switch (raw) {
    case "created_at_asc":
    case "file_size_desc":
    case "file_size_asc":
      return raw;
    case "created_at_desc":
    default:
      return "created_at_desc";
  }
}

function parseSearchQuery(searchParams: URLSearchParams) {
  const value = String(searchParams.get("q") ?? "").trim();
  return value.length > 0 ? value : null;
}

function parseConsentFilterIds(searchParams: URLSearchParams) {
  return Array.from(
    new Set(
      searchParams
        .getAll("consentId")
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

function parseDuplicatePolicy(value: unknown): DuplicatePolicy {
  if (typeof value !== "string") {
    return "upload_anyway";
  }

  const normalized = value.trim();
  if (normalized === "overwrite" || normalized === "ignore") {
    return normalized;
  }

  return "upload_anyway";
}

async function requireAuthAndScope(context: RouteContext) {
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
  return { supabase, tenantId, projectId, userId: user.id };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId } = await requireAuthAndScope(context);
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams);
    const offset = parseOffset(url.searchParams);
    const sort = parseSort(url.searchParams);
    const queryText = parseSearchQuery(url.searchParams);
    const selectedConsentIds = parseConsentFilterIds(url.searchParams);

    const { data: consentFilterRows, error: consentFilterError } = await supabase
      .from("consents")
      .select("id, subjects(email, full_name)")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: false });

    if (consentFilterError) {
      throw new HttpError(500, "consent_filter_lookup_failed", "Unable to load consent filters.");
    }

    const people = ((consentFilterRows as ConsentFilterOptionRow[] | null) ?? []).map((consent) => {
      const normalizedConsent: ConsentFilterOption = {
        id: consent.id,
        subjects: normalizeSubjectRelation(consent.subjects),
      };
      const fullName = normalizedConsent.subjects?.full_name?.trim() ?? null;
      const email = normalizedConsent.subjects?.email?.trim() ?? null;
      const label = fullName || email || "Unknown subject";
      return {
        consentId: normalizedConsent.id,
        fullName,
        email,
        label,
      };
    });

    let filteredAssetIds: string[] | null = null;
    if (selectedConsentIds.length > 0) {
      const { data: filteredLinks, error: filteredLinksError } = await supabase
        .from("asset_consent_links")
        .select("asset_id, consent_id")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .in("consent_id", selectedConsentIds);

      if (filteredLinksError) {
        throw new HttpError(500, "asset_filter_lookup_failed", "Unable to filter assets by selected people.");
      }

      const consentMatchMap = new Map<string, Set<string>>();
      (filteredLinks ?? []).forEach((link) => {
        const current = consentMatchMap.get(link.asset_id) ?? new Set<string>();
        current.add(link.consent_id);
        consentMatchMap.set(link.asset_id, current);
      });

      filteredAssetIds = Array.from(consentMatchMap.entries())
        .filter(([, consentSet]) => consentSet.size === selectedConsentIds.length)
        .map(([assetId]) => assetId);

      if (filteredAssetIds.length === 0) {
        return Response.json(
          {
            assets: [],
            totalCount: 0,
            people,
          },
          { status: 200 },
        );
      }
    }

    let query = supabase
      .from("assets")
      .select(
        "id, original_filename, status, file_size_bytes, created_at, uploaded_at, storage_bucket, storage_path",
        { count: "exact" },
      )
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .eq("asset_type", "photo")
      .eq("status", "uploaded");

    if (queryText) {
      query = query.ilike("original_filename", `%${queryText}%`);
    }

    if (filteredAssetIds) {
      query = query.in("id", filteredAssetIds);
    }

    switch (sort) {
      case "created_at_asc":
        query = query.order("created_at", { ascending: true });
        break;
      case "file_size_desc":
        query = query.order("file_size_bytes", { ascending: false }).order("created_at", { ascending: false });
        break;
      case "file_size_asc":
        query = query.order("file_size_bytes", { ascending: true }).order("created_at", { ascending: false });
        break;
      case "created_at_desc":
      default:
        query = query.order("created_at", { ascending: false });
        break;
    }

    query = query.range(offset, offset + limit - 1);

    const { data: assets, error: assetsError, count } = await query;
    if (assetsError) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load assets.");
    }

    const assetRows = (assets as AssetRow[] | null) ?? [];
    const assetIds = assetRows.map((asset) => asset.id);

    const requestHostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const thumbnailMap = await signThumbnailUrlsForAssets(supabase, assetRows);
    const previewMap = await signThumbnailUrlsForAssets(supabase, assetRows, {
      width: 1280,
      quality: 85,
      resize: "contain",
    });

    const assetLinkCountMap = new Map<string, number>();
    const assetLinkedPeopleMap = new Map<
      string,
      Array<{ consentId: string; fullName: string | null; email: string | null }>
    >();

    if (assetIds.length > 0) {
      const { data: links, error: linksError } = await supabase
        .from("asset_consent_links")
        .select("asset_id, consent_id, consents(id, subjects(email, full_name))")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .in("asset_id", assetIds);

      if (linksError) {
        throw new HttpError(500, "asset_link_lookup_failed", "Unable to load linked consent details.");
      }

      ((links as AssetConsentLinkRow[] | null) ?? []).forEach((link) => {
        const currentCount = assetLinkCountMap.get(link.asset_id) ?? 0;
        assetLinkCountMap.set(link.asset_id, currentCount + 1);

        const consentRow = Array.isArray(link.consents) ? link.consents[0] : link.consents;
        if (!consentRow) {
          return;
        }
        const subjectRow = Array.isArray(consentRow.subjects) ? (consentRow.subjects[0] ?? null) : consentRow.subjects;

        const existingPeople = assetLinkedPeopleMap.get(link.asset_id) ?? [];
        if (existingPeople.some((person) => person.consentId === consentRow.id)) {
          return;
        }

        existingPeople.push({
          consentId: consentRow.id,
          fullName: subjectRow?.full_name ?? null,
          email: subjectRow?.email ?? null,
        });
        assetLinkedPeopleMap.set(link.asset_id, existingPeople);
      });
    }

    return Response.json(
      {
        assets: assetRows.map((asset) => {
          const thumbnailUrl = thumbnailMap.get(asset.id) ?? null;
          const previewUrl = previewMap.get(asset.id) ?? null;
          return {
            id: asset.id,
            originalFilename: asset.original_filename,
            status: asset.status,
            fileSizeBytes: asset.file_size_bytes,
            createdAt: asset.created_at,
            uploadedAt: asset.uploaded_at,
            thumbnailUrl: thumbnailUrl
              ? resolveLoopbackStorageUrlForHostHeader(thumbnailUrl, requestHostHeader)
              : null,
            previewUrl: previewUrl
              ? resolveLoopbackStorageUrlForHostHeader(previewUrl, requestHostHeader)
              : null,
            linkedConsentCount: assetLinkCountMap.get(asset.id) ?? 0,
            linkedPeople: assetLinkedPeopleMap.get(asset.id) ?? [],
          };
        }),
        totalCount: count ?? 0,
        people,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, userId } = await requireAuthAndScope(context);
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
    }

    const body = (await request.json().catch(() => null)) as CreateAssetBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const consentIds = Array.isArray(body.consentIds)
      ? Array.from(
          new Set(
            body.consentIds
              .filter((id) => typeof id === "string")
              .map((id) => id.trim())
              .filter((id) => id.length > 0),
          ),
        )
      : [];

    const result = await createAssetWithIdempotency({
      supabase,
      tenantId,
      projectId,
      userId,
      idempotencyKey,
      originalFilename: String(body.originalFilename ?? "").trim(),
      contentType: String(body.contentType ?? "").trim(),
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      consentIds,
      contentHash: typeof body.contentHash === "string" ? body.contentHash.trim() : null,
      contentHashAlgo: typeof body.contentHashAlgo === "string" ? body.contentHashAlgo.trim() : null,
      assetType: typeof body.assetType === "string" ? body.assetType.trim() : "photo",
      duplicatePolicy: parseDuplicatePolicy(body.duplicatePolicy),
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
