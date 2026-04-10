import type { SupabaseClient } from "@supabase/supabase-js";

import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { signFaceDerivativeUrls } from "@/lib/assets/sign-face-derivatives";
import { HttpError } from "@/lib/http/errors";
import {
  getAutoMatchCompareVersion,
  getAutoMatchMaterializerVersion,
} from "@/lib/matching/auto-match-config";
import {
  loadCurrentAssetFaceMaterialization,
  loadCurrentProjectConsentHeadshots,
  loadFaceImageDerivativesForFaceIds,
} from "@/lib/matching/face-materialization";
import {
  listLinkedFaceOverlaysForAssetIds,
  loadCurrentHiddenFacesForAsset,
} from "@/lib/matching/photo-face-linking";
import {
  getStructuredFieldsInOrder,
  getStructuredOptionLabel,
  type StructuredFieldDefinition,
  type StructuredFieldValue,
  type StructuredFieldsSnapshot,
} from "@/lib/templates/structured-fields";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

type MatchingScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  requestHostHeader?: string | null;
};

type ConsentRelation = {
  email: string | null;
  full_name: string | null;
};

type ConsentRow = {
  id: string;
  signed_at: string | null;
  consent_version: string | null;
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
  face_match_opt_in: boolean;
  revoked_at: string | null;
  subjects: ConsentRelation | ConsentRelation[] | null;
};

type AssetRow = {
  id: string;
  status: string;
  asset_type: string;
  archived_at: string | null;
};

type HeadshotAssetRow = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type CompareCandidateRow = {
  consent_id: string;
  headshot_materialization_id: string;
  asset_materialization_id: string;
  winning_asset_face_id: string | null;
  winning_similarity: number | string;
  compare_status: string;
  compare_version: string;
};

type CompareFaceScoreRow = {
  consent_id: string;
  headshot_materialization_id: string;
  asset_materialization_id: string;
  asset_face_id: string;
  asset_face_rank: number | null;
  similarity: number | string;
  compare_version: string;
};

type LikelyCandidateRow = {
  consent_id: string;
  confidence: number | string;
  last_scored_at: string;
  winning_asset_face_id: string | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function toNumericScore(value: number | string | null | undefined) {
  const numeric = Number(value ?? NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildConsentHref(projectId: string, consentId: string) {
  const params = new URLSearchParams({ openConsentId: consentId });
  return `/projects/${projectId}?${params.toString()}#consent-${consentId}`;
}

function formatStructuredFieldValue(
  field: StructuredFieldDefinition,
  value: StructuredFieldValue | undefined,
) {
  if (!value) {
    return null;
  }

  if (value.valueType === "checkbox_list") {
    const selectedLabels = value.selectedOptionKeys
      .map((optionKey) => getStructuredOptionLabel(field, optionKey))
      .filter((label): label is string => Boolean(label));

    return selectedLabels.length > 0 ? selectedLabels.join(", ") : null;
  }

  if (value.valueType === "single_select") {
    if (!value.selectedOptionKey) {
      return null;
    }

    return getStructuredOptionLabel(field, value.selectedOptionKey) ?? null;
  }

  const text = value.text?.trim() ?? "";
  return text.length > 0 ? text : null;
}

function summarizeStructuredSnapshot(snapshot: StructuredFieldsSnapshot | null) {
  if (!snapshot) {
    return null;
  }

  const summaries = getStructuredFieldsInOrder(snapshot.definition)
    .map((field) => {
      const formattedValue = formatStructuredFieldValue(field, snapshot.values[field.fieldKey]);
      return formattedValue ? `${field.label}: ${formattedValue}` : null;
    })
    .filter((value): value is string => Boolean(value));

  return summaries.length > 0 ? summaries : null;
}

async function requirePhotoAsset(input: MatchingScopeInput) {
  const { data, error } = await input.supabase
    .from("assets")
    .select("id, status, asset_type, archived_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.assetId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to load asset preview details.");
  }

  const asset = (data as AssetRow | null) ?? null;
  if (!asset || asset.asset_type !== "photo" || asset.status !== "uploaded" || asset.archived_at) {
    throw new HttpError(404, "asset_not_found", "Asset not found.");
  }

  return asset;
}

async function loadConsentSummaryMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, ConsentRow>();
  }

  const { data, error } = await supabase
    .from("consents")
    .select("id, signed_at, consent_version, structured_fields_snapshot, face_match_opt_in, revoked_at, subjects(email, full_name)")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("id", consentIds);

  if (error) {
    throw new HttpError(500, "consent_lookup_failed", "Unable to load consent preview details.");
  }

  return new Map(
    ((data ?? []) as ConsentRow[]).map((row) => [row.id, row] as const),
  );
}

async function loadHeadshotThumbnailMap(input: MatchingScopeInput, consentIds: string[]) {
  const headshotThumbnailUrlByConsentId = new Map<string, string | null>();
  const headshotPreviewUrlByConsentId = new Map<string, string | null>();
  if (consentIds.length === 0) {
    return {
      thumbnailByConsentId: headshotThumbnailUrlByConsentId,
      previewByConsentId: headshotPreviewUrlByConsentId,
    };
  }

  const currentHeadshots = await loadCurrentProjectConsentHeadshots(input.supabase, input.tenantId, input.projectId, {
    optInOnly: false,
    notRevokedOnly: false,
    limit: null,
  });
  const headshotAssetIdByConsentId = new Map(
    currentHeadshots
      .filter((headshot) => consentIds.includes(headshot.consentId))
      .map((headshot) => [headshot.consentId, headshot.headshotAssetId] as const),
  );
  const headshotAssetIds = Array.from(new Set(Array.from(headshotAssetIdByConsentId.values())));

  if (headshotAssetIds.length === 0) {
    return {
      thumbnailByConsentId: headshotThumbnailUrlByConsentId,
      previewByConsentId: headshotPreviewUrlByConsentId,
    };
  }

  const { data, error } = await input.supabase
    .from("assets")
    .select("id, status, storage_bucket, storage_path")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_type", "headshot")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .in("id", headshotAssetIds);

  if (error) {
    throw new HttpError(500, "headshot_lookup_failed", "Unable to load consent headshots.");
  }

  const headshotAssets = (data as HeadshotAssetRow[] | null) ?? [];
  const [signedThumbnailUrls, signedPreviewUrls] = await Promise.all([
    signThumbnailUrlsForAssets(input.supabase, headshotAssets, {
      width: 96,
      height: 96,
    }),
    signThumbnailUrlsForAssets(input.supabase, headshotAssets, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      use: "preview",
      fallback: "transform",
    }),
  ]);

  headshotAssetIdByConsentId.forEach((headshotAssetId, consentId) => {
    const signedUrl = signedThumbnailUrls.get(headshotAssetId) ?? null;
    const signedPreviewUrl = signedPreviewUrls.get(headshotAssetId) ?? null;
    headshotThumbnailUrlByConsentId.set(
      consentId,
      signedUrl
        ? resolveLoopbackStorageUrlForHostHeader(signedUrl, input.requestHostHeader)
        : null,
    );
    headshotPreviewUrlByConsentId.set(
      consentId,
      signedPreviewUrl
        ? resolveLoopbackStorageUrlForHostHeader(signedPreviewUrl, input.requestHostHeader)
        : null,
    );
  });

  return {
    thumbnailByConsentId: headshotThumbnailUrlByConsentId,
    previewByConsentId: headshotPreviewUrlByConsentId,
  };
}

async function loadCurrentHeadshotMaterializationIds(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, string>();
  }

  const nowIso = new Date().toISOString();
  const headshotLinks = await runChunkedRead(consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_links")
      .select("asset_id, consent_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("consent_id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "headshot_link_lookup_failed", "Unable to load consent headshots.");
    }

    return (data ?? []) as Array<{ asset_id: string; consent_id: string }>;
  });

  const assetIds = Array.from(new Set(headshotLinks.map((row) => row.asset_id)));
  if (assetIds.length === 0) {
    return new Map<string, string>();
  }

  const headshots = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("assets")
      .select("id, uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "headshot")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .or(`retention_expires_at.is.null,retention_expires_at.gt.${nowIso}`)
      .in("id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "headshot_asset_lookup_failed", "Unable to validate consent headshots.");
    }

    return (data ?? []) as Array<{ id: string; uploaded_at: string | null }>;
  });

  const headshotById = new Map(headshots.map((row) => [row.id, row]));
  const currentHeadshotAssetIdByConsentId = new Map<string, string>();
  for (const row of headshotLinks) {
    const headshot = headshotById.get(row.asset_id);
    if (!headshot) {
      continue;
    }

    const currentAssetId = currentHeadshotAssetIdByConsentId.get(row.consent_id);
    if (!currentAssetId) {
      currentHeadshotAssetIdByConsentId.set(row.consent_id, row.asset_id);
      continue;
    }

    const currentHeadshot = headshotById.get(currentAssetId);
    if ((headshot.uploaded_at ?? "") > (currentHeadshot?.uploaded_at ?? "")) {
      currentHeadshotAssetIdByConsentId.set(row.consent_id, row.asset_id);
    }
  }

  const currentHeadshotAssetIds = Array.from(new Set(Array.from(currentHeadshotAssetIdByConsentId.values())));
  const materializations = await runChunkedRead(currentHeadshotAssetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materializations")
      .select("asset_id, id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "headshot")
      .eq("materializer_version", getAutoMatchMaterializerVersion())
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "headshot_materialization_lookup_failed", "Unable to load headshot materializations.");
    }

    return (data ?? []) as Array<{ asset_id: string; id: string }>;
  });

  const materializationIdByAssetId = new Map(materializations.map((row) => [row.asset_id, row.id]));
  const map = new Map<string, string>();
  currentHeadshotAssetIdByConsentId.forEach((assetId, consentId) => {
    const materializationId = materializationIdByAssetId.get(assetId);
    if (materializationId) {
      map.set(consentId, materializationId);
    }
  });

  return map;
}

export type AssetPreviewLinkedFacesResponse = {
  assetId: string;
  linkedFaces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    faceThumbnailUrl: string | null;
    linkSource: "manual" | "auto";
    matchConfidence: number | null;
    consent: {
      consentId: string;
      fullName: string | null;
      email: string | null;
      status: "active" | "revoked";
      signedAt: string | null;
      consentVersion: string | null;
      faceMatchOptIn: boolean | null;
      structuredSnapshotSummary: string[] | null;
      headshotThumbnailUrl: string | null;
      headshotPreviewUrl: string | null;
      goToConsentHref: string;
    };
  }>;
};

export type AssetPreviewFacesResponse = {
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  activeLinkedFaceCount: number;
  hiddenFaceCount: number;
  faces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    faceThumbnailUrl: string | null;
    detectionProbability: number | null;
    faceState: "linked_manual" | "linked_auto" | "unlinked" | "hidden";
    hiddenAt: string | null;
    currentLink: null | {
      consentId: string;
      linkSource: "manual" | "auto";
      matchConfidence: number | null;
      consent: {
        fullName: string | null;
        email: string | null;
        status: "active" | "revoked";
        signedAt: string | null;
        consentVersion: string | null;
        faceMatchOptIn: boolean | null;
        structuredSnapshotSummary: string[] | null;
        headshotThumbnailUrl: string | null;
        headshotPreviewUrl: string | null;
        goToConsentHref: string;
      };
    };
  }>;
};

export type AssetPreviewLinkCandidatesResponse = {
  assetId: string;
  candidates: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
    headshotThumbnailUrl: string | null;
    currentAssetLink: {
      assetFaceId: string;
      faceRank: number | null;
    } | null;
  }>;
};

export type AssetPreviewFaceCandidatesResponse = {
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  candidates: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
    headshotThumbnailUrl: string | null;
    rank: number | null;
    similarityScore: number | null;
    scoreSource: "current_compare" | "likely_candidate" | "unscored";
    currentAssetLink: {
      assetFaceId: string;
      faceRank: number | null;
    } | null;
  }>;
};

export async function getAssetPreviewLinkedFaces(
  input: MatchingScopeInput,
): Promise<AssetPreviewLinkedFacesResponse> {
  const preview = await getAssetPreviewFaces(input);

  return {
    assetId: preview.assetId,
    linkedFaces: preview.faces
      .filter((face) => face.currentLink)
      .map((face) => ({
        assetFaceId: face.assetFaceId,
        faceRank: face.faceRank,
        faceBoxNormalized: face.faceBoxNormalized,
        faceThumbnailUrl: face.faceThumbnailUrl,
        linkSource: face.currentLink?.linkSource ?? "manual",
        matchConfidence: face.currentLink?.matchConfidence ?? null,
        consent: {
          consentId: face.currentLink?.consentId ?? "",
          fullName: face.currentLink?.consent.fullName ?? null,
          email: face.currentLink?.consent.email ?? null,
          status: face.currentLink?.consent.status ?? "active",
          signedAt: face.currentLink?.consent.signedAt ?? null,
          consentVersion: face.currentLink?.consent.consentVersion ?? null,
          faceMatchOptIn: face.currentLink?.consent.faceMatchOptIn ?? null,
          structuredSnapshotSummary: face.currentLink?.consent.structuredSnapshotSummary ?? null,
          headshotThumbnailUrl: face.currentLink?.consent.headshotThumbnailUrl ?? null,
          headshotPreviewUrl: face.currentLink?.consent.headshotPreviewUrl ?? null,
          goToConsentHref: face.currentLink?.consent.goToConsentHref ?? buildConsentHref(input.projectId, ""),
        },
      })),
  };
}

export async function getAssetPreviewFaces(
  input: MatchingScopeInput,
): Promise<AssetPreviewFacesResponse> {
  await requirePhotoAsset(input);

  const current = await loadCurrentAssetFaceMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );
  if (!current) {
    return {
      assetId: input.assetId,
      materializationId: null,
      detectedFaceCount: 0,
      activeLinkedFaceCount: 0,
      hiddenFaceCount: 0,
      faces: [],
    };
  }

  const [hiddenFaces, overlays] = await Promise.all([
    loadCurrentHiddenFacesForAsset({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
    }),
    listLinkedFaceOverlaysForAssetIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetIds: [input.assetId],
    }),
  ]);
  const exactLinkedFaces = overlays.filter((overlay) => overlay.assetId === input.assetId);
  const hiddenFaceById = new Map(hiddenFaces.map((row) => [row.asset_face_id, row] as const));
  const consentIds = Array.from(new Set(exactLinkedFaces.map((overlay) => overlay.consentId)));
  const faceIds = Array.from(new Set(current.faces.map((face) => face.id)));
  const [consentSummaryMap, faceDerivatives, headshotImageMap] = await Promise.all([
    loadConsentSummaryMap(input.supabase, input.tenantId, input.projectId, consentIds),
    loadFaceImageDerivativesForFaceIds(input.supabase, input.tenantId, input.projectId, faceIds),
    loadHeadshotThumbnailMap(input, consentIds),
  ]);
  const signedFaceDerivativeMap = await signFaceDerivativeUrls(Array.from(faceDerivatives.values()));
  const overlayByFaceId = new Map(exactLinkedFaces.map((overlay) => [overlay.assetFaceId, overlay] as const));

  return {
    assetId: input.assetId,
    materializationId: current.materialization.id,
    detectedFaceCount: current.materialization.face_count,
    activeLinkedFaceCount: exactLinkedFaces.length,
    hiddenFaceCount: hiddenFaces.length,
    faces: current.faces
      .slice()
      .sort((left, right) => left.face_rank - right.face_rank)
      .map((face) => {
        const hiddenFace = hiddenFaceById.get(face.id) ?? null;
        const overlay = hiddenFace ? null : overlayByFaceId.get(face.id) ?? null;
        const consent = overlay ? consentSummaryMap.get(overlay.consentId) ?? null : null;
        const subject = firstRelation(consent?.subjects);
        const signedFaceUrl = signedFaceDerivativeMap.get(face.id) ?? null;

        return {
          assetFaceId: face.id,
          faceRank: face.face_rank,
          faceBoxNormalized: (face.face_box_normalized as Record<string, number | null> | null) ?? null,
          faceThumbnailUrl: signedFaceUrl
            ? resolveLoopbackStorageUrlForHostHeader(signedFaceUrl, input.requestHostHeader)
            : null,
          detectionProbability: face.detection_probability ?? null,
          faceState: hiddenFace
            ? "hidden"
            : overlay?.linkSource === "manual"
              ? "linked_manual"
              : overlay?.linkSource === "auto"
                ? "linked_auto"
                : "unlinked",
          hiddenAt: hiddenFace?.hidden_at ?? null,
          currentLink: overlay
            ? {
                consentId: overlay.consentId,
                linkSource: overlay.linkSource,
                matchConfidence: overlay.matchConfidence,
                consent: {
                  fullName: subject?.full_name?.trim() ?? null,
                  email: subject?.email?.trim() ?? null,
                  status: consent?.revoked_at ? "revoked" : "active",
                  signedAt: consent?.signed_at ?? null,
                  consentVersion: consent?.consent_version ?? null,
                  faceMatchOptIn: typeof consent?.face_match_opt_in === "boolean" ? consent.face_match_opt_in : null,
                  structuredSnapshotSummary: summarizeStructuredSnapshot(consent?.structured_fields_snapshot ?? null),
                  headshotThumbnailUrl: headshotImageMap.thumbnailByConsentId.get(overlay.consentId) ?? null,
                  headshotPreviewUrl: headshotImageMap.previewByConsentId.get(overlay.consentId) ?? null,
                  goToConsentHref: buildConsentHref(input.projectId, overlay.consentId),
                },
              }
            : null,
        };
      }),
  };
}

export async function getAssetPreviewFaceCandidates(
  input: MatchingScopeInput & {
    assetFaceId: string;
  },
): Promise<AssetPreviewFaceCandidatesResponse> {
  await requirePhotoAsset(input);

  const current = await loadCurrentAssetFaceMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );
  if (!current) {
    throw new HttpError(409, "photo_materialization_pending", "Photo face materialization is still pending for this photo.");
  }

  const targetFace = current.faces.find((face) => face.id === input.assetFaceId) ?? null;
  if (!targetFace) {
    throw new HttpError(400, "invalid_asset_face_id", "The selected face is invalid.");
  }

  const hiddenFaces = await loadCurrentHiddenFacesForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });
  if (hiddenFaces.some((row) => row.asset_face_id === input.assetFaceId)) {
    throw new HttpError(409, "hidden_face_restore_required", "Restore the hidden face before linking it.");
  }

  const currentAssetLinks = await listLinkedFaceOverlaysForAssetIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetIds: [input.assetId],
  });
  const currentAssetLinkByConsentId = new Map(
    currentAssetLinks.map((overlay) => [
      overlay.consentId,
      { assetFaceId: overlay.assetFaceId, faceRank: overlay.faceRank },
    ] as const),
  );

  const { data: compareFaceScoreRowsData, error: compareFaceScoreRowsError } = await input.supabase
    .from("asset_consent_face_compare_scores")
    .select(
      "consent_id, headshot_materialization_id, asset_materialization_id, asset_face_id, asset_face_rank, similarity, compare_version",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("asset_materialization_id", current.materialization.id)
    .eq("asset_face_id", input.assetFaceId)
    .eq("compare_version", getAutoMatchCompareVersion());

  if (compareFaceScoreRowsError) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview face candidates.");
  }

  const compareFaceScoreRows = (compareFaceScoreRowsData ?? []) as CompareFaceScoreRow[];
  const compareFaceScoreConsentIds = Array.from(new Set(compareFaceScoreRows.map((row) => row.consent_id)));
  const compareFaceScoreHeadshotMaterializationIdByConsentId = await loadCurrentHeadshotMaterializationIds(
    input.supabase,
    input.tenantId,
    input.projectId,
    compareFaceScoreConsentIds,
  );
  const compareFaceScoreRowsByConsentId = new Map(
    compareFaceScoreRows
      .filter(
        (row) =>
          compareFaceScoreHeadshotMaterializationIdByConsentId.get(row.consent_id) === row.headshot_materialization_id,
      )
      .map((row) => [row.consent_id, row] as const),
  );

  const { data: compareRowsData, error: compareRowsError } = await input.supabase
    .from("asset_consent_face_compares")
    .select(
      "consent_id, headshot_materialization_id, asset_materialization_id, winning_asset_face_id, winning_similarity, compare_status, compare_version",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("asset_materialization_id", current.materialization.id)
    .eq("compare_version", getAutoMatchCompareVersion())
    .eq("compare_status", "matched")
    .eq("winning_asset_face_id", input.assetFaceId);

  if (compareRowsError) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview face candidates.");
  }

  const compareRows = (compareRowsData ?? []) as CompareCandidateRow[];
  const compareConsentIds = Array.from(new Set(compareRows.map((row) => row.consent_id)));
  const currentHeadshotMaterializationIdByConsentId = await loadCurrentHeadshotMaterializationIds(
    input.supabase,
    input.tenantId,
    input.projectId,
    compareConsentIds,
  );
  const compareRowsByConsentId = new Map(
    compareRows
      .filter(
        (row) =>
          currentHeadshotMaterializationIdByConsentId.get(row.consent_id) === row.headshot_materialization_id &&
          !compareFaceScoreRowsByConsentId.has(row.consent_id),
      )
      .map((row) => [row.consent_id, row] as const),
  );

  const { data: likelyRowsData, error: likelyRowsError } = await input.supabase
    .from("asset_consent_match_candidates")
    .select("consent_id, confidence, last_scored_at, winning_asset_face_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("winning_asset_face_id", input.assetFaceId);

  if (likelyRowsError) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview face candidates.");
  }

  const likelyRows = ((likelyRowsData ?? []) as LikelyCandidateRow[])
    .filter(
      (row) => !compareFaceScoreRowsByConsentId.has(row.consent_id) && !compareRowsByConsentId.has(row.consent_id),
    );

  const { data: consentRowsData, error: consentRowsError } = await input.supabase
    .from("consents")
    .select("id, signed_at, revoked_at, subjects(email, full_name)")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .not("signed_at", "is", null)
    .is("revoked_at", null)
    .order("signed_at", { ascending: false })
    .order("id", { ascending: true });

  if (consentRowsError) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview face candidates.");
  }

  const activeConsents = ((consentRowsData ?? []) as Array<{
    id: string;
    signed_at: string | null;
    revoked_at: string | null;
    subjects: ConsentRelation | ConsentRelation[] | null;
  }>).filter((row) => Boolean(row.signed_at) && !row.revoked_at);
  const activeConsentIds = activeConsents.map((row) => row.id);
  const activeConsentIdSet = new Set(activeConsentIds);
  const rankedCompareCandidates = [
    ...Array.from(compareFaceScoreRowsByConsentId.values())
      .filter((row) => activeConsentIdSet.has(row.consent_id))
      .map((row) => ({
        consentId: row.consent_id,
        similarityScore: toNumericScore(row.similarity),
        scoreSource: "current_compare" as const,
      })),
    ...Array.from(compareRowsByConsentId.values())
      .filter((row) => activeConsentIdSet.has(row.consent_id))
      .map((row) => ({
        consentId: row.consent_id,
        similarityScore: toNumericScore(row.winning_similarity),
        scoreSource: "current_compare" as const,
      })),
  ].sort((left, right) => {
    const rightScore = right.similarityScore ?? -1;
    const leftScore = left.similarityScore ?? -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.consentId.localeCompare(right.consentId);
  });
  const rankedLikelyRows = likelyRows
    .filter((row) => activeConsentIdSet.has(row.consent_id))
    .map((row) => ({
      consentId: row.consent_id,
      similarityScore: toNumericScore(row.confidence),
      scoreSource: "likely_candidate" as const,
      lastScoredAt: row.last_scored_at,
    }));

  const includedConsentIds = new Set<string>();
  const rankedCandidateMeta = new Map<
    string,
    {
      rank: number | null;
      similarityScore: number | null;
      scoreSource: "current_compare" | "likely_candidate" | "unscored";
    }
  >();
  let nextRank = 1;

  const rankedScoredCandidates = [
    ...rankedCompareCandidates.map((row) => ({
      consentId: row.consentId,
      similarityScore: row.similarityScore,
      scoreSource: row.scoreSource,
      lastScoredAt: "",
    })),
    ...rankedLikelyRows,
  ].sort((left, right) => {
    const rightScore = right.similarityScore ?? -1;
    const leftScore = left.similarityScore ?? -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }
    if (left.scoreSource !== right.scoreSource) {
      return left.scoreSource === "current_compare" ? -1 : 1;
    }
    if (right.lastScoredAt !== left.lastScoredAt) {
      return right.lastScoredAt.localeCompare(left.lastScoredAt);
    }

    return left.consentId.localeCompare(right.consentId);
  });

  for (const row of rankedScoredCandidates) {
    if (includedConsentIds.has(row.consentId)) {
      continue;
    }

    rankedCandidateMeta.set(row.consentId, {
      rank: nextRank,
      similarityScore: row.similarityScore,
      scoreSource: row.scoreSource,
    });
    includedConsentIds.add(row.consentId);
    nextRank += 1;
  }

  for (const consentId of activeConsentIds) {
    if (includedConsentIds.has(consentId)) {
      continue;
    }

    rankedCandidateMeta.set(consentId, {
      rank: null,
      similarityScore: null,
      scoreSource: "unscored",
    });
    includedConsentIds.add(consentId);
  }

  const headshotImageMap = await loadHeadshotThumbnailMap(input, Array.from(includedConsentIds));
  const consentSummaryRowsById = new Map(activeConsents.map((row) => [row.id, row] as const));

  return {
    assetId: input.assetId,
    materializationId: current.materialization.id,
    assetFaceId: input.assetFaceId,
    candidates: Array.from(includedConsentIds)
      .map((consentId) => {
        const candidate = consentSummaryRowsById.get(consentId) ?? null;
        const subject = firstRelation(candidate?.subjects);
        const meta = rankedCandidateMeta.get(consentId);
        if (!candidate || !meta) {
          return null;
        }

        return {
          consentId,
          fullName: subject?.full_name?.trim() ?? null,
          email: subject?.email?.trim() ?? null,
          headshotThumbnailUrl: headshotImageMap.thumbnailByConsentId.get(consentId) ?? null,
          rank: meta.rank,
          similarityScore: meta.similarityScore,
          scoreSource: meta.scoreSource,
          currentAssetLink: currentAssetLinkByConsentId.get(consentId) ?? null,
        };
      })
      .filter((row): row is AssetPreviewFaceCandidatesResponse["candidates"][number] => row !== null),
  };
}

export async function getAssetPreviewLinkCandidates(
  input: MatchingScopeInput,
): Promise<AssetPreviewLinkCandidatesResponse> {
  await requirePhotoAsset(input);

  const exactLinkedFaces = await listLinkedFaceOverlaysForAssetIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetIds: [input.assetId],
  });
  const currentAssetLinkByConsentId = new Map(
    exactLinkedFaces
      .filter((overlay) => overlay.assetId === input.assetId)
      .map((overlay) => [
        overlay.consentId,
        { assetFaceId: overlay.assetFaceId, faceRank: overlay.faceRank },
      ] as const),
  );

  const { data, error } = await input.supabase
    .from("consents")
    .select("id, signed_at, revoked_at, subjects(email, full_name)")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .not("signed_at", "is", null)
    .is("revoked_at", null)
    .order("signed_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "consent_candidate_lookup_failed", "Unable to load preview link candidates.");
  }

  const candidates = ((data ?? []) as Array<{
    id: string;
    signed_at: string | null;
    revoked_at: string | null;
    subjects: ConsentRelation | ConsentRelation[] | null;
  }>)
    .filter((row) => Boolean(row.signed_at) && !row.revoked_at);
  const consentIds = candidates.map((row) => row.id);
  const headshotImageMap = await loadHeadshotThumbnailMap(input, consentIds);

  return {
    assetId: input.assetId,
    candidates: candidates.map((candidate) => {
      const subject = firstRelation(candidate.subjects);
      return {
        consentId: candidate.id,
        fullName: subject?.full_name?.trim() ?? null,
        email: subject?.email?.trim() ?? null,
        headshotThumbnailUrl: headshotImageMap.thumbnailByConsentId.get(candidate.id) ?? null,
        currentAssetLink: currentAssetLinkByConsentId.get(candidate.id) ?? null,
      };
    }),
  };
}
