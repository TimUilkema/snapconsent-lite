import { createAssetWithIdempotency } from "@/lib/assets/create-asset";
import { normalizeSubjectRelation } from "@/lib/assets/normalize-subject-relation";
import {
  loadProjectConsentScopeFilterFamilies,
  resolveProjectAssetIdsByConsentScopeFilter,
  type ProjectConsentScopeFilterStatus,
} from "@/lib/consent/project-consent-scope-filter";
import {
  resolveSignedAssetDisplayUrlsForAssets,
  signThumbnailUrlsForAssets,
} from "@/lib/assets/sign-asset-thumbnails";
import { signVideoPlaybackUrlsForAssets } from "@/lib/assets/sign-asset-playback";
import { HttpError, jsonError } from "@/lib/http/errors";
import {
  buildPendingAssetReviewSummary,
  getAssetReviewSummaries,
} from "@/lib/matching/asset-preview-linking";
import {
  listLinkedFaceOverlaysForAssetIds,
  listPhotoConsentAssignmentsForAssetIds,
} from "@/lib/matching/consent-photo-matching";
import { loadCurrentProjectConsentHeadshots } from "@/lib/matching/face-materialization";
import {
  buildProjectAssetReviewSummary,
  filterProjectAssetsByReview,
  sortProjectAssetsForList,
  type ProjectAssetListSort,
  type ProjectAssetReviewFilter,
} from "@/lib/projects/project-asset-review-list";
import { filterCurrentOneOffPeopleOptions } from "@/lib/projects/current-one-off-consent";
import { createAdminClient } from "@/lib/supabase/admin";
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

type AssetListSort = ProjectAssetListSort;

type AssetReviewFilter = ProjectAssetReviewFilter;

type AssetScopeFilterStatus = ProjectConsentScopeFilterStatus;

type DuplicatePolicy = "upload_anyway" | "overwrite" | "ignore";

type AssetRow = {
  id: string;
  asset_type: "photo" | "video";
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

type AssetMaterializationRow = {
  asset_id: string;
  source_image_width: number | null;
  source_image_height: number | null;
  materialized_at: string;
};

type HeadshotAssetRow = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type RecurringProfileRow = {
  id: string;
  full_name: string | null;
  email: string | null;
};

type RecurringHeadshotRow = {
  id: string;
  profile_id: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type ConsentFilterOptionRow = {
  id: string;
  superseded_at: string | null;
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
    case "needs_review_first":
      return raw;
    case "created_at_desc":
    default:
      return "created_at_desc";
  }
}

function parseReviewFilter(searchParams: URLSearchParams): AssetReviewFilter {
  const raw = searchParams.get("review");
  switch (raw) {
    case "needs_review":
    case "blocked":
    case "resolved":
      return raw;
    case "all":
    default:
      return "all";
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

function parseScopeFilter(searchParams: URLSearchParams) {
  const scopeTemplateKey = String(searchParams.get("scopeTemplateKey") ?? "").trim();
  const scopeKey = String(searchParams.get("scopeKey") ?? "").trim();
  const rawScopeStatus = String(searchParams.get("scopeStatus") ?? "").trim();
  const scopeStatus: AssetScopeFilterStatus =
    rawScopeStatus === "not_granted"
    || rawScopeStatus === "revoked"
    || rawScopeStatus === "not_collected"
      ? rawScopeStatus
      : "granted";

  if (!scopeTemplateKey || !scopeKey) {
    return null;
  }

  return {
    scopeTemplateKey,
    scopeKey,
    scopeStatus,
  };
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
  const authSupabase = await createClient();
  const {
    data: { user },
  } = await authSupabase.auth.getUser();

  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const tenantId = await resolveTenantId(authSupabase);
  if (!tenantId) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  const { projectId } = await context.params;
  return { supabase: createAdminClient(), tenantId, projectId, userId: user.id };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId } = await requireAuthAndScope(context);
    const url = new URL(request.url);
    const limit = parseLimit(url.searchParams);
    const offset = parseOffset(url.searchParams);
    const sort = parseSort(url.searchParams);
    const reviewFilter = parseReviewFilter(url.searchParams);
    const queryText = parseSearchQuery(url.searchParams);
    const selectedConsentIds = parseConsentFilterIds(url.searchParams);
    const selectedScopeFilter = parseScopeFilter(url.searchParams);

    const [{ data: consentFilterRows, error: consentFilterError }, scopeFilters] = await Promise.all([
      supabase
        .from("consents")
        .select("id, superseded_at, subjects(email, full_name)")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .not("signed_at", "is", null)
        .is("superseded_at", null)
        .order("signed_at", { ascending: false }),
      loadProjectConsentScopeFilterFamilies({
        supabase,
        tenantId,
        projectId,
      }),
    ]);

    if (consentFilterError) {
      throw new HttpError(500, "consent_filter_lookup_failed", "Unable to load consent filters.");
    }

    const people = filterCurrentOneOffPeopleOptions(
      ((consentFilterRows as ConsentFilterOptionRow[] | null) ?? []),
    ).map((consent) => {
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
      const { data: allPhotoIds, error: allPhotoIdsError } = await supabase
        .from("assets")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("asset_type", "photo");

      if (allPhotoIdsError) {
        throw new HttpError(500, "asset_filter_lookup_failed", "Unable to filter assets by selected people.");
      }

      const consentMatchMap = new Map<string, Set<string>>();
      const filteredAssignments = await listPhotoConsentAssignmentsForAssetIds({
        supabase,
        tenantId,
        projectId,
        assetIds: ((allPhotoIds ?? []) as Array<{ id: string }>).map((row) => row.id),
      });
      filteredAssignments
        .filter((assignment) => selectedConsentIds.includes(assignment.consentId))
        .forEach((assignment) => {
          const current = consentMatchMap.get(assignment.assetId) ?? new Set<string>();
          current.add(assignment.consentId);
          consentMatchMap.set(assignment.assetId, current);
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
            scopeFilters,
            reviewSummary: {
              totalAssetCount: 0,
              needsReviewAssetCount: 0,
              pendingAssetCount: 0,
              blockedAssetCount: 0,
              resolvedAssetCount: 0,
            },
          },
          { status: 200 },
        );
      }
    }

    let query = supabase
      .from("assets")
      .select("id, asset_type, original_filename, status, file_size_bytes, created_at, uploaded_at, storage_bucket, storage_path")
      .eq("project_id", projectId)
      .eq("tenant_id", tenantId)
      .in("asset_type", ["photo", "video"])
      .eq("status", "uploaded");

    if (queryText) {
      query = query.ilike("original_filename", `%${queryText}%`);
    }

    if (filteredAssetIds) {
      query = query.in("id", filteredAssetIds);
    }

    const { data: assets, error: assetsError } = await query;
    if (assetsError) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load assets.");
    }

    const candidateAssetRows = (assets as AssetRow[] | null) ?? [];
    const scopeMatchedAssetIds = selectedScopeFilter
      ? new Set(
          await resolveProjectAssetIdsByConsentScopeFilter({
            supabase,
            tenantId,
            projectId,
            assetIds: candidateAssetRows.map((asset) => asset.id),
            scopeTemplateKey: selectedScopeFilter.scopeTemplateKey,
            scopeKey: selectedScopeFilter.scopeKey,
            scopeStatus: selectedScopeFilter.scopeStatus,
          }),
        )
      : null;
    const scopeFilteredAssetRows = scopeMatchedAssetIds
      ? candidateAssetRows.filter((asset) => scopeMatchedAssetIds.has(asset.id))
      : candidateAssetRows;
    const candidatePhotoAssetIds = scopeFilteredAssetRows
      .filter((asset) => asset.asset_type === "photo")
      .map((asset) => asset.id);
    const reviewSummaryByAssetId = await getAssetReviewSummaries({
      supabase,
      tenantId,
      projectId,
      assetIds: candidatePhotoAssetIds,
    });

    const candidateAssets = scopeFilteredAssetRows.map((asset) => ({
      asset,
      review:
        reviewSummaryByAssetId.get(asset.id) ??
        (asset.asset_type === "photo"
          ? buildPendingAssetReviewSummary(asset.id)
          : {
              assetId: asset.id,
              reviewStatus: "resolved" as const,
              unresolvedFaceCount: 0,
              blockedFaceCount: 0,
              firstNeedsReviewFaceId: null,
            }),
    }));

    const reviewSummary = buildProjectAssetReviewSummary(candidateAssets);
    const filteredAssets = filterProjectAssetsByReview(candidateAssets, reviewFilter);
    const sortedAssets = sortProjectAssetsForList(filteredAssets, sort);

    const pagedAssets = sortedAssets.slice(offset, offset + limit);
    const assetRows = pagedAssets.map((entry) => entry.asset);
    const photoAssetRows = assetRows.filter((asset) => asset.asset_type === "photo");
    const videoAssetRows = assetRows.filter((asset) => asset.asset_type === "video");
    const photoAssetIds = photoAssetRows.map((asset) => asset.id);
    const reviewByAssetId = new Map(pagedAssets.map((entry) => [entry.asset.id, entry.review] as const));

    const requestHostHeader = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    const photoThumbnailMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, photoAssetRows, {
      tenantId,
      projectId,
      use: "thumbnail",
      fallback: "original",
      enqueueMissingDerivative: true,
    });
    const photoPreviewMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, photoAssetRows, {
      tenantId,
      projectId,
      use: "preview",
      fallback: "original",
    });
    const videoThumbnailMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, videoAssetRows, {
      tenantId,
      projectId,
      use: "thumbnail",
      fallback: "none",
    });
    const videoPreviewMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, videoAssetRows, {
      tenantId,
      projectId,
      use: "preview",
      fallback: "none",
    });
    const videoPlaybackMap = await signVideoPlaybackUrlsForAssets(videoAssetRows);

    const assetLinkCountMap = new Map<string, number>();
    const assetImageSizeMap = new Map<string, { width: number | null; height: number | null }>();
    const assetLinkedPeopleMap = new Map<
      string,
      Array<{ consentId: string; fullName: string | null; email: string | null }>
    >();
    const assetLinkedFaceOverlayMap = new Map<
      string,
      Array<{
        assetFaceId: string;
        projectFaceAssigneeId: string;
        identityKind: "project_consent" | "project_recurring_consent";
        consentId: string | null;
        projectProfileParticipantId: string | null;
        fullName: string | null;
        email: string | null;
        headshotThumbnailUrl: string | null;
        faceRank: number;
        faceBoxNormalized: Record<string, number | null> | null;
        linkSource: "manual" | "auto";
        matchConfidence: number | null;
      }>
    >();

    if (photoAssetIds.length > 0) {
      const { data: materializations, error: materializationsError } = await supabase
        .from("asset_face_materializations")
        .select("asset_id, source_image_width, source_image_height, materialized_at")
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .in("asset_id", photoAssetIds)
        .order("materialized_at", { ascending: false });

      if (materializationsError) {
        throw new HttpError(500, "asset_lookup_failed", "Unable to load asset image dimensions.");
      }

      ((materializations as AssetMaterializationRow[] | null) ?? []).forEach((row) => {
        if (assetImageSizeMap.has(row.asset_id)) {
          return;
        }

        assetImageSizeMap.set(row.asset_id, {
          width: row.source_image_width,
          height: row.source_image_height,
        });
      });

      const assignments = await listPhotoConsentAssignmentsForAssetIds({
        supabase,
        tenantId,
        projectId,
        assetIds: photoAssetIds,
      });
      const linkedFaceOverlays = await listLinkedFaceOverlaysForAssetIds({
        supabase,
        tenantId,
        projectId,
        assetIds: photoAssetIds,
      });
      const consentIdsForLookup = Array.from(
        new Set([
          ...assignments.map((assignment) => assignment.consentId),
          ...linkedFaceOverlays
            .map((overlay) => overlay.consentId)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ]),
      );
      const resolvedConsentSummaryById = new Map<string, { fullName: string | null; email: string | null }>();
      const recurringSummaryByProfileId = new Map<string, { fullName: string | null; email: string | null }>();
      if (consentIdsForLookup.length > 0) {
        const consentDetails = await supabase
          .from("consents")
          .select("id, subjects(email, full_name)")
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .in("id", consentIdsForLookup);

        if (consentDetails.error) {
          throw new HttpError(500, "asset_link_lookup_failed", "Unable to load linked consent details.");
        }

        ((consentDetails.data ?? []) as ConsentFilterOptionRow[]).forEach((consent) => {
          const normalizedConsent: ConsentFilterOption = {
            id: consent.id,
            subjects: normalizeSubjectRelation(consent.subjects),
          };
          resolvedConsentSummaryById.set(normalizedConsent.id, {
            fullName: normalizedConsent.subjects?.full_name?.trim() ?? null,
            email: normalizedConsent.subjects?.email?.trim() ?? null,
          });
        });
      }
      const recurringProfileIds = Array.from(
        new Set(
          linkedFaceOverlays
            .map((overlay) => overlay.profileId)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      );
      if (recurringProfileIds.length > 0) {
        const { data: recurringProfiles, error: recurringProfilesError } = await supabase
          .from("recurring_profiles")
          .select("id, full_name, email")
          .eq("tenant_id", tenantId)
          .in("id", recurringProfileIds);

        if (recurringProfilesError) {
          throw new HttpError(500, "asset_link_lookup_failed", "Unable to load linked recurring profiles.");
        }

        ((recurringProfiles ?? []) as RecurringProfileRow[]).forEach((profile) => {
          recurringSummaryByProfileId.set(profile.id, {
            fullName: profile.full_name?.trim() ?? null,
            email: profile.email?.trim() ?? null,
          });
        });
      }

      const overlayConsentIds = Array.from(
        new Set(
          linkedFaceOverlays
            .map((overlay) => overlay.consentId)
            .filter((value): value is string => typeof value === "string" && value.length > 0),
        ),
      );
      const headshotThumbnailUrlByConsentId = new Map<string, string | null>();
      const recurringHeadshotThumbnailUrlByProfileId = new Map<string, string | null>();

      if (overlayConsentIds.length > 0) {
        const currentHeadshots = await loadCurrentProjectConsentHeadshots(supabase, tenantId, projectId, {
          optInOnly: false,
          notRevokedOnly: false,
          limit: null,
        });
        const headshotAssetIdByConsentId = new Map(
          currentHeadshots
            .filter((headshot) => overlayConsentIds.includes(headshot.consentId))
            .map((headshot) => [headshot.consentId, headshot.headshotAssetId]),
        );
        const headshotAssetIds = Array.from(new Set(Array.from(headshotAssetIdByConsentId.values())));

        if (headshotAssetIds.length > 0) {
          const { data: headshotAssets, error: headshotAssetsError } = await supabase
            .from("assets")
            .select("id, status, storage_bucket, storage_path")
            .eq("tenant_id", tenantId)
            .eq("project_id", projectId)
            .eq("asset_type", "headshot")
            .eq("status", "uploaded")
            .is("archived_at", null)
            .in("id", headshotAssetIds);

          if (headshotAssetsError) {
            throw new HttpError(500, "asset_link_lookup_failed", "Unable to load linked consent headshots.");
          }

          const headshotAssetRows = (headshotAssets as HeadshotAssetRow[] | null) ?? [];
          const headshotThumbnailMap = await signThumbnailUrlsForAssets(supabase, headshotAssetRows, {
            width: 96,
            height: 96,
          });

          headshotAssetIdByConsentId.forEach((headshotAssetId, consentId) => {
            const signedUrl = headshotThumbnailMap.get(headshotAssetId) ?? null;
            headshotThumbnailUrlByConsentId.set(
              consentId,
              signedUrl
                ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
                : null,
            );
          });
        }
      }

      if (recurringProfileIds.length > 0) {
        const { data: recurringHeadshots, error: recurringHeadshotsError } = await supabase
          .from("recurring_profile_headshots")
          .select("id, profile_id, storage_bucket, storage_path")
          .eq("tenant_id", tenantId)
          .is("superseded_at", null)
          .eq("upload_status", "uploaded")
          .in("profile_id", recurringProfileIds)
          .order("created_at", { ascending: false });

        if (recurringHeadshotsError) {
          throw new HttpError(500, "asset_link_lookup_failed", "Unable to load linked recurring headshots.");
        }

        const latestHeadshotByProfileId = new Map<string, RecurringHeadshotRow>();
        ((recurringHeadshots ?? []) as RecurringHeadshotRow[]).forEach((headshot) => {
          if (!latestHeadshotByProfileId.has(headshot.profile_id)) {
            latestHeadshotByProfileId.set(headshot.profile_id, headshot);
          }
        });

        await Promise.all(
          Array.from(latestHeadshotByProfileId.entries()).map(async ([profileId, headshot]) => {
            if (!headshot.storage_bucket || !headshot.storage_path) {
              recurringHeadshotThumbnailUrlByProfileId.set(profileId, null);
              return;
            }

            const { data, error } = await supabase.storage
              .from(headshot.storage_bucket)
              .createSignedUrl(headshot.storage_path, 60 * 60);

            recurringHeadshotThumbnailUrlByProfileId.set(
              profileId,
              !error && data?.signedUrl
                ? resolveLoopbackStorageUrlForHostHeader(data.signedUrl, requestHostHeader)
                : null,
            );
          }),
        );
      }

      assignments.forEach((assignment) => {
        const currentCount = assetLinkCountMap.get(assignment.assetId) ?? 0;
        assetLinkCountMap.set(assignment.assetId, currentCount + 1);

        const existingPeople = assetLinkedPeopleMap.get(assignment.assetId) ?? [];
        if (existingPeople.some((person) => person.consentId === assignment.consentId)) {
          return;
        }

        const summary = resolvedConsentSummaryById.get(assignment.consentId);
        existingPeople.push({
          consentId: assignment.consentId,
          fullName: summary?.fullName ?? null,
          email: summary?.email ?? null,
        });
        assetLinkedPeopleMap.set(assignment.assetId, existingPeople);
      });

      linkedFaceOverlays.forEach((overlay) => {
        const existing = assetLinkedFaceOverlayMap.get(overlay.assetId) ?? [];
        const summary =
          overlay.identityKind === "project_consent" && overlay.consentId
            ? resolvedConsentSummaryById.get(overlay.consentId) ?? null
            : overlay.profileId
              ? recurringSummaryByProfileId.get(overlay.profileId) ?? null
              : null;
        existing.push({
          assetFaceId: overlay.assetFaceId,
          projectFaceAssigneeId: overlay.projectFaceAssigneeId,
          identityKind: overlay.identityKind,
          consentId: overlay.consentId,
          projectProfileParticipantId: overlay.projectProfileParticipantId,
          fullName: summary?.fullName ?? null,
          email: summary?.email ?? null,
          headshotThumbnailUrl:
            overlay.identityKind === "project_consent" && overlay.consentId
              ? headshotThumbnailUrlByConsentId.get(overlay.consentId) ?? null
              : overlay.profileId
                ? recurringHeadshotThumbnailUrlByProfileId.get(overlay.profileId) ?? null
                : null,
          faceRank: overlay.faceRank,
          faceBoxNormalized: overlay.faceBoxNormalized,
          linkSource: overlay.linkSource,
          matchConfidence: overlay.matchConfidence,
        });
        assetLinkedFaceOverlayMap.set(overlay.assetId, existing);
      });
    }

    return Response.json(
      {
        assets: assetRows.map((asset) => {
          const thumbnail =
            asset.asset_type === "photo"
              ? photoThumbnailMap.get(asset.id) ?? { url: null, state: "unavailable" as const }
              : videoThumbnailMap.get(asset.id) ?? { url: null, state: "unavailable" as const };
          const preview =
            asset.asset_type === "photo"
              ? photoPreviewMap.get(asset.id) ?? { url: null, state: "unavailable" as const }
              : videoPreviewMap.get(asset.id) ?? { url: null, state: "unavailable" as const };
          const review = reviewByAssetId.get(asset.id) ?? {
            ...(asset.asset_type === "photo"
              ? buildPendingAssetReviewSummary(asset.id)
              : {
                  assetId: asset.id,
                  reviewStatus: "resolved" as const,
                  unresolvedFaceCount: 0,
                  blockedFaceCount: 0,
                  firstNeedsReviewFaceId: null,
                }),
          };
          return {
            id: asset.id,
            assetType: asset.asset_type,
            originalFilename: asset.original_filename,
            status: asset.status,
            fileSizeBytes: asset.file_size_bytes,
            createdAt: asset.created_at,
            uploadedAt: asset.uploaded_at,
            originalWidth: assetImageSizeMap.get(asset.id)?.width ?? null,
            originalHeight: assetImageSizeMap.get(asset.id)?.height ?? null,
            thumbnailUrl: thumbnail.url
              ? resolveLoopbackStorageUrlForHostHeader(thumbnail.url, requestHostHeader)
              : null,
            thumbnailState: thumbnail.state,
            previewUrl: preview.url
              ? resolveLoopbackStorageUrlForHostHeader(preview.url, requestHostHeader)
              : null,
            previewState: preview.state,
            playbackUrl:
              asset.asset_type === "video"
                ? (() => {
                    const playbackUrl = videoPlaybackMap.get(asset.id) ?? null;
                    return playbackUrl
                      ? resolveLoopbackStorageUrlForHostHeader(playbackUrl, requestHostHeader)
                      : null;
                  })()
                : null,
            linkedConsentCount: assetLinkCountMap.get(asset.id) ?? 0,
            linkedPeople: assetLinkedPeopleMap.get(asset.id) ?? [],
            linkedFaceOverlays: assetLinkedFaceOverlayMap.get(asset.id) ?? [],
            reviewStatus: asset.asset_type === "photo" ? review.reviewStatus : null,
            unresolvedFaceCount: asset.asset_type === "photo" ? review.unresolvedFaceCount : 0,
            blockedFaceCount: asset.asset_type === "photo" ? review.blockedFaceCount : 0,
            firstNeedsReviewFaceId: asset.asset_type === "photo" ? review.firstNeedsReviewFaceId : null,
          };
        }),
        totalCount: filteredAssets.length,
        people,
        scopeFilters,
        reviewSummary,
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
