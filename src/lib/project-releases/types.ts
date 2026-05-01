export const PROJECT_RELEASE_STATUSES = ["building", "published"] as const;
export const PROJECT_RELEASE_ASSET_TYPES = ["photo", "video"] as const;

export type ProjectReleaseStatus = (typeof PROJECT_RELEASE_STATUSES)[number];
export type ProjectReleaseAssetType = (typeof PROJECT_RELEASE_ASSET_TYPES)[number];

export type ProjectReleaseOwnerIdentityKind = "project_consent" | "project_recurring_consent";

export type ProjectReleaseProjectSnapshot = {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
    status: "active" | "archived";
    finalizedAt: string;
    finalizedBy: string;
  };
  release: {
    releaseId: string;
    releaseVersion: number;
    status: ProjectReleaseStatus;
    createdBy: string;
    createdAt: string;
    snapshotCreatedAt: string | null;
  };
  workspaces: Array<{
    id: string;
    name: string;
    workspaceKind: "default" | "photographer";
  }>;
  assetCounts: {
    total: number;
    photo: number;
    video: number;
  };
};

export type ProjectReleaseAssetMetadataSnapshot = {
  schemaVersion: 1;
  sourceAsset: {
    assetId: string;
    assetType: ProjectReleaseAssetType;
    originalFilename: string;
    contentType: string | null;
    fileSizeBytes: number;
    uploadedAt: string | null;
    storageBucket: string;
    storagePath: string;
  };
  photoMaterialization: null | {
    materializationId: string;
    materializerVersion: string;
    provider: string;
    providerMode: string;
    faceCount: number;
    sourceImageWidth: number | null;
    sourceImageHeight: number | null;
    sourceCoordinateSpace: string;
  };
};

export type ProjectReleaseWorkspaceSnapshot = {
  schemaVersion: 1;
  project: {
    id: string;
    name: string;
    status: "active" | "archived";
    finalizedAt: string;
    finalizedBy: string;
  };
  workspace: {
    id: string;
    name: string;
    workspaceKind: "default" | "photographer";
  };
  release: {
    releaseId: string;
    releaseVersion: number;
    createdAt: string;
    snapshotCreatedAt: string | null;
  };
};

export type ProjectReleaseConsentSnapshot = {
  schemaVersion: 1;
  linkedOwners: Array<{
    projectFaceAssigneeId: string;
    identityKind: ProjectReleaseOwnerIdentityKind;
    consentId: string | null;
    recurringProfileConsentId: string | null;
    projectProfileParticipantId: string | null;
    profileId: string | null;
    displayName: string | null;
    email: string | null;
    currentStatus: "active" | "revoked";
    signedAt: string | null;
    consentVersion: string | null;
    faceMatchOptIn: boolean;
  }>;
  linkedPeopleCount: number;
};

export type ProjectReleaseLinkSnapshot = {
  schemaVersion: 1;
  exactFaceLinks: Array<{
    assetFaceId: string;
    materializationId: string;
    faceRank: number;
    projectFaceAssigneeId: string;
    identityKind: ProjectReleaseOwnerIdentityKind;
    consentId: string | null;
    recurringProfileConsentId: string | null;
    projectProfileParticipantId: string | null;
    profileId: string | null;
    linkSource: "manual" | "auto";
    matchConfidence: number | null;
  }>;
  wholeAssetLinks: Array<{
    projectFaceAssigneeId: string;
    identityKind: ProjectReleaseOwnerIdentityKind;
    consentId: string | null;
    recurringProfileConsentId: string | null;
    projectProfileParticipantId: string | null;
    profileId: string | null;
    linkSource: "manual";
  }>;
  fallbackLinks: Array<{
    consentId: string;
    projectFaceAssigneeId: string;
  }>;
};

export type ProjectReleaseReviewSnapshot = {
  schemaVersion: 1;
  faces: Array<{
    assetFaceId: string;
    materializationId: string;
    faceRank: number;
    faceSource: "detector" | "manual";
    detectionProbability: number | null;
    faceBox: Record<string, unknown>;
    faceBoxNormalized: Record<string, unknown> | null;
  }>;
  hiddenFaces: Array<{
    assetFaceId: string;
    hiddenAt: string;
  }>;
  blockedFaces: Array<{
    assetFaceId: string;
    blockedAt: string;
    reason: "no_consent";
  }>;
  faceLinkSuppressions: Array<{
    assetFaceId: string;
    projectFaceAssigneeId: string;
  }>;
  assigneeLinkSuppressions: Array<{
    assetFaceId: string;
    projectFaceAssigneeId: string;
  }>;
  manualFaces: Array<{
    assetFaceId: string;
    faceRank: number;
  }>;
};

export type ProjectReleaseScopeSnapshot = {
  schemaVersion: 1;
  owners: Array<{
    projectFaceAssigneeId: string;
    identityKind: ProjectReleaseOwnerIdentityKind;
    consentId: string | null;
    recurringProfileConsentId: string | null;
    projectProfileParticipantId: string | null;
    effectiveScopes: Array<{
      templateKey: string;
      scopeKey: string;
      label: string;
      status: "granted" | "not_granted" | "revoked" | "not_collected";
      governingSourceKind: ProjectReleaseOwnerIdentityKind;
    }>;
    signedScopes: Array<{
      templateKey: string;
      scopeKey: string;
      label: string;
      granted: boolean;
    }>;
  }>;
};

export type ProjectReleaseRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  release_version: number;
  status: ProjectReleaseStatus;
  created_by: string;
  created_at: string;
  source_project_finalized_at: string;
  source_project_finalized_by: string;
  snapshot_created_at: string | null;
  project_snapshot: ProjectReleaseProjectSnapshot;
};

export type ProjectReleaseAssetRow = {
  id: string;
  tenant_id: string;
  release_id: string;
  project_id: string;
  workspace_id: string;
  source_asset_id: string;
  asset_type: ProjectReleaseAssetType;
  original_filename: string;
  original_storage_bucket: string;
  original_storage_path: string;
  content_type: string | null;
  file_size_bytes: number;
  uploaded_at: string | null;
  created_at: string;
  asset_metadata_snapshot: ProjectReleaseAssetMetadataSnapshot;
  workspace_snapshot: ProjectReleaseWorkspaceSnapshot;
  consent_snapshot: ProjectReleaseConsentSnapshot;
  link_snapshot: ProjectReleaseLinkSnapshot;
  review_snapshot: ProjectReleaseReviewSnapshot;
  scope_snapshot: ProjectReleaseScopeSnapshot;
};

export type ProjectReleaseSummary = {
  id: string | null;
  releaseVersion: number;
  status: "published" | "missing";
  assetCount: number;
  createdAt: string | null;
  snapshotCreatedAt: string | null;
};
