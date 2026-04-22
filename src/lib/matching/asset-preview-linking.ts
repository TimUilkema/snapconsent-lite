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
  loadCurrentBlockedFacesForAsset,
  loadCurrentBlockedFacesForAssets,
  loadCurrentHiddenFacesForAsset,
  loadCurrentHiddenFacesForAssets,
} from "@/lib/matching/photo-face-linking";
import {
  loadProjectFaceAssigneeDisplayMap,
  loadProjectRecurringConsentStateByParticipantIds,
  type ProjectFaceAssigneeDisplaySummary,
} from "@/lib/matching/project-face-assignees";
import {
  loadProjectConsentScopeStatesByConsentIds,
  loadProjectConsentScopeStatesByParticipantIds,
  type ProjectConsentScopeState,
} from "@/lib/consent/project-consent-scope-state";
import { resolveReadyProjectRecurringSource } from "@/lib/matching/project-recurring-sources";
import { loadCurrentWholeAssetLinksForAsset } from "@/lib/matching/whole-asset-linking";
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

type RecurringHeadshotAssetRow = {
  id: string;
  profile_id: string;
  upload_status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type ProjectRecurringParticipantRow = {
  id: string;
  recurring_profile_id: string;
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

type RecurringCompareCandidateRow = {
  project_profile_participant_id: string;
  profile_id: string;
  recurring_headshot_materialization_id: string;
  recurring_selection_face_id: string;
  asset_materialization_id: string;
  winning_asset_face_id: string | null;
  winning_similarity: number | string;
  compare_status: string;
  compare_version: string;
};

type RecurringCompareFaceScoreRow = {
  project_profile_participant_id: string;
  profile_id: string;
  recurring_headshot_materialization_id: string;
  recurring_selection_face_id: string;
  asset_materialization_id: string;
  asset_face_id: string;
  asset_face_rank: number | null;
  similarity: number | string;
  compare_version: string;
};

type RecurringProfileSummaryRow = {
  id: string;
  full_name: string;
  email: string;
};

type CandidateIdentityKind = "project_consent" | "recurring_profile_match";

type AssetPreviewOwnerRecurringSummary = {
  projectProfileParticipantId: string;
  profileId: string | null;
  recurringProfileConsentId: string | null;
  projectConsentState: "signed" | "revoked";
  signedAt: string | null;
  consentVersion: string | null;
  faceMatchOptIn: boolean | null;
  headshotThumbnailUrl: string | null;
  headshotPreviewUrl: string | null;
  scopeStates: ProjectConsentScopeState[];
};

type AssetPreviewOwnerConsentSummary = {
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
  scopeStates: ProjectConsentScopeState[];
};

type AssetPreviewCurrentLink = {
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  recurringProfileConsentId: string | null;
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
  displayName: string | null;
  email: string | null;
  ownerState: "active" | "revoked";
  consent: AssetPreviewOwnerConsentSummary | null;
  recurring: AssetPreviewOwnerRecurringSummary | null;
};

type AssetPreviewFaceCandidate = {
  candidateKey: string;
  identityKind: CandidateIdentityKind;
  assignable: boolean;
  assignmentBlockedReason: null | "project_consent_missing" | "project_consent_pending" | "project_consent_revoked";
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
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  projectConsentState: "missing" | "pending" | "signed" | "revoked" | null;
};

type AssetPreviewWholeAssetLink = AssetPreviewCurrentLink & {
  linkMode: "whole_asset";
};

type AssetPreviewWholeAssetCandidate = {
  candidateKey: string;
  identityKind: CandidateIdentityKind;
  assignable: boolean;
  assignmentBlockedReason: null | "project_consent_missing" | "project_consent_pending" | "project_consent_revoked";
  fullName: string | null;
  email: string | null;
  headshotThumbnailUrl: string | null;
  currentExactFaceLink: {
    assetFaceId: string;
    faceRank: number | null;
  } | null;
  currentWholeAssetLink: {
    projectFaceAssigneeId: string;
  } | null;
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  projectConsentState: "missing" | "pending" | "signed" | "revoked" | null;
};

function buildAssigneeCandidateKey(input: {
  identityKind: CandidateIdentityKind;
  consentId?: string | null;
  projectProfileParticipantId?: string | null;
}) {
  if (input.identityKind === "project_consent") {
    return `consent:${input.consentId ?? ""}`;
  }

  return `participant:${input.projectProfileParticipantId ?? ""}`;
}

function toRecurringBlockedReason(state: "missing" | "pending" | "signed" | "revoked") {
  switch (state) {
    case "missing":
      return "project_consent_missing" as const;
    case "pending":
      return "project_consent_pending" as const;
    case "revoked":
      return "project_consent_revoked" as const;
    default:
      return null;
  }
}

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

async function requirePreviewableAsset(input: MatchingScopeInput) {
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
  if (
    !asset ||
    (asset.asset_type !== "photo" && asset.asset_type !== "video") ||
    asset.status !== "uploaded" ||
    asset.archived_at
  ) {
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
      fallback: "original",
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

async function loadRecurringHeadshotThumbnailMap(input: MatchingScopeInput, profileIds: string[]) {
  const thumbnailByProfileId = new Map<string, string | null>();
  const previewByProfileId = new Map<string, string | null>();
  const uniqueProfileIds = Array.from(new Set(profileIds));
  if (uniqueProfileIds.length === 0) {
    return {
      thumbnailByProfileId,
      previewByProfileId,
    };
  }

  const { data, error } = await input.supabase
    .from("recurring_profile_headshots")
    .select("id, profile_id, upload_status, storage_bucket, storage_path")
    .eq("tenant_id", input.tenantId)
    .is("superseded_at", null)
    .eq("upload_status", "uploaded")
    .in("profile_id", uniqueProfileIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "headshot_lookup_failed", "Unable to load recurring profile headshots.");
  }

  const latestHeadshotByProfileId = new Map<string, RecurringHeadshotAssetRow>();
  for (const row of (data ?? []) as RecurringHeadshotAssetRow[]) {
    if (!latestHeadshotByProfileId.has(row.profile_id)) {
      latestHeadshotByProfileId.set(row.profile_id, row);
    }
  }

  const signedUrls = await Promise.all(
    Array.from(latestHeadshotByProfileId.entries()).map(async ([profileId, headshot]) => {
      if (!headshot.storage_bucket || !headshot.storage_path) {
        return [profileId, null] as const;
      }

      const { data, error } = await input.supabase.storage
        .from(headshot.storage_bucket)
        .createSignedUrl(headshot.storage_path, 60 * 60);

      if (error || !data?.signedUrl) {
        return [profileId, null] as const;
      }

      return [
        profileId,
        resolveLoopbackStorageUrlForHostHeader(data.signedUrl, input.requestHostHeader),
      ] as const;
    }),
  );

  for (const [profileId, signedUrl] of signedUrls) {
    thumbnailByProfileId.set(profileId, signedUrl);
    previewByProfileId.set(profileId, signedUrl);
  }

  return {
    thumbnailByProfileId,
    previewByProfileId,
  };
}

async function loadProjectRecurringParticipants(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("project_profile_participants")
    .select("id, recurring_profile_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load recurring preview details.");
  }

  return (data ?? []) as ProjectRecurringParticipantRow[];
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

async function loadRecurringProfileSummaryMap(
  supabase: SupabaseClient,
  tenantId: string,
  profileIds: string[],
) {
  const uniqueProfileIds = Array.from(new Set(profileIds));
  const map = new Map<string, RecurringProfileSummaryRow>();
  if (uniqueProfileIds.length === 0) {
    return map;
  }

  const { data, error } = await supabase
    .from("recurring_profiles")
    .select("id, full_name, email")
    .eq("tenant_id", tenantId)
    .in("id", uniqueProfileIds);

  if (error) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load recurring preview details.");
  }

  for (const row of (data ?? []) as RecurringProfileSummaryRow[]) {
    map.set(row.id, row);
  }

  return map;
}

async function loadCurrentReadyRecurringSourceMap(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  participantIds: string[];
}) {
  const uniqueParticipantIds = Array.from(new Set(input.participantIds));
  const entries = await Promise.all(
    uniqueParticipantIds.map(async (participantId) => [
      participantId,
      await resolveReadyProjectRecurringSource(input.supabase, {
        tenantId: input.tenantId,
        projectId: input.projectId,
        projectProfileParticipantId: participantId,
      }),
    ] as const),
  );

  return new Map(entries);
}

export type AssetPreviewLinkedFacesResponse = {
  assetId: string;
  linkedFaces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    faceThumbnailUrl: string | null;
    currentLink: AssetPreviewCurrentLink;
  }>;
};

export type AssetPreviewFacesResponse = {
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  activeLinkedFaceCount: number;
  wholeAssetLinkCount: number;
  hiddenFaceCount: number;
  wholeAssetLinks: AssetPreviewWholeAssetLink[];
  faces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceSource: "detector" | "manual";
    faceBoxNormalized: Record<string, number | null> | null;
    faceThumbnailUrl: string | null;
    detectionProbability: number | null;
    faceState: "linked_manual" | "linked_auto" | "unlinked" | "hidden" | "blocked";
    hiddenAt: string | null;
    blockedAt: string | null;
    blockedReason: "no_consent" | null;
    currentLink: AssetPreviewCurrentLink | null;
  }>;
};

export type AssetPreviewWholeAssetLinksResponse = {
  assetId: string;
  wholeAssetLinkCount: number;
  wholeAssetLinks: AssetPreviewWholeAssetLink[];
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
  candidates: AssetPreviewFaceCandidate[];
};

export type AssetPreviewWholeAssetCandidatesResponse = {
  assetId: string;
  candidates: AssetPreviewWholeAssetCandidate[];
};

export type AssetReviewStatus = "pending" | "needs_review" | "blocked" | "resolved";

export type AssetReviewSummary = {
  assetId: string;
  reviewStatus: AssetReviewStatus;
  unresolvedFaceCount: number;
  blockedFaceCount: number;
  firstNeedsReviewFaceId: string | null;
};

export function buildPendingAssetReviewSummary(assetId: string): AssetReviewSummary {
  return {
    assetId,
    reviewStatus: "pending",
    unresolvedFaceCount: 0,
    blockedFaceCount: 0,
    firstNeedsReviewFaceId: null,
  };
}

export function deriveAssetReviewSummaryForFaces(input: {
  assetId: string;
  faceIdsInRankOrder: string[];
  hiddenFaceIds: Set<string>;
  blockedFaceIds: Set<string>;
  linkedFaceIds: Set<string>;
}): AssetReviewSummary {
  let unresolvedFaceCount = 0;
  let blockedFaceCount = 0;
  let firstNeedsReviewFaceId: string | null = null;

  input.faceIdsInRankOrder.forEach((faceId) => {
    if (input.hiddenFaceIds.has(faceId)) {
      return;
    }

    if (input.blockedFaceIds.has(faceId)) {
      blockedFaceCount += 1;
      return;
    }

    if (input.linkedFaceIds.has(faceId)) {
      return;
    }

    unresolvedFaceCount += 1;
    if (!firstNeedsReviewFaceId) {
      firstNeedsReviewFaceId = faceId;
    }
  });

  return {
    assetId: input.assetId,
    reviewStatus: unresolvedFaceCount > 0 ? "needs_review" : blockedFaceCount > 0 ? "blocked" : "resolved",
    unresolvedFaceCount,
    blockedFaceCount,
    firstNeedsReviewFaceId,
  };
}

type AssetFaceMaterializationSummaryRow = {
  id: string;
  asset_id: string;
  face_count: number;
  materialized_at: string;
};

type AssetFaceMaterializationFaceSummaryRow = {
  id: string;
  asset_id: string;
  materialization_id: string;
  face_rank: number;
  face_source: "detector" | "manual";
};

export async function getAssetReviewSummaries(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetIds: string[];
}): Promise<Map<string, AssetReviewSummary>> {
  const uniqueAssetIds = Array.from(new Set(input.assetIds));
  const summaryByAssetId = new Map<string, AssetReviewSummary>(
    uniqueAssetIds.map((assetId) => [assetId, buildPendingAssetReviewSummary(assetId)]),
  );

  if (uniqueAssetIds.length === 0) {
    return summaryByAssetId;
  }

  const materializationRows = await runChunkedRead(uniqueAssetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_face_materializations")
      .select("id, asset_id, face_count, materialized_at")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("materializer_version", getAutoMatchMaterializerVersion())
      .in("asset_id", assetIdChunk)
      .order("materialized_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "asset_review_summary_lookup_failed", "Unable to load asset face materializations.");
    }

    return (data as AssetFaceMaterializationSummaryRow[] | null) ?? [];
  });

  const currentMaterializationByAssetId = new Map<string, AssetFaceMaterializationSummaryRow>();
  materializationRows.forEach((row) => {
    if (!currentMaterializationByAssetId.has(row.asset_id)) {
      currentMaterializationByAssetId.set(row.asset_id, row);
    }
  });

  const currentMaterializationIdByAssetId = new Map(
    Array.from(currentMaterializationByAssetId.entries()).map(([assetId, row]) => [assetId, row.id] as const),
  );
  const materializationIds = Array.from(currentMaterializationIdByAssetId.values());

  const faceRows =
    materializationIds.length > 0
      ? await runChunkedRead(materializationIds, async (materializationIdChunk) => {
          const { data, error } = await input.supabase
            .from("asset_face_materialization_faces")
            .select("id, asset_id, materialization_id, face_rank, face_source")
            .eq("tenant_id", input.tenantId)
            .eq("project_id", input.projectId)
            .in("materialization_id", materializationIdChunk)
            .order("face_rank", { ascending: true });

          if (error) {
            throw new HttpError(500, "asset_review_summary_lookup_failed", "Unable to load asset face review state.");
          }

          return (data as AssetFaceMaterializationFaceSummaryRow[] | null) ?? [];
        })
      : [];

  const [hiddenFaces, blockedFaces, overlays] = await Promise.all([
    loadCurrentHiddenFacesForAssets(
      input.supabase,
      input.tenantId,
      input.projectId,
      uniqueAssetIds,
      currentMaterializationIdByAssetId,
    ),
    loadCurrentBlockedFacesForAssets(
      input.supabase,
      input.tenantId,
      input.projectId,
      uniqueAssetIds,
      currentMaterializationIdByAssetId,
    ),
    listLinkedFaceOverlaysForAssetIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetIds: uniqueAssetIds,
    }),
  ]);

  const hiddenFaceIds = new Set(hiddenFaces.map((row) => row.asset_face_id));
  const blockedFaceIds = new Set(blockedFaces.map((row) => row.asset_face_id));
  const linkedFaceIds = new Set(overlays.map((overlay) => overlay.assetFaceId));
  const facesByAssetId = new Map<string, AssetFaceMaterializationFaceSummaryRow[]>();

  faceRows.forEach((row) => {
    const currentFaces = facesByAssetId.get(row.asset_id) ?? [];
    currentFaces.push(row);
    facesByAssetId.set(row.asset_id, currentFaces);
  });

  uniqueAssetIds.forEach((assetId) => {
    if (!currentMaterializationIdByAssetId.has(assetId)) {
      return;
    }

    const faceIdsInRankOrder = (facesByAssetId.get(assetId) ?? [])
      .slice()
      .sort((left, right) => left.face_rank - right.face_rank)
      .map((face) => face.id);

    summaryByAssetId.set(
      assetId,
      deriveAssetReviewSummaryForFaces({
        assetId,
        faceIdsInRankOrder,
        hiddenFaceIds,
        blockedFaceIds,
        linkedFaceIds,
      }),
    );
  });

  return summaryByAssetId;
}

export async function getAssetPreviewLinkedFaces(
  input: MatchingScopeInput,
): Promise<AssetPreviewLinkedFacesResponse> {
  const preview = await getAssetPreviewFaces(input);
  const linkedPreviewFaces = preview.faces.filter(
    (
      face,
    ): face is AssetPreviewFacesResponse["faces"][number] & {
      currentLink: NonNullable<AssetPreviewFacesResponse["faces"][number]["currentLink"]>;
    } => Boolean(face.currentLink),
  );

  return {
    assetId: preview.assetId,
    linkedFaces: linkedPreviewFaces.map((face) => ({
      assetFaceId: face.assetFaceId,
      faceRank: face.faceRank,
      faceBoxNormalized: face.faceBoxNormalized,
      faceThumbnailUrl: face.faceThumbnailUrl,
      currentLink: face.currentLink,
    })),
  };
}

function buildAssetPreviewCurrentLink(input: {
  projectId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  projectFaceAssigneeId: string;
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  recurringProfileConsentId: string | null;
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
  assigneeDisplay: ProjectFaceAssigneeDisplaySummary | null;
  consentSummaryMap: Map<string, ConsentRow>;
  headshotImageMap: Awaited<ReturnType<typeof loadHeadshotThumbnailMap>>;
  recurringHeadshotImageMap: Awaited<ReturnType<typeof loadRecurringHeadshotThumbnailMap>>;
  scopeStatesByConsentId: Map<string, ProjectConsentScopeState[]>;
  scopeStatesByParticipantId: Map<string, ProjectConsentScopeState[]>;
}) {
  const consent =
    input.consentId ? input.consentSummaryMap.get(input.consentId) ?? null : null;
  const subject = firstRelation(consent?.subjects);

  return {
    projectFaceAssigneeId: input.projectFaceAssigneeId,
    identityKind: input.identityKind,
    consentId: input.consentId,
    projectProfileParticipantId: input.projectProfileParticipantId,
    profileId: input.profileId,
    recurringProfileConsentId: input.recurringProfileConsentId,
    linkSource: input.linkSource,
    matchConfidence: input.matchConfidence,
    displayName:
      input.assigneeDisplay?.fullName ?? subject?.full_name?.trim() ?? input.assigneeDisplay?.email ?? null,
    email: input.assigneeDisplay?.email ?? subject?.email?.trim() ?? null,
    ownerState: input.assigneeDisplay?.status ?? "active",
    consent:
      input.identityKind === "project_consent" && input.consentId
        ? {
            consentId: input.consentId,
            fullName: subject?.full_name?.trim() ?? null,
            email: subject?.email?.trim() ?? null,
            status: consent?.revoked_at ? "revoked" : "active",
            signedAt: consent?.signed_at ?? null,
            consentVersion: consent?.consent_version ?? null,
            faceMatchOptIn:
              typeof consent?.face_match_opt_in === "boolean" ? consent.face_match_opt_in : null,
            structuredSnapshotSummary: summarizeStructuredSnapshot(consent?.structured_fields_snapshot ?? null),
            headshotThumbnailUrl: input.headshotImageMap.thumbnailByConsentId.get(input.consentId) ?? null,
            headshotPreviewUrl: input.headshotImageMap.previewByConsentId.get(input.consentId) ?? null,
            goToConsentHref: buildConsentHref(input.projectId, input.consentId),
            scopeStates: input.scopeStatesByConsentId.get(input.consentId) ?? [],
          }
        : null,
    recurring:
      input.identityKind === "project_recurring_consent" && input.projectProfileParticipantId
        ? {
            projectProfileParticipantId: input.projectProfileParticipantId,
            profileId: input.profileId,
            recurringProfileConsentId: input.recurringProfileConsentId,
            projectConsentState: input.assigneeDisplay?.status === "revoked" ? "revoked" : "signed",
            signedAt: input.assigneeDisplay?.signedAt ?? null,
            consentVersion: input.assigneeDisplay?.consentVersion ?? null,
            faceMatchOptIn: input.assigneeDisplay?.faceMatchOptIn ?? null,
            headshotThumbnailUrl:
              input.profileId ? input.recurringHeadshotImageMap.thumbnailByProfileId.get(input.profileId) ?? null : null,
            headshotPreviewUrl:
              input.profileId ? input.recurringHeadshotImageMap.previewByProfileId.get(input.profileId) ?? null : null,
            scopeStates:
              input.scopeStatesByParticipantId.get(input.projectProfileParticipantId) ?? [],
          }
        : null,
  } satisfies AssetPreviewCurrentLink;
}

async function loadAssetPreviewWholeAssetData(input: MatchingScopeInput) {
  const rows = await loadCurrentWholeAssetLinksForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });
  const consentIds = Array.from(
    new Set(rows.map((link) => link.consent_id).filter((value): value is string => Boolean(value))),
  );
  const recurringProfileIds = Array.from(
    new Set(rows.map((link) => link.profile_id).filter((value): value is string => Boolean(value))),
  );
  const recurringParticipantIds = Array.from(
    new Set(
      rows
        .map((link) => link.project_profile_participant_id)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [
    assigneeDisplayMap,
    consentSummaryMap,
    headshotImageMap,
    recurringHeadshotImageMap,
    scopeStatesByConsentId,
    scopeStatesByParticipantId,
  ] = await Promise.all([
    loadProjectFaceAssigneeDisplayMap({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assigneeIds: rows.map((link) => link.project_face_assignee_id),
    }),
    loadConsentSummaryMap(input.supabase, input.tenantId, input.projectId, consentIds),
    loadHeadshotThumbnailMap(input, consentIds),
    loadRecurringHeadshotThumbnailMap(input, recurringProfileIds),
    loadProjectConsentScopeStatesByConsentIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentIds,
    }),
    loadProjectConsentScopeStatesByParticipantIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantIds: recurringParticipantIds,
    }),
  ]);
  const wholeAssetLinks = rows
    .map((link) => {
      const assigneeDisplay = assigneeDisplayMap.get(link.project_face_assignee_id) ?? null;
      return {
        ...buildAssetPreviewCurrentLink({
          projectId: input.projectId,
          identityKind: link.identity_kind,
          projectFaceAssigneeId: link.project_face_assignee_id,
          consentId: link.consent_id,
          projectProfileParticipantId: link.project_profile_participant_id,
          profileId: link.profile_id,
          recurringProfileConsentId: link.recurring_profile_consent_id,
          linkSource: "manual",
          matchConfidence: null,
          assigneeDisplay,
          consentSummaryMap,
          headshotImageMap,
          recurringHeadshotImageMap,
          scopeStatesByConsentId,
          scopeStatesByParticipantId,
        }),
        linkMode: "whole_asset" as const,
      };
    })
    .sort((left, right) => left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId));

  return {
    rows,
    response: {
      assetId: input.assetId,
      wholeAssetLinkCount: wholeAssetLinks.length,
      wholeAssetLinks,
    } satisfies AssetPreviewWholeAssetLinksResponse,
  };
}

export async function getAssetPreviewWholeAssetLinks(
  input: MatchingScopeInput,
): Promise<AssetPreviewWholeAssetLinksResponse> {
  await requirePreviewableAsset(input);
  const wholeAssetData = await loadAssetPreviewWholeAssetData(input);
  return wholeAssetData.response;
}

export async function getAssetPreviewFaces(
  input: MatchingScopeInput,
): Promise<AssetPreviewFacesResponse> {
  await requirePhotoAsset(input);

  const [current, wholeAssetData] = await Promise.all([
    loadCurrentAssetFaceMaterialization(
      input.supabase,
      input.tenantId,
      input.projectId,
      input.assetId,
      getAutoMatchMaterializerVersion(),
      { includeFaces: true },
    ),
    loadAssetPreviewWholeAssetData(input),
  ]);
  const currentWholeAssetLinks = wholeAssetData.rows;
  const previewWholeAssetLinks = wholeAssetData.response.wholeAssetLinks;

  if (!current) {
    return {
      assetId: input.assetId,
      materializationId: null,
      detectedFaceCount: 0,
      activeLinkedFaceCount: 0,
      wholeAssetLinkCount: wholeAssetData.response.wholeAssetLinkCount,
      hiddenFaceCount: 0,
      wholeAssetLinks: previewWholeAssetLinks,
      faces: [],
    };
  }

  const [hiddenFaces, blockedFaces, overlays] = await Promise.all([
    loadCurrentHiddenFacesForAsset({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
    }),
    loadCurrentBlockedFacesForAsset({
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
  const blockedFaceById = new Map(blockedFaces.map((row) => [row.asset_face_id, row] as const));
  const exactConsentIds = Array.from(
    new Set(
      [
        ...exactLinkedFaces.map((overlay) => overlay.consentId),
        ...currentWholeAssetLinks.map((link) => link.consent_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const exactRecurringProfileIds = Array.from(
    new Set(
      [
        ...exactLinkedFaces.map((overlay) => overlay.profileId),
        ...currentWholeAssetLinks.map((link) => link.profile_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const exactParticipantIds = Array.from(
    new Set(
      [
        ...exactLinkedFaces.map((overlay) => overlay.projectProfileParticipantId),
        ...currentWholeAssetLinks.map((link) => link.project_profile_participant_id),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const faceIds = Array.from(new Set(current.faces.map((face) => face.id)));
  const [
    exactAssigneeDisplayMap,
    exactConsentSummaryMap,
    faceDerivatives,
    exactHeadshotImageMap,
    exactRecurringHeadshotImageMap,
    scopeStatesByConsentId,
    scopeStatesByParticipantId,
  ] = await Promise.all([
    loadProjectFaceAssigneeDisplayMap({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assigneeIds: [
        ...exactLinkedFaces.map((overlay) => overlay.projectFaceAssigneeId),
        ...currentWholeAssetLinks.map((link) => link.project_face_assignee_id),
      ],
    }),
    loadConsentSummaryMap(input.supabase, input.tenantId, input.projectId, exactConsentIds),
    loadFaceImageDerivativesForFaceIds(input.supabase, input.tenantId, input.projectId, faceIds),
    loadHeadshotThumbnailMap(input, exactConsentIds),
    loadRecurringHeadshotThumbnailMap(input, exactRecurringProfileIds),
    loadProjectConsentScopeStatesByConsentIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentIds: exactConsentIds,
    }),
    loadProjectConsentScopeStatesByParticipantIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantIds: exactParticipantIds,
    }),
  ]);
  const signedFaceDerivativeMap = await signFaceDerivativeUrls(Array.from(faceDerivatives.values()));
  const overlayByFaceId = new Map(exactLinkedFaces.map((overlay) => [overlay.assetFaceId, overlay] as const));

  return {
    assetId: input.assetId,
    materializationId: current.materialization.id,
    detectedFaceCount: current.materialization.face_count,
    activeLinkedFaceCount: exactLinkedFaces.length,
    wholeAssetLinkCount: wholeAssetData.response.wholeAssetLinkCount,
    hiddenFaceCount: hiddenFaces.length,
    wholeAssetLinks: previewWholeAssetLinks,
    faces: current.faces
      .slice()
      .sort((left, right) => left.face_rank - right.face_rank)
      .map((face) => {
        const hiddenFace = hiddenFaceById.get(face.id) ?? null;
        const blockedFace = hiddenFace ? null : blockedFaceById.get(face.id) ?? null;
        const overlay = hiddenFace ? null : overlayByFaceId.get(face.id) ?? null;
        const assigneeDisplay = overlay ? exactAssigneeDisplayMap.get(overlay.projectFaceAssigneeId) ?? null : null;
        const signedFaceUrl = signedFaceDerivativeMap.get(face.id) ?? null;

        return {
          assetFaceId: face.id,
          faceRank: face.face_rank,
          faceSource: face.face_source,
          faceBoxNormalized: (face.face_box_normalized as Record<string, number | null> | null) ?? null,
          faceThumbnailUrl: signedFaceUrl
            ? resolveLoopbackStorageUrlForHostHeader(signedFaceUrl, input.requestHostHeader)
            : null,
          detectionProbability: face.detection_probability ?? null,
          faceState: hiddenFace
            ? "hidden"
            : blockedFace
              ? "blocked"
            : overlay?.linkSource === "manual"
              ? "linked_manual"
              : overlay?.linkSource === "auto"
                ? "linked_auto"
                : "unlinked",
          hiddenAt: hiddenFace?.hidden_at ?? null,
          blockedAt: blockedFace?.blocked_at ?? null,
          blockedReason: blockedFace?.reason ?? null,
          currentLink: overlay
            ? buildAssetPreviewCurrentLink({
                projectId: input.projectId,
                identityKind: overlay.identityKind,
                projectFaceAssigneeId: overlay.projectFaceAssigneeId,
                consentId: overlay.consentId,
                projectProfileParticipantId: overlay.projectProfileParticipantId,
                profileId: overlay.profileId,
                recurringProfileConsentId: overlay.recurringProfileConsentId,
                linkSource: overlay.linkSource,
                matchConfidence: overlay.matchConfidence,
                assigneeDisplay,
                consentSummaryMap: exactConsentSummaryMap,
                headshotImageMap: exactHeadshotImageMap,
                recurringHeadshotImageMap: exactRecurringHeadshotImageMap,
                scopeStatesByConsentId,
                scopeStatesByParticipantId,
              })
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
  const currentAssetLinkByCandidateKey = new Map<string, { assetFaceId: string; faceRank: number | null }>();
  currentAssetLinks.forEach((overlay) => {
    if (overlay.identityKind === "project_consent" && overlay.consentId) {
      currentAssetLinkByCandidateKey.set(
        buildAssigneeCandidateKey({
          identityKind: "project_consent",
          consentId: overlay.consentId,
        }),
        { assetFaceId: overlay.assetFaceId, faceRank: overlay.faceRank },
      );
      return;
    }

    if (overlay.identityKind === "project_recurring_consent" && overlay.projectProfileParticipantId) {
      currentAssetLinkByCandidateKey.set(
        buildAssigneeCandidateKey({
          identityKind: "recurring_profile_match",
          projectProfileParticipantId: overlay.projectProfileParticipantId,
        }),
        { assetFaceId: overlay.assetFaceId, faceRank: overlay.faceRank },
      );
    }
  });

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

  const { data: recurringCompareFaceScoreRowsData, error: recurringCompareFaceScoreRowsError } = await input.supabase
    .from("asset_project_profile_face_compare_scores")
    .select(
      "project_profile_participant_id, profile_id, recurring_headshot_materialization_id, recurring_selection_face_id, asset_materialization_id, asset_face_id, asset_face_rank, similarity, compare_version",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("asset_materialization_id", current.materialization.id)
    .eq("asset_face_id", input.assetFaceId)
    .eq("compare_version", getAutoMatchCompareVersion());

  if (recurringCompareFaceScoreRowsError) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview face candidates.");
  }

  const recurringCompareFaceScoreRows = (recurringCompareFaceScoreRowsData ?? []) as RecurringCompareFaceScoreRow[];

  const { data: recurringCompareRowsData, error: recurringCompareRowsError } = await input.supabase
    .from("asset_project_profile_face_compares")
    .select(
      "project_profile_participant_id, profile_id, recurring_headshot_materialization_id, recurring_selection_face_id, asset_materialization_id, winning_asset_face_id, winning_similarity, compare_status, compare_version",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("asset_materialization_id", current.materialization.id)
    .eq("compare_version", getAutoMatchCompareVersion())
    .eq("compare_status", "matched")
    .eq("winning_asset_face_id", input.assetFaceId);

  if (recurringCompareRowsError) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview face candidates.");
  }

  const recurringCompareRows = (recurringCompareRowsData ?? []) as RecurringCompareCandidateRow[];
  const projectRecurringParticipants = await loadProjectRecurringParticipants({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });
  const recurringParticipantById = new Map(projectRecurringParticipants.map((row) => [row.id, row] as const));
  const evidenceRecurringParticipantIds = Array.from(
    new Set(
      [
        ...recurringCompareFaceScoreRows.map((row) => row.project_profile_participant_id),
        ...recurringCompareRows.map((row) => row.project_profile_participant_id),
      ],
    ),
  );
  const [readyRecurringSourceMap, recurringConsentStateByParticipantId] = await Promise.all([
    loadCurrentReadyRecurringSourceMap({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantIds: evidenceRecurringParticipantIds,
    }),
    loadProjectRecurringConsentStateByParticipantIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantIds: Array.from(
        new Set([...projectRecurringParticipants.map((row) => row.id), ...evidenceRecurringParticipantIds]),
      ),
    }),
  ]);
  const recurringCompareFaceScoreRowsByParticipantId = new Map(
    recurringCompareFaceScoreRows
      .filter((row) => {
        const readySource = readyRecurringSourceMap.get(row.project_profile_participant_id) ?? null;
        return Boolean(
          readySource
          && readySource.recurringHeadshotMaterializationId === row.recurring_headshot_materialization_id
          && readySource.selectionFaceId === row.recurring_selection_face_id,
        );
      })
      .map((row) => [row.project_profile_participant_id, row] as const),
  );
  const recurringCompareRowsByParticipantId = new Map(
    recurringCompareRows
      .filter((row) => {
        const readySource = readyRecurringSourceMap.get(row.project_profile_participant_id) ?? null;
        return Boolean(
          readySource
          && readySource.recurringHeadshotMaterializationId === row.recurring_headshot_materialization_id
          && readySource.selectionFaceId === row.recurring_selection_face_id
          && !recurringCompareFaceScoreRowsByParticipantId.has(row.project_profile_participant_id),
        );
      })
      .map((row) => [row.project_profile_participant_id, row] as const),
  );
  const recurringParticipantIds = Array.from(
    new Set([
      ...evidenceRecurringParticipantIds,
      ...projectRecurringParticipants
        .filter((row) => recurringConsentStateByParticipantId.get(row.id)?.state === "signed")
        .map((row) => row.id),
    ]),
  );

  const { data: consentRowsData, error: consentRowsError } = await input.supabase
    .from("consents")
    .select("id, signed_at, revoked_at, subjects(email, full_name)")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .not("signed_at", "is", null)
    .is("revoked_at", null)
    .is("superseded_at", null)
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
  const recurringProfileSummaryMap = await loadRecurringProfileSummaryMap(
    input.supabase,
    input.tenantId,
    recurringParticipantIds
      .map((participantId) => {
        const row =
          recurringCompareFaceScoreRowsByParticipantId.get(participantId)
          ?? recurringCompareRowsByParticipantId.get(participantId)
          ?? null;
        return row?.profile_id ?? recurringParticipantById.get(participantId)?.recurring_profile_id ?? null;
      })
      .filter((value): value is string => Boolean(value)),
  );
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
      candidateKey: buildAssigneeCandidateKey({
        identityKind: "project_consent",
        consentId: row.consent_id,
      }),
      similarityScore: toNumericScore(row.confidence),
      scoreSource: "likely_candidate" as const,
      lastScoredAt: row.last_scored_at,
    }));

  const rankedRecurringCandidates = [
    ...Array.from(recurringCompareFaceScoreRowsByParticipantId.values()).map((row) => ({
      projectProfileParticipantId: row.project_profile_participant_id,
      profileId: row.profile_id,
      similarityScore: toNumericScore(row.similarity),
      scoreSource: "current_compare" as const,
    })),
    ...Array.from(recurringCompareRowsByParticipantId.values()).map((row) => ({
      projectProfileParticipantId: row.project_profile_participant_id,
      profileId: row.profile_id,
      similarityScore: toNumericScore(row.winning_similarity),
      scoreSource: "current_compare" as const,
    })),
  ].sort((left, right) => {
    const rightScore = right.similarityScore ?? -1;
    const leftScore = left.similarityScore ?? -1;
    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return left.projectProfileParticipantId.localeCompare(right.projectProfileParticipantId);
  });

  const includedCandidateKeys = new Set<string>();
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
      candidateKey: buildAssigneeCandidateKey({
        identityKind: "project_consent",
        consentId: row.consentId,
      }),
      similarityScore: row.similarityScore,
      scoreSource: row.scoreSource,
      lastScoredAt: "",
    })),
    ...rankedLikelyRows,
    ...rankedRecurringCandidates.map((row) => ({
      candidateKey: buildAssigneeCandidateKey({
        identityKind: "recurring_profile_match",
        projectProfileParticipantId: row.projectProfileParticipantId,
      }),
      similarityScore: row.similarityScore,
      scoreSource: row.scoreSource,
      lastScoredAt: "",
    })),
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

    return left.candidateKey.localeCompare(right.candidateKey);
  });

  for (const row of rankedScoredCandidates) {
    if (includedCandidateKeys.has(row.candidateKey)) {
      continue;
    }

    rankedCandidateMeta.set(row.candidateKey, {
      rank: nextRank,
      similarityScore: row.similarityScore,
      scoreSource: row.scoreSource,
    });
    includedCandidateKeys.add(row.candidateKey);
    nextRank += 1;
  }

  for (const consentId of activeConsentIds) {
    const candidateKey = buildAssigneeCandidateKey({
      identityKind: "project_consent",
      consentId,
    });
    if (includedCandidateKeys.has(candidateKey)) {
      continue;
    }

    rankedCandidateMeta.set(candidateKey, {
      rank: null,
      similarityScore: null,
      scoreSource: "unscored",
    });
    includedCandidateKeys.add(candidateKey);
  }

  for (const participantId of recurringParticipantIds) {
    const consentState = recurringConsentStateByParticipantId.get(participantId) ?? null;
    if (!consentState || consentState.state !== "signed") {
      continue;
    }

    const candidateKey = buildAssigneeCandidateKey({
      identityKind: "recurring_profile_match",
      projectProfileParticipantId: participantId,
    });
    if (includedCandidateKeys.has(candidateKey)) {
      continue;
    }

    rankedCandidateMeta.set(candidateKey, {
      rank: null,
      similarityScore: null,
      scoreSource: "unscored",
    });
    includedCandidateKeys.add(candidateKey);
  }

  const headshotImageMap = await loadHeadshotThumbnailMap(input, activeConsentIds);
  const recurringHeadshotImageMap = await loadRecurringHeadshotThumbnailMap(
    input,
    recurringParticipantIds
      .map((participantId) => {
        const evidence =
          recurringCompareFaceScoreRowsByParticipantId.get(participantId)
          ?? recurringCompareRowsByParticipantId.get(participantId)
          ?? null;
        return evidence?.profile_id ?? recurringParticipantById.get(participantId)?.recurring_profile_id ?? null;
      })
      .filter((value): value is string => Boolean(value)),
  );
  const consentSummaryRowsById = new Map(activeConsents.map((row) => [row.id, row] as const));

  const candidateRows: Array<AssetPreviewFaceCandidate | null> = [
    ...activeConsentIds.map((consentId) => {
      const candidate = consentSummaryRowsById.get(consentId) ?? null;
      const subject = firstRelation(candidate?.subjects);
      const candidateKey = buildAssigneeCandidateKey({
        identityKind: "project_consent",
        consentId,
      });
      const meta = rankedCandidateMeta.get(candidateKey);
      if (!candidate || !meta) {
        return null;
      }

      return {
        candidateKey,
        identityKind: "project_consent" as const,
        assignable: true,
        assignmentBlockedReason: null,
        fullName: subject?.full_name?.trim() ?? null,
        email: subject?.email?.trim() ?? null,
        headshotThumbnailUrl: headshotImageMap.thumbnailByConsentId.get(consentId) ?? null,
        rank: meta.rank,
        similarityScore: meta.similarityScore,
        scoreSource: meta.scoreSource,
        currentAssetLink: currentAssetLinkByCandidateKey.get(candidateKey) ?? null,
        consentId,
        projectProfileParticipantId: null,
        profileId: null,
        projectConsentState: null,
      };
    }),
    ...recurringParticipantIds.map((participantId) => {
      const evidence =
        recurringCompareFaceScoreRowsByParticipantId.get(participantId)
        ?? recurringCompareRowsByParticipantId.get(participantId)
        ?? null;
      const consentState = recurringConsentStateByParticipantId.get(participantId) ?? null;
      const fallbackParticipant = recurringParticipantById.get(participantId) ?? null;
      const profileId = evidence?.profile_id ?? fallbackParticipant?.recurring_profile_id ?? null;
      if (!consentState || !profileId) {
        return null;
      }

      const candidateKey = buildAssigneeCandidateKey({
        identityKind: "recurring_profile_match",
        projectProfileParticipantId: participantId,
      });
      const meta = rankedCandidateMeta.get(candidateKey);
      if (!meta) {
        return null;
      }

      const profile = recurringProfileSummaryMap.get(profileId) ?? null;
      return {
        candidateKey,
        identityKind: "recurring_profile_match" as const,
        assignable: consentState.state === "signed",
        assignmentBlockedReason: toRecurringBlockedReason(consentState.state),
        fullName: profile?.full_name?.trim() ?? null,
        email: profile?.email?.trim() ?? null,
        headshotThumbnailUrl: recurringHeadshotImageMap.thumbnailByProfileId.get(profileId) ?? null,
        rank: meta.rank,
        similarityScore: meta.similarityScore,
        scoreSource: meta.scoreSource,
        currentAssetLink: currentAssetLinkByCandidateKey.get(candidateKey) ?? null,
        consentId: null,
        projectProfileParticipantId: participantId,
        profileId,
        projectConsentState: consentState.state,
      };
    }),
  ];

  return {
    assetId: input.assetId,
    materializationId: current.materialization.id,
    assetFaceId: input.assetFaceId,
    candidates: candidateRows
      .filter((row): row is AssetPreviewFaceCandidate => row !== null)
      .sort((left, right) => {
        const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER;
        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return left.candidateKey.localeCompare(right.candidateKey);
      }),
  };
}

export async function getAssetPreviewWholeAssetCandidates(
  input: MatchingScopeInput,
): Promise<AssetPreviewWholeAssetCandidatesResponse> {
  await requirePreviewableAsset(input);

  const [exactLinkedFaces, currentWholeAssetLinks, projectRecurringParticipants] = await Promise.all([
    listLinkedFaceOverlaysForAssetIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetIds: [input.assetId],
    }),
    loadCurrentWholeAssetLinksForAsset({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
    }),
    loadProjectRecurringParticipants({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
    }),
  ]);

  const currentExactFaceLinkByCandidateKey = new Map<string, { assetFaceId: string; faceRank: number | null }>();
  exactLinkedFaces.forEach((overlay) => {
    if (overlay.assetId !== input.assetId) {
      return;
    }

    if (overlay.identityKind === "project_consent" && overlay.consentId) {
      currentExactFaceLinkByCandidateKey.set(
        buildAssigneeCandidateKey({
          identityKind: "project_consent",
          consentId: overlay.consentId,
        }),
        { assetFaceId: overlay.assetFaceId, faceRank: overlay.faceRank },
      );
      return;
    }

    if (overlay.identityKind === "project_recurring_consent" && overlay.projectProfileParticipantId) {
      currentExactFaceLinkByCandidateKey.set(
        buildAssigneeCandidateKey({
          identityKind: "recurring_profile_match",
          projectProfileParticipantId: overlay.projectProfileParticipantId,
        }),
        { assetFaceId: overlay.assetFaceId, faceRank: overlay.faceRank },
      );
    }
  });

  const currentWholeAssetLinkByCandidateKey = new Map<string, { projectFaceAssigneeId: string }>();
  currentWholeAssetLinks.forEach((link) => {
    const candidateKey =
      link.identity_kind === "project_consent" && link.consent_id
        ? buildAssigneeCandidateKey({
            identityKind: "project_consent",
            consentId: link.consent_id,
          })
        : link.project_profile_participant_id
          ? buildAssigneeCandidateKey({
              identityKind: "recurring_profile_match",
              projectProfileParticipantId: link.project_profile_participant_id,
            })
          : null;

    if (candidateKey) {
      currentWholeAssetLinkByCandidateKey.set(candidateKey, {
        projectFaceAssigneeId: link.project_face_assignee_id,
      });
    }
  });

  const [recurringConsentStateByParticipantId, consentRowsResponse] = await Promise.all([
    loadProjectRecurringConsentStateByParticipantIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantIds: projectRecurringParticipants.map((row) => row.id),
    }),
    input.supabase
      .from("consents")
      .select("id, signed_at, revoked_at, subjects(email, full_name)")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .not("signed_at", "is", null)
      .is("revoked_at", null)
      .is("superseded_at", null)
      .order("signed_at", { ascending: false })
      .order("id", { ascending: true }),
  ]);

  if (consentRowsResponse.error) {
    throw new HttpError(500, "preview_candidate_lookup_failed", "Unable to load preview whole-asset candidates.");
  }

  const activeConsents = ((consentRowsResponse.data ?? []) as Array<{
    id: string;
    signed_at: string | null;
    revoked_at: string | null;
    subjects: ConsentRelation | ConsentRelation[] | null;
  }>).filter((row) => Boolean(row.signed_at) && !row.revoked_at);
  const recurringProfileSummaryMap = await loadRecurringProfileSummaryMap(
    input.supabase,
    input.tenantId,
    projectRecurringParticipants.map((row) => row.recurring_profile_id),
  );
  const headshotImageMap = await loadHeadshotThumbnailMap(
    input,
    activeConsents.map((row) => row.id),
  );
  const recurringHeadshotImageMap = await loadRecurringHeadshotThumbnailMap(
    input,
    projectRecurringParticipants.map((row) => row.recurring_profile_id),
  );

  const candidates: AssetPreviewWholeAssetCandidate[] = [
    ...activeConsents.map((consent) => {
      const subject = firstRelation(consent.subjects);
      const candidateKey = buildAssigneeCandidateKey({
        identityKind: "project_consent",
        consentId: consent.id,
      });

      return {
        candidateKey,
        identityKind: "project_consent" as const,
        assignable: true,
        assignmentBlockedReason: null,
        fullName: subject?.full_name?.trim() ?? null,
        email: subject?.email?.trim() ?? null,
        headshotThumbnailUrl: headshotImageMap.thumbnailByConsentId.get(consent.id) ?? null,
        currentExactFaceLink: currentExactFaceLinkByCandidateKey.get(candidateKey) ?? null,
        currentWholeAssetLink: currentWholeAssetLinkByCandidateKey.get(candidateKey) ?? null,
        consentId: consent.id,
        projectProfileParticipantId: null,
        profileId: null,
        projectConsentState: null,
      };
    }),
    ...projectRecurringParticipants.map((participant) => {
      const candidateKey = buildAssigneeCandidateKey({
        identityKind: "recurring_profile_match",
        projectProfileParticipantId: participant.id,
      });
      const consentState = recurringConsentStateByParticipantId.get(participant.id) ?? null;
      const profile = recurringProfileSummaryMap.get(participant.recurring_profile_id) ?? null;

      return {
        candidateKey,
        identityKind: "recurring_profile_match" as const,
        assignable:
          consentState?.state === "signed" &&
          !currentExactFaceLinkByCandidateKey.has(candidateKey),
        assignmentBlockedReason: consentState ? toRecurringBlockedReason(consentState.state) : "project_consent_missing",
        fullName: profile?.full_name?.trim() ?? null,
        email: profile?.email?.trim() ?? null,
        headshotThumbnailUrl:
          recurringHeadshotImageMap.thumbnailByProfileId.get(participant.recurring_profile_id) ?? null,
        currentExactFaceLink: currentExactFaceLinkByCandidateKey.get(candidateKey) ?? null,
        currentWholeAssetLink: currentWholeAssetLinkByCandidateKey.get(candidateKey) ?? null,
        consentId: null,
        projectProfileParticipantId: participant.id,
        profileId: participant.recurring_profile_id,
        projectConsentState: consentState?.state ?? "missing",
      };
    }),
  ];

  return {
    assetId: input.assetId,
    candidates: candidates.sort((left, right) => {
      const leftLinked = left.currentWholeAssetLink ? 0 : 1;
      const rightLinked = right.currentWholeAssetLink ? 0 : 1;
      if (leftLinked !== rightLinked) {
        return leftLinked - rightLinked;
      }

      const leftName = left.fullName ?? left.email ?? "";
      const rightName = right.fullName ?? right.email ?? "";
      return leftName.localeCompare(rightName);
    }),
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
      .filter((overlay) => overlay.assetId === input.assetId && Boolean(overlay.consentId))
      .map((overlay) => [
        overlay.consentId as string,
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
    .is("superseded_at", null)
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
