import type { SupabaseClient } from "@supabase/supabase-js";

import {
  loadProjectConsentScopeStatesByConsentIds,
  loadProjectConsentScopeStatesByParticipantIds,
  type ProjectConsentScopeState,
} from "@/lib/consent/project-consent-scope-state";
import { HttpError } from "@/lib/http/errors";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import { loadProjectFaceAssigneeDisplayMap } from "@/lib/matching/project-face-assignees";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";
import type { StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";

import {
  assignAssetExportFilenames,
  assignConsentExportFilenames,
  buildProjectFolderName,
} from "@/lib/project-export/naming";

export const PROJECT_EXPORT_MAX_ASSET_COUNT = 200;
export const PROJECT_EXPORT_MAX_TOTAL_BYTES = 500 * 1024 * 1024;

type SubjectRelation =
  | {
      email: string | null;
      full_name: string | null;
    }
  | Array<{
      email: string | null;
      full_name: string | null;
    }>
  | null;

export type ProjectExportAssetRecord = {
  id: string;
  originalFilename: string;
  contentType: string | null;
  fileSizeBytes: number;
  uploadedAt: string | null;
  createdAt: string;
  storageBucket: string | null;
  storagePath: string | null;
};

export type ProjectExportConsentRecord = {
  id: string;
  subjectId: string;
  inviteId: string | null;
  signedAt: string | null;
  createdAt: string;
  consentText: string;
  consentVersion: string;
  faceMatchOptIn: boolean;
  revokedAt: string | null;
  revokeReason: string | null;
  structuredFieldsSnapshot: Record<string, unknown> | null;
  subjectFullName: string | null;
  subjectEmail: string | null;
  effectiveScopes: ProjectExportScopeStateJson[];
  signedScopes: ProjectExportSignedScopeJson[];
};

export type ProjectExportMaterializationRecord = {
  id: string;
  assetId: string;
  materializerVersion: string;
  provider: string;
  providerMode: string;
  faceCount: number;
  sourceImageWidth: number | null;
  sourceImageHeight: number | null;
  sourceCoordinateSpace: string;
};

export type ProjectExportFaceRecord = {
  id: string;
  assetId: string;
  materializationId: string;
  faceRank: number;
  detectionProbability: number | null;
  faceBox: Record<string, unknown>;
  faceBoxNormalized: Record<string, unknown> | null;
};

export type ProjectExportFaceLinkRecord = {
  assetId: string;
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  consentId: string | null;
  recurringProfileConsentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  displayName: string | null;
  email: string | null;
  currentStatus: "active" | "revoked";
  assetFaceId: string;
  assetMaterializationId: string;
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
  effectiveScopes: ProjectExportScopeStateJson[];
};

export type ProjectExportFallbackRecord = {
  assetId: string;
  consentId: string;
};

export type ProjectExportWholeAssetLinkRecord = {
  assetId: string;
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  consentId: string | null;
  recurringProfileConsentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  displayName: string | null;
  email: string | null;
  currentStatus: "active" | "revoked";
  linkSource: "manual";
  effectiveScopes: ProjectExportScopeStateJson[];
};

export type ProjectExportScopeStateJson = {
  templateKey: string;
  scopeKey: string;
  label: string;
  status: "granted" | "not_granted" | "revoked" | "not_collected";
  signedValueGranted: boolean | null;
  governingSourceKind: "project_consent" | "project_recurring_consent";
  governingConsentId: string | null;
  governingRecurringProfileConsentId: string | null;
  governingTemplateId: string;
  governingTemplateVersion: string;
  governingTemplateVersionNumber: number;
  governingSignedAt: string | null;
  governingRevokedAt: string | null;
  derivedFrom: "effective_view" | "snapshot_fallback";
};

export type ProjectExportSignedScopeJson = {
  templateKey: string;
  scopeKey: string;
  label: string;
  granted: boolean;
  templateId: string;
  templateVersion: string;
  templateVersionNumber: number;
  signedAt: string | null;
};

export type ProjectExportLinkedOwnerScopeJson = {
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  consentId: string | null;
  recurringProfileConsentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  effectiveScopes: ProjectExportScopeStateJson[];
};

export type LoadedProjectExportRecords = {
  assets: ProjectExportAssetRecord[];
  consents: ProjectExportConsentRecord[];
  materializations: ProjectExportMaterializationRecord[];
  faces: ProjectExportFaceRecord[];
  faceLinks: ProjectExportFaceLinkRecord[];
  wholeAssetLinks: ProjectExportWholeAssetLinkRecord[];
  fallbackLinks: ProjectExportFallbackRecord[];
};

export type ProjectExportFaceJson = {
  assetFaceId: string;
  faceRank: number;
  detectionProbability: number | null;
  boxNormalized: Record<string, number | null> | null;
  boxPixels: Record<string, number | null> | null;
  linkedProjectFaceAssigneeId: string | null;
  linkedIdentityKind: "project_consent" | "project_recurring_consent" | null;
  linkedConsentId: string | null;
  linkedRecurringProfile: {
    projectProfileParticipantId: string | null;
    profileId: string | null;
    recurringProfileConsentId: string | null;
    displayName: string | null;
    email: string | null;
    currentStatus: "active" | "revoked";
  } | null;
  linkSource: "manual" | "auto" | null;
  matchConfidence: number | null;
};

export type ProjectExportAssetJson = {
  schemaVersion: 1;
  assetId: string;
  assetType: "photo";
  originalFilename: string;
  exportedFilename: string;
  metadataFilename: string;
  contentType: string | null;
  fileSizeBytes: number;
  uploadedAt: string | null;
  project: {
    projectId: string;
    projectName: string;
  };
  materialization: {
    materializationId: string;
    materializerVersion: string;
    provider: string;
    providerMode: string;
    faceCount: number;
    sourceImageWidth: number | null;
    sourceImageHeight: number | null;
    sourceCoordinateSpace: string;
  } | null;
  detectedFaces: ProjectExportFaceJson[];
  linkedConsents: Array<{
    consentId: string;
    subjectId: string;
    fullName: string | null;
    email: string | null;
    currentStatus: "active" | "revoked";
    revokedAt: string | null;
    revokeReason: string | null;
    linkMode: "face" | "asset_fallback" | "whole_asset";
    linkSource: "manual" | "auto";
    assetFaceId: string | null;
    faceRank: number | null;
    matchConfidence: number | null;
  }>;
  linkedAssignees: Array<{
    projectFaceAssigneeId: string;
    identityKind: "project_consent" | "project_recurring_consent";
    consentId: string | null;
    recurringProfileConsentId: string | null;
    projectProfileParticipantId: string | null;
    profileId: string | null;
    displayName: string | null;
    email: string | null;
    currentStatus: "active" | "revoked";
    linkMode: "face" | "asset_fallback" | "whole_asset";
    linkSource: "manual" | "auto";
    assetFaceId: string | null;
    faceRank: number | null;
    matchConfidence: number | null;
  }>;
  linkedOwnerScopeStates: ProjectExportLinkedOwnerScopeJson[];
};

export type ProjectExportConsentJson = {
  schemaVersion: 1;
  consentId: string;
  project: {
    projectId: string;
    projectName: string;
  };
  subject: {
    subjectId: string;
    fullName: string | null;
    email: string | null;
    source: "current_subject_record";
  };
  inviteId: string | null;
  signedAt: string | null;
  signedSnapshot: {
    consentVersion: string;
    consentText: string;
    structuredFieldsSnapshot: Record<string, unknown> | null;
  };
  faceMatchOptIn: boolean;
  currentStatus: {
    state: "active" | "revoked";
    revokedAt: string | null;
    revokeReason: string | null;
  };
  effectiveScopes: ProjectExportScopeStateJson[];
  signedScopes: ProjectExportSignedScopeJson[];
  linkedAssets: Array<{
    assetId: string;
    originalFilename: string;
    exportedFilename: string;
    linkMode: "face" | "asset_fallback" | "whole_asset";
    linkSource: "manual" | "auto";
    assetFaceId: string | null;
    faceRank: number | null;
    matchConfidence: number | null;
  }>;
};

export type PreparedProjectExport = {
  projectId: string;
  projectName: string;
  projectFolderName: string;
  downloadFilename: string;
  assetCount: number;
  totalAssetBytes: number;
  assets: Array<{
    assetId: string;
    storageBucket: string;
    storagePath: string;
    exportedFilename: string;
    metadataFilename: string;
    metadata: ProjectExportAssetJson;
  }>;
  consents: Array<{
    consentId: string;
    exportedFilename: string;
    data: ProjectExportConsentJson;
  }>;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function toNullableNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeFaceBox(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;

  return {
    x_min: toNullableNumber(record.x_min),
    y_min: toNullableNumber(record.y_min),
    x_max: toNullableNumber(record.x_max),
    y_max: toNullableNumber(record.y_max),
    probability: toNullableNumber(record.probability),
  };
}

function consentState(consent: ProjectExportConsentRecord): "active" | "revoked" {
  return consent.revokedAt ? "revoked" : "active";
}

function toExportScopeState(scopeState: ProjectConsentScopeState): ProjectExportScopeStateJson {
  return {
    templateKey: scopeState.templateKey,
    scopeKey: scopeState.scopeOptionKey,
    label: scopeState.scopeLabel,
    status: scopeState.effectiveStatus,
    signedValueGranted: scopeState.signedValueGranted,
    governingSourceKind: scopeState.governingSourceKind,
    governingConsentId: scopeState.governingConsentId,
    governingRecurringProfileConsentId: scopeState.governingRecurringProfileConsentId,
    governingTemplateId: scopeState.governingTemplateId,
    governingTemplateVersion: scopeState.governingTemplateVersion,
    governingTemplateVersionNumber: scopeState.governingTemplateVersionNumber,
    governingSignedAt: scopeState.governingSignedAt,
    governingRevokedAt: scopeState.governingRevokedAt,
    derivedFrom: scopeState.derivedFrom,
  };
}

function sortSignedScopes(scopes: ProjectExportSignedScopeJson[]) {
  return scopes.slice().sort((left, right) => {
    if (left.templateVersionNumber !== right.templateVersionNumber) {
      return left.templateVersionNumber - right.templateVersionNumber;
    }

    return left.scopeKey.localeCompare(right.scopeKey);
  });
}

function buildSignedScopesFromSnapshot(
  snapshot: StructuredFieldsSnapshot | Record<string, unknown> | null,
  signedAt: string | null,
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [] as ProjectExportSignedScopeJson[];
  }

  const typedSnapshot = snapshot as StructuredFieldsSnapshot;
  const templateKey = typedSnapshot.templateSnapshot?.templateKey ?? null;
  const templateId = typedSnapshot.templateSnapshot?.templateId ?? null;
  const templateVersion = typedSnapshot.templateSnapshot?.version ?? null;
  const templateVersionNumber = typedSnapshot.templateSnapshot?.versionNumber ?? null;
  const scopeOptions = typedSnapshot.definition?.builtInFields?.scope?.options ?? [];
  const selectedOptionKeys =
    typedSnapshot.values?.scope?.valueType === "checkbox_list"
      ? new Set(typedSnapshot.values.scope.selectedOptionKeys)
      : new Set<string>();

  if (!templateKey || !templateId || !templateVersion || !Number.isFinite(templateVersionNumber)) {
    return [] as ProjectExportSignedScopeJson[];
  }

  return sortSignedScopes(
    scopeOptions.map((option) => ({
      templateKey,
      scopeKey: option.optionKey,
      label: option.label,
      granted: selectedOptionKeys.has(option.optionKey),
      templateId,
      templateVersion,
      templateVersionNumber,
      signedAt,
    })),
  );
}

function requireAssetStorage(asset: ProjectExportAssetRecord) {
  if (!asset.storageBucket || !asset.storagePath) {
    throw new HttpError(
      500,
      "project_export_asset_missing",
      "One or more original project assets are missing.",
    );
  }

  return {
    storageBucket: asset.storageBucket,
    storagePath: asset.storagePath,
  };
}

function ensureGuardrails(records: LoadedProjectExportRecords) {
  const assetCount = records.assets.length;
  const totalAssetBytes = records.assets.reduce((sum, asset) => sum + asset.fileSizeBytes, 0);

  if (assetCount > PROJECT_EXPORT_MAX_ASSET_COUNT || totalAssetBytes > PROJECT_EXPORT_MAX_TOTAL_BYTES) {
    throw new HttpError(
      413,
      "project_export_too_large",
      "This project exceeds the synchronous export limit.",
    );
  }
}

export async function loadProjectExportRecords(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data: assetsData, error: assetsError } = await input.supabase
    .from("assets")
    .select("id, original_filename, content_type, file_size_bytes, uploaded_at, created_at, storage_bucket, storage_path")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_type", "photo")
    .eq("status", "uploaded")
    .is("archived_at", null)
    .order("uploaded_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (assetsError) {
    throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
  }

  const assets = ((assetsData ?? []) as Array<{
    id: string;
    original_filename: string;
    content_type: string | null;
    file_size_bytes: number;
    uploaded_at: string | null;
    created_at: string;
    storage_bucket: string | null;
    storage_path: string | null;
  }>).map((asset) => ({
    id: asset.id,
    originalFilename: asset.original_filename,
    contentType: asset.content_type,
    fileSizeBytes: asset.file_size_bytes,
    uploadedAt: asset.uploaded_at,
    createdAt: asset.created_at,
    storageBucket: asset.storage_bucket,
    storagePath: asset.storage_path,
  })) satisfies ProjectExportAssetRecord[];

  const { data: consentsData, error: consentsError } = await input.supabase
    .from("consents")
    .select(
      "id, subject_id, invite_id, signed_at, created_at, consent_text, consent_version, face_match_opt_in, revoked_at, revoke_reason, structured_fields_snapshot, subjects(email, full_name)",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("signed_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (consentsError) {
    throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
  }

  const consents = ((consentsData ?? []) as Array<{
    id: string;
    subject_id: string;
    invite_id: string | null;
    signed_at: string | null;
    created_at: string;
    consent_text: string;
    consent_version: string;
    face_match_opt_in: boolean;
    revoked_at: string | null;
    revoke_reason: string | null;
    structured_fields_snapshot: Record<string, unknown> | null;
    subjects: SubjectRelation;
  }>).map((consent) => {
    const subject = firstRelation(consent.subjects);

    return {
      id: consent.id,
      subjectId: consent.subject_id,
      inviteId: consent.invite_id,
      signedAt: consent.signed_at,
      createdAt: consent.created_at,
      consentText: consent.consent_text,
      consentVersion: consent.consent_version,
      faceMatchOptIn: consent.face_match_opt_in,
      revokedAt: consent.revoked_at,
      revokeReason: consent.revoke_reason,
      structuredFieldsSnapshot: consent.structured_fields_snapshot,
      subjectFullName: subject?.full_name?.trim() ?? null,
      subjectEmail: subject?.email?.trim() ?? null,
    };
  }) satisfies ProjectExportConsentRecord[];

  const assetIds = assets.map((asset) => asset.id);
  if (assetIds.length === 0) {
    return {
      assets,
      consents,
      materializations: [],
      faces: [],
      faceLinks: [],
      wholeAssetLinks: [],
      fallbackLinks: [],
    } satisfies LoadedProjectExportRecords;
  }

  const materializationVersion = getAutoMatchMaterializerVersion();
  const materializations = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_face_materializations")
      .select(
        "id, asset_id, materializer_version, provider, provider_mode, face_count, source_image_width, source_image_height, source_coordinate_space",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      .eq("materializer_version", materializationVersion)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
    }

    return ((data ?? []) as Array<{
      id: string;
      asset_id: string;
      materializer_version: string;
      provider: string;
      provider_mode: string;
      face_count: number;
      source_image_width: number | null;
      source_image_height: number | null;
      source_coordinate_space: string;
    }>).map((materialization) => ({
      id: materialization.id,
      assetId: materialization.asset_id,
      materializerVersion: materialization.materializer_version,
      provider: materialization.provider,
      providerMode: materialization.provider_mode,
      faceCount: materialization.face_count,
      sourceImageWidth: materialization.source_image_width,
      sourceImageHeight: materialization.source_image_height,
      sourceCoordinateSpace: materialization.source_coordinate_space,
    })) satisfies ProjectExportMaterializationRecord[];
  });

  const materializationIds = materializations.map((materialization) => materialization.id);
  const faces = await runChunkedRead(materializationIds, async (materializationIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_face_materialization_faces")
      .select("id, asset_id, materialization_id, face_rank, detection_probability, face_box, face_box_normalized")
      .in("materialization_id", materializationIdChunk)
      .order("face_rank", { ascending: true });

    if (error) {
      throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
    }

    return ((data ?? []) as Array<{
      id: string;
      asset_id: string;
      materialization_id: string;
      face_rank: number;
      detection_probability: number | null;
      face_box: Record<string, unknown>;
      face_box_normalized: Record<string, unknown> | null;
    }>).map((face) => ({
      id: face.id,
      assetId: face.asset_id,
      materializationId: face.materialization_id,
      faceRank: face.face_rank,
      detectionProbability: face.detection_probability,
      faceBox: face.face_box,
      faceBoxNormalized: face.face_box_normalized,
    })) satisfies ProjectExportFaceRecord[];
  });

  const faceLinks = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_face_consent_links")
      .select("asset_id, project_face_assignee_id, consent_id, asset_face_id, asset_materialization_id, link_source, match_confidence")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
    }

    const rawLinks = (data ?? []) as Array<{
      asset_id: string;
      project_face_assignee_id: string;
      consent_id: string | null;
      asset_face_id: string;
      asset_materialization_id: string;
      link_source: "manual" | "auto";
      match_confidence: number | null;
    }>;
    const assigneeDisplayMap = await loadProjectFaceAssigneeDisplayMap({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assigneeIds: rawLinks.map((link) => link.project_face_assignee_id),
    });

    return rawLinks.map((link) => {
      const assignee = assigneeDisplayMap.get(link.project_face_assignee_id) ?? null;
      if (!assignee) {
        throw new HttpError(500, "project_export_failed", "Unable to load project export assignee data.");
      }

      return {
      assetId: link.asset_id,
      projectFaceAssigneeId: assignee.projectFaceAssigneeId,
      identityKind: assignee.identityKind,
      consentId: assignee.consentId,
      recurringProfileConsentId: assignee.recurringProfileConsentId,
      projectProfileParticipantId: assignee.projectProfileParticipantId,
      profileId: assignee.profileId,
      displayName: assignee.fullName,
      email: assignee.email,
      currentStatus: assignee.status,
      assetFaceId: link.asset_face_id,
      assetMaterializationId: link.asset_materialization_id,
      linkSource: link.link_source,
      matchConfidence: link.match_confidence,
      };
    }) satisfies ProjectExportFaceLinkRecord[];
  });

  const wholeAssetLinks = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_assignee_links")
      .select("asset_id, project_face_assignee_id, link_source")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
    }

    const rawLinks = (data ?? []) as Array<{
      asset_id: string;
      project_face_assignee_id: string;
      link_source: "manual";
    }>;
    const assigneeDisplayMap = await loadProjectFaceAssigneeDisplayMap({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assigneeIds: rawLinks.map((link) => link.project_face_assignee_id),
    });

    return rawLinks.map((link) => {
      const assignee = assigneeDisplayMap.get(link.project_face_assignee_id) ?? null;
      if (!assignee) {
        throw new HttpError(500, "project_export_failed", "Unable to load project export assignee data.");
      }

      return {
        assetId: link.asset_id,
        projectFaceAssigneeId: assignee.projectFaceAssigneeId,
        identityKind: assignee.identityKind,
        consentId: assignee.consentId,
        recurringProfileConsentId: assignee.recurringProfileConsentId,
        projectProfileParticipantId: assignee.projectProfileParticipantId,
        profileId: assignee.profileId,
        displayName: assignee.fullName,
        email: assignee.email,
        currentStatus: assignee.status,
        linkSource: link.link_source,
      };
    }) satisfies ProjectExportWholeAssetLinkRecord[];
  });

  const fallbackLinks = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_consent_manual_photo_fallbacks")
      .select("asset_id, consent_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
    }

    return ((data ?? []) as Array<{
      asset_id: string;
      consent_id: string;
    }>).map((row) => ({
      assetId: row.asset_id,
      consentId: row.consent_id,
    })) satisfies ProjectExportFallbackRecord[];
  });

  const effectiveScopeConsentIds = Array.from(
    new Set(
      [
        ...consents.map((consent) => consent.id),
        ...faceLinks.map((link) => link.consentId),
        ...wholeAssetLinks.map((link) => link.consentId),
        ...fallbackLinks.map((link) => link.consentId),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const effectiveScopeParticipantIds = Array.from(
    new Set(
      [
        ...faceLinks.map((link) => link.projectProfileParticipantId),
        ...wholeAssetLinks.map((link) => link.projectProfileParticipantId),
      ].filter((value): value is string => Boolean(value)),
    ),
  );
  const [effectiveScopesByConsentId, effectiveScopesByParticipantId] = await Promise.all([
    loadProjectConsentScopeStatesByConsentIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentIds: effectiveScopeConsentIds,
    }),
    loadProjectConsentScopeStatesByParticipantIds({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      participantIds: effectiveScopeParticipantIds,
    }),
  ]);

  const signedScopeProjectionRows = await runChunkedRead(consents.map((consent) => consent.id), async (consentIdChunk) => {
    const { data, error } = await input.supabase
      .from("project_consent_scope_signed_projections")
      .select(
        "consent_id, template_id, template_key, template_version, template_version_number, scope_option_key, scope_label_snapshot, granted, signed_at",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("consent_id", consentIdChunk)
      .order("scope_order_index", { ascending: true });

    if (error) {
      throw new HttpError(500, "project_export_failed", "Unable to load project export data.");
    }

    return (data ?? []) as Array<{
      consent_id: string | null;
      template_id: string;
      template_key: string;
      template_version: string;
      template_version_number: number;
      scope_option_key: string;
      scope_label_snapshot: string;
      granted: boolean;
      signed_at: string | null;
    }>;
  });
  const signedScopesByConsentId = new Map<string, ProjectExportSignedScopeJson[]>();
  for (const row of signedScopeProjectionRows) {
    if (!row.consent_id) {
      continue;
    }

    const current = signedScopesByConsentId.get(row.consent_id) ?? [];
    current.push({
      templateKey: row.template_key,
      scopeKey: row.scope_option_key,
      label: row.scope_label_snapshot,
      granted: row.granted,
      templateId: row.template_id,
      templateVersion: row.template_version,
      templateVersionNumber: row.template_version_number,
      signedAt: row.signed_at,
    });
    signedScopesByConsentId.set(row.consent_id, current);
  }

  const enrichedConsents = consents.map((consent) => ({
    ...consent,
    effectiveScopes: (effectiveScopesByConsentId.get(consent.id) ?? []).map(toExportScopeState),
    signedScopes:
      sortSignedScopes(signedScopesByConsentId.get(consent.id) ?? []).length > 0
        ? sortSignedScopes(signedScopesByConsentId.get(consent.id) ?? [])
        : buildSignedScopesFromSnapshot(consent.structuredFieldsSnapshot, consent.signedAt),
  }));
  const enrichedFaceLinks = faceLinks.map((link) => ({
    ...link,
    effectiveScopes:
      link.identityKind === "project_consent" && link.consentId
        ? (effectiveScopesByConsentId.get(link.consentId) ?? []).map(toExportScopeState)
        : link.projectProfileParticipantId
          ? (effectiveScopesByParticipantId.get(link.projectProfileParticipantId) ?? []).map(toExportScopeState)
          : [],
  }));
  const enrichedWholeAssetLinks = wholeAssetLinks.map((link) => ({
    ...link,
    effectiveScopes:
      link.identityKind === "project_consent" && link.consentId
        ? (effectiveScopesByConsentId.get(link.consentId) ?? []).map(toExportScopeState)
        : link.projectProfileParticipantId
          ? (effectiveScopesByParticipantId.get(link.projectProfileParticipantId) ?? []).map(toExportScopeState)
          : [],
  }));

  return {
    assets,
    consents: enrichedConsents,
    materializations,
    faces,
    faceLinks: enrichedFaceLinks,
    wholeAssetLinks: enrichedWholeAssetLinks,
    fallbackLinks,
  } satisfies LoadedProjectExportRecords;
}

export function buildPreparedProjectExport(input: {
  projectId: string;
  projectName: string;
  records: LoadedProjectExportRecords;
}) {
  ensureGuardrails(input.records);

  const projectFolderName = buildProjectFolderName(input.projectName, input.projectId);
  const assetFileNames = assignAssetExportFilenames(
    input.records.assets.map((asset) => ({
      id: asset.id,
      originalFilename: asset.originalFilename,
    })),
  );
  const consentFileNames = assignConsentExportFilenames(
    input.records.consents.map((consent) => ({
      id: consent.id,
      fullName: consent.subjectFullName,
      email: consent.subjectEmail,
    })),
  );

  const assetFileNameById = new Map(assetFileNames.map((asset) => [asset.assetId, asset]));
  const consentFileNameById = new Map(consentFileNames.map((consent) => [consent.consentId, consent]));
  const consentById = new Map(input.records.consents.map((consent) => [consent.id, consent]));
  const assetById = new Map(input.records.assets.map((asset) => [asset.id, asset]));
  const materializationByAssetId = new Map(
    input.records.materializations.map((materialization) => [materialization.assetId, materialization]),
  );
  const facesByMaterializationId = new Map<string, ProjectExportFaceRecord[]>();

  input.records.faces.forEach((face) => {
    const current = facesByMaterializationId.get(face.materializationId) ?? [];
    current.push(face);
    facesByMaterializationId.set(face.materializationId, current);
  });

  facesByMaterializationId.forEach((faces) => {
    faces.sort((left, right) => left.faceRank - right.faceRank);
  });

  const currentFaceLinks = input.records.faceLinks.filter((link) => {
    const materialization = materializationByAssetId.get(link.assetId);
    return materialization?.id === link.assetMaterializationId;
  });
  const currentWholeAssetLinks = input.records.wholeAssetLinks;
  const currentFallbackLinks = input.records.fallbackLinks.filter((link) => {
    const materialization = materializationByAssetId.get(link.assetId);
    return materialization?.faceCount === 0;
  });

  const faceLinkByFaceId = new Map(currentFaceLinks.map((link) => [link.assetFaceId, link]));
  const faceLinksByAssetId = new Map<string, ProjectExportFaceLinkRecord[]>();
  const wholeAssetLinksByAssetId = new Map<string, ProjectExportWholeAssetLinkRecord[]>();
  const fallbackLinksByAssetId = new Map<string, ProjectExportFallbackRecord[]>();
  const linksByConsentId = new Map<
    string,
    Array<
      | {
          kind: "face";
          link: ProjectExportFaceLinkRecord;
        }
      | {
          kind: "whole_asset";
          link: ProjectExportWholeAssetLinkRecord;
        }
      | {
          kind: "asset_fallback";
          link: ProjectExportFallbackRecord;
        }
    >
  >();

  currentFaceLinks.forEach((link) => {
    const assetLinks = faceLinksByAssetId.get(link.assetId) ?? [];
    assetLinks.push(link);
    faceLinksByAssetId.set(link.assetId, assetLinks);

    if (link.consentId) {
      const consentLinks = linksByConsentId.get(link.consentId) ?? [];
      consentLinks.push({ kind: "face", link });
      linksByConsentId.set(link.consentId, consentLinks);
    }
  });

  currentWholeAssetLinks.forEach((link) => {
    const assetLinks = wholeAssetLinksByAssetId.get(link.assetId) ?? [];
    assetLinks.push(link);
    wholeAssetLinksByAssetId.set(link.assetId, assetLinks);

    if (link.consentId) {
      const consentLinks = linksByConsentId.get(link.consentId) ?? [];
      consentLinks.push({ kind: "whole_asset", link });
      linksByConsentId.set(link.consentId, consentLinks);
    }
  });

  const canonicalWholeAssetConsentKeys = new Set(
    currentWholeAssetLinks
      .filter((link): link is ProjectExportWholeAssetLinkRecord & { consentId: string } => typeof link.consentId === "string")
      .map((link) => `${link.assetId}:${link.consentId}`),
  );

  currentFallbackLinks.forEach((link) => {
    if (canonicalWholeAssetConsentKeys.has(`${link.assetId}:${link.consentId}`)) {
      return;
    }

    const assetLinks = fallbackLinksByAssetId.get(link.assetId) ?? [];
    assetLinks.push(link);
    fallbackLinksByAssetId.set(link.assetId, assetLinks);

    const consentLinks = linksByConsentId.get(link.consentId) ?? [];
    consentLinks.push({ kind: "asset_fallback", link });
    linksByConsentId.set(link.consentId, consentLinks);
  });

  const assets = input.records.assets.map((asset) => {
    const { storageBucket, storagePath } = requireAssetStorage(asset);
    const fileNames = assetFileNameById.get(asset.id);
    if (!fileNames) {
      throw new HttpError(500, "project_export_failed", "Unable to prepare project export.");
    }

    const materialization = materializationByAssetId.get(asset.id) ?? null;
    const faces = materialization ? facesByMaterializationId.get(materialization.id) ?? [] : [];
    const detectedFaces = faces.map((face) => {
      const link = faceLinkByFaceId.get(face.id) ?? null;

      return {
        assetFaceId: face.id,
        faceRank: face.faceRank,
        detectionProbability: face.detectionProbability,
        boxNormalized: normalizeFaceBox(face.faceBoxNormalized),
        boxPixels: normalizeFaceBox(face.faceBox),
        linkedProjectFaceAssigneeId: link?.projectFaceAssigneeId ?? null,
        linkedIdentityKind: link?.identityKind ?? null,
        linkedConsentId: link?.consentId ?? null,
        linkedRecurringProfile:
          link?.identityKind === "project_recurring_consent"
            ? {
                projectProfileParticipantId: link.projectProfileParticipantId,
                profileId: link.profileId,
                recurringProfileConsentId: link.recurringProfileConsentId,
                displayName: link.displayName,
                email: link.email,
                currentStatus: link.currentStatus,
              }
            : null,
        linkSource: link?.linkSource ?? null,
        matchConfidence: link?.matchConfidence ?? null,
      } satisfies ProjectExportFaceJson;
    });

    const linkedConsents: ProjectExportAssetJson["linkedConsents"] = [
      ...(faceLinksByAssetId.get(asset.id) ?? [])
        .filter((link): link is ProjectExportFaceLinkRecord & { consentId: string } => typeof link.consentId === "string")
        .map((link) => {
        const consent = consentById.get(link.consentId);
        const linkedFace = faces.find((face) => face.id === link.assetFaceId) ?? null;

        return {
          consentId: link.consentId,
          subjectId: consent?.subjectId ?? "",
          fullName: consent?.subjectFullName ?? null,
          email: consent?.subjectEmail ?? null,
          currentStatus: consent ? consentState(consent) : "active",
          revokedAt: consent?.revokedAt ?? null,
          revokeReason: consent?.revokeReason ?? null,
          linkMode: "face" as const,
          linkSource: link.linkSource,
          assetFaceId: link.assetFaceId,
          faceRank: linkedFace?.faceRank ?? null,
          matchConfidence: link.matchConfidence,
        };
      }),
      ...(wholeAssetLinksByAssetId.get(asset.id) ?? [])
        .filter((link): link is ProjectExportWholeAssetLinkRecord & { consentId: string } => typeof link.consentId === "string")
        .map((link) => {
          const consent = consentById.get(link.consentId);

          return {
            consentId: link.consentId,
            subjectId: consent?.subjectId ?? "",
            fullName: consent?.subjectFullName ?? null,
            email: consent?.subjectEmail ?? null,
            currentStatus: consent ? consentState(consent) : "active",
            revokedAt: consent?.revokedAt ?? null,
            revokeReason: consent?.revokeReason ?? null,
            linkMode: "whole_asset" as const,
            linkSource: link.linkSource,
            assetFaceId: null,
            faceRank: null,
            matchConfidence: null,
          };
        }),
      ...(fallbackLinksByAssetId.get(asset.id) ?? []).map((link) => {
        const consent = consentById.get(link.consentId);

        return {
          consentId: link.consentId,
          subjectId: consent?.subjectId ?? "",
          fullName: consent?.subjectFullName ?? null,
          email: consent?.subjectEmail ?? null,
          currentStatus: consent ? consentState(consent) : "active",
          revokedAt: consent?.revokedAt ?? null,
          revokeReason: consent?.revokeReason ?? null,
          linkMode: "asset_fallback" as const,
          linkSource: "manual" as const,
          assetFaceId: null,
          faceRank: null,
          matchConfidence: null,
        };
      }),
    ];
    const linkedAssignees: ProjectExportAssetJson["linkedAssignees"] = [
      ...(faceLinksByAssetId.get(asset.id) ?? []).map((link) => {
        const linkedFace = faces.find((face) => face.id === link.assetFaceId) ?? null;

        return {
          projectFaceAssigneeId: link.projectFaceAssigneeId,
          identityKind: link.identityKind,
          consentId: link.consentId,
          recurringProfileConsentId: link.recurringProfileConsentId,
          projectProfileParticipantId: link.projectProfileParticipantId,
          profileId: link.profileId,
          displayName: link.displayName,
          email: link.email,
          currentStatus: link.currentStatus,
          linkMode: "face" as const,
          linkSource: link.linkSource,
          assetFaceId: link.assetFaceId,
          faceRank: linkedFace?.faceRank ?? null,
          matchConfidence: link.matchConfidence,
        };
      }),
      ...(wholeAssetLinksByAssetId.get(asset.id) ?? []).map((link) => ({
        projectFaceAssigneeId: link.projectFaceAssigneeId,
        identityKind: link.identityKind,
        consentId: link.consentId,
        recurringProfileConsentId: link.recurringProfileConsentId,
        projectProfileParticipantId: link.projectProfileParticipantId,
        profileId: link.profileId,
        displayName: link.displayName,
        email: link.email,
        currentStatus: link.currentStatus,
        linkMode: "whole_asset" as const,
        linkSource: link.linkSource,
        assetFaceId: null,
        faceRank: null,
        matchConfidence: null,
      })),
      ...(fallbackLinksByAssetId.get(asset.id) ?? []).map((link) => {
        const consent = consentById.get(link.consentId);

        return {
          projectFaceAssigneeId: `fallback:${link.consentId}`,
          identityKind: "project_consent" as const,
          consentId: link.consentId,
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          displayName: consent?.subjectFullName ?? null,
          email: consent?.subjectEmail ?? null,
          currentStatus: consent ? consentState(consent) : "active",
          linkMode: "asset_fallback" as const,
          linkSource: "manual" as const,
          assetFaceId: null,
          faceRank: null,
          matchConfidence: null,
        };
      }),
    ];
    const linkedOwnerScopeStates: ProjectExportAssetJson["linkedOwnerScopeStates"] = [
      ...(faceLinksByAssetId.get(asset.id) ?? []).map((link) => ({
        projectFaceAssigneeId: link.projectFaceAssigneeId,
        identityKind: link.identityKind,
        consentId: link.consentId,
        recurringProfileConsentId: link.recurringProfileConsentId,
        projectProfileParticipantId: link.projectProfileParticipantId,
        profileId: link.profileId,
        effectiveScopes: link.effectiveScopes,
      })),
      ...(wholeAssetLinksByAssetId.get(asset.id) ?? []).map((link) => ({
        projectFaceAssigneeId: link.projectFaceAssigneeId,
        identityKind: link.identityKind,
        consentId: link.consentId,
        recurringProfileConsentId: link.recurringProfileConsentId,
        projectProfileParticipantId: link.projectProfileParticipantId,
        profileId: link.profileId,
        effectiveScopes: link.effectiveScopes,
      })),
      ...(fallbackLinksByAssetId.get(asset.id) ?? []).map((link) => {
        const consent = consentById.get(link.consentId);

        return {
          projectFaceAssigneeId: `fallback:${link.consentId}`,
          identityKind: "project_consent" as const,
          consentId: link.consentId,
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          effectiveScopes: consent?.effectiveScopes ?? [],
        };
      }),
    ];

    linkedConsents.sort((left, right) => {
      const leftRank = left.faceRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.faceRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.consentId.localeCompare(right.consentId);
    });
    linkedAssignees.sort((left, right) => {
      const leftRank = left.faceRank ?? Number.MAX_SAFE_INTEGER;
      const rightRank = right.faceRank ?? Number.MAX_SAFE_INTEGER;
      if (leftRank !== rightRank) {
        return leftRank - rightRank;
      }

      return left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId);
    });
    linkedOwnerScopeStates.sort((left, right) => left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId));

    return {
      assetId: asset.id,
      storageBucket,
      storagePath,
      exportedFilename: fileNames.exportedFilename,
      metadataFilename: fileNames.metadataFilename,
      metadata: {
        schemaVersion: 1,
        assetId: asset.id,
        assetType: "photo",
        originalFilename: asset.originalFilename,
        exportedFilename: fileNames.exportedFilename,
        metadataFilename: fileNames.metadataFilename,
        contentType: asset.contentType,
        fileSizeBytes: asset.fileSizeBytes,
        uploadedAt: asset.uploadedAt,
        project: {
          projectId: input.projectId,
          projectName: input.projectName,
        },
        materialization: materialization
          ? {
              materializationId: materialization.id,
              materializerVersion: materialization.materializerVersion,
              provider: materialization.provider,
              providerMode: materialization.providerMode,
              faceCount: materialization.faceCount,
              sourceImageWidth: materialization.sourceImageWidth,
              sourceImageHeight: materialization.sourceImageHeight,
              sourceCoordinateSpace: materialization.sourceCoordinateSpace,
            }
          : null,
        detectedFaces,
        linkedConsents,
        linkedAssignees,
        linkedOwnerScopeStates,
      } satisfies ProjectExportAssetJson,
    };
  });

  const detectedFaceRankById = new Map<string, number | null>();
  assets.forEach((asset) => {
    asset.metadata.detectedFaces.forEach((face) => {
      detectedFaceRankById.set(face.assetFaceId, face.faceRank);
    });
  });

  const consents = input.records.consents.map((consent) => {
    const fileNames = consentFileNameById.get(consent.id);
    if (!fileNames) {
      throw new HttpError(500, "project_export_failed", "Unable to prepare project export.");
    }

    const linkedAssets = (linksByConsentId.get(consent.id) ?? []).map((entry) => {
      const asset = assetById.get(entry.link.assetId);
      const assetFileName = assetFileNameById.get(entry.link.assetId);

      return {
        assetId: entry.link.assetId,
        originalFilename: asset?.originalFilename ?? "",
        exportedFilename: assetFileName?.exportedFilename ?? "",
        linkMode: entry.kind,
        linkSource:
          entry.kind === "face" || entry.kind === "whole_asset"
            ? entry.link.linkSource
            : ("manual" as const),
        assetFaceId: entry.kind === "face" ? entry.link.assetFaceId : null,
        faceRank: entry.kind === "face" ? detectedFaceRankById.get(entry.link.assetFaceId) ?? null : null,
        matchConfidence: entry.kind === "face" ? entry.link.matchConfidence : null,
      };
    });

    linkedAssets.sort((left, right) => {
      const assetOrder = left.exportedFilename.localeCompare(right.exportedFilename);
      if (assetOrder !== 0) {
        return assetOrder;
      }

      return left.assetId.localeCompare(right.assetId);
    });

    return {
      consentId: consent.id,
      exportedFilename: fileNames.exportedFilename,
      data: {
        schemaVersion: 1,
        consentId: consent.id,
        project: {
          projectId: input.projectId,
          projectName: input.projectName,
        },
        subject: {
          subjectId: consent.subjectId,
          fullName: consent.subjectFullName,
          email: consent.subjectEmail,
          source: "current_subject_record",
        },
        inviteId: consent.inviteId,
        signedAt: consent.signedAt,
        signedSnapshot: {
          consentVersion: consent.consentVersion,
          consentText: consent.consentText,
          structuredFieldsSnapshot: consent.structuredFieldsSnapshot,
        },
        faceMatchOptIn: consent.faceMatchOptIn,
        currentStatus: {
          state: consentState(consent),
          revokedAt: consent.revokedAt,
          revokeReason: consent.revokeReason,
        },
        effectiveScopes: consent.effectiveScopes,
        signedScopes: consent.signedScopes,
        linkedAssets,
      } satisfies ProjectExportConsentJson,
    };
  });

  const totalAssetBytes = input.records.assets.reduce((sum, asset) => sum + asset.fileSizeBytes, 0);

  return {
    projectId: input.projectId,
    projectName: input.projectName,
    projectFolderName,
    downloadFilename: `${projectFolderName}.zip`,
    assetCount: input.records.assets.length,
    totalAssetBytes,
    assets,
    consents,
  } satisfies PreparedProjectExport;
}
