import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { loadProjectConsentScopeStatesByConsentIds, loadProjectConsentScopeStatesByParticipantIds, type ProjectConsentScopeState } from "@/lib/consent/project-consent-scope-state";
import { HttpError } from "@/lib/http/errors";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import {
  loadCurrentBlockedFacesForAssets,
  loadCurrentHiddenFacesForAssets,
} from "@/lib/matching/photo-face-linking";
import {
  loadProjectConsentFaceAssigneeIdsByConsentIds,
  loadProjectFaceAssigneeDisplayMap,
  type ProjectFaceAssigneeDisplaySummary,
} from "@/lib/matching/project-face-assignees";
import { loadCurrentWholeAssetLinksForAssets, type EnrichedWholeAssetLinkRow } from "@/lib/matching/whole-asset-linking";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";
import { authorizeMediaLibraryAccess as authorizeMediaLibraryAccessWithCustomRoles } from "@/lib/tenant/media-library-custom-role-access";
import type { StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";

import type {
  ProjectReleaseAssetMetadataSnapshot,
  ProjectReleaseAssetRow,
  ProjectReleaseConsentSnapshot,
  ProjectReleaseLinkSnapshot,
  ProjectReleaseProjectSnapshot,
  ProjectReleaseRow,
  ProjectReleaseScopeSnapshot,
  ProjectReleaseSummary,
  ProjectReleaseWorkspaceSnapshot,
  ProjectReleaseReviewSnapshot,
} from "@/lib/project-releases/types";

const RELEASE_ASSET_INSERT_CHUNK_SIZE = 100;
export const MEDIA_LIBRARY_DEFAULT_PAGE_SIZE = 24;
export const MEDIA_LIBRARY_ALLOWED_PAGE_SIZES = [24, 48, 96] as const;

type FinalizedProjectRow = {
  id: string;
  tenant_id: string;
  name: string;
  status: "active" | "archived";
  finalized_at: string | null;
  finalized_by: string | null;
};

type ProjectWorkspaceRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_kind: "default" | "photographer";
  name: string;
};

type ReleaseSourceAssetRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_id: string;
  asset_type: "photo" | "video";
  original_filename: string;
  content_type: string | null;
  file_size_bytes: number;
  uploaded_at: string | null;
  created_at: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type PhotoMaterializationRow = {
  id: string;
  asset_id: string;
  materializer_version: string;
  provider: string;
  provider_mode: string;
  face_count: number;
  source_image_width: number | null;
  source_image_height: number | null;
  source_coordinate_space: string;
};

type PhotoFaceRow = {
  id: string;
  asset_id: string;
  materialization_id: string;
  face_rank: number;
  detection_probability: number | null;
  face_box: Record<string, unknown>;
  face_box_normalized: Record<string, unknown> | null;
  face_source: "detector" | "manual";
};

type FaceLinkRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  project_face_assignee_id: string;
  link_source: "manual" | "auto";
  match_confidence: number | null;
};

type AssigneeSuppressionRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  project_face_assignee_id: string;
};

type ConsentSuppressionRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  consent_id: string;
};

type HiddenFaceRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  hidden_at: string;
};

type BlockedFaceRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  blocked_at: string;
  reason: "no_consent";
};

type ManualFallbackRow = {
  asset_id: string;
  consent_id: string;
};

type ConsentSummaryRow = {
  id: string;
  signed_at: string | null;
  revoked_at: string | null;
  consent_version: string | null;
  face_match_opt_in: boolean;
  structured_fields_snapshot: StructuredFieldsSnapshot | Record<string, unknown> | null;
  subjects:
    | {
        email: string | null;
        full_name: string | null;
      }
    | Array<{
        email: string | null;
        full_name: string | null;
      }>
    | null;
};

type SignedScopeProjectionRow = {
  consent_id: string | null;
  template_key: string;
  scope_option_key: string;
  scope_label_snapshot: string;
  granted: boolean;
  template_version_number: number;
};

type MediaLibraryListItem = {
  row: ProjectReleaseAssetRow;
  releaseCreatedAt: string;
  releaseVersion: number;
  projectName: string;
  workspaceName: string;
};

type MediaLibraryAssetIdentityRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  source_asset_id: string;
};

type MediaLibraryFolderRow = {
  id: string;
  tenant_id: string;
  name: string;
  parent_folder_id: string | null;
  archived_at: string | null;
};

type MediaLibraryFolderMembershipRow = {
  id: string;
  tenant_id: string;
  media_library_asset_id: string;
  folder_id: string;
};

export type MediaLibraryFolderSummary = {
  id: string;
  name: string;
  parentFolderId: string | null;
  assetCount: number;
};

export type MediaLibraryFolderPathSegment = {
  id: string;
  name: string;
};

export type MediaLibraryFolderOption = MediaLibraryFolderSummary & {
  depth: number;
  path: MediaLibraryFolderPathSegment[];
  pathLabel: string;
  descendantIds: string[];
};

export type MediaLibraryFolderTreeNode = MediaLibraryFolderOption & {
  children: MediaLibraryFolderTreeNode[];
};

export type MediaLibraryListItemWithFolder = MediaLibraryListItem & {
  mediaLibraryAssetId: string | null;
  folderId: string | null;
  folderName: string | null;
};

export type MediaLibraryPagination = {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};

export type MediaLibraryPageData = {
  folders: MediaLibraryFolderTreeNode[];
  folderOptions: MediaLibraryFolderOption[];
  items: MediaLibraryListItemWithFolder[];
  selectedFolderId: string | null;
  selectedFolder: MediaLibraryFolderSummary | null;
  selectedFolderPath: MediaLibraryFolderPathSegment[];
  canManageFolders: boolean;
  pagination: MediaLibraryPagination;
};

type ReleaseAssetDetail = {
  row: ProjectReleaseAssetRow;
  releaseCreatedAt: string;
  releaseVersion: number;
  projectName: string;
  workspaceName: string;
  releaseWorkspaceCount: number;
  hasPhotographerWorkspaces: boolean;
};

function firstRelation<
  T extends {
    email?: string | null;
    full_name?: string | null;
  },
>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

function buildPublishedReleaseSummary(
  release: Pick<ProjectReleaseRow, "id" | "release_version" | "created_at" | "snapshot_created_at">,
  assetCount: number,
): ProjectReleaseSummary {
  return {
    id: release.id,
    releaseVersion: release.release_version,
    status: "published",
    assetCount,
    createdAt: release.created_at,
    snapshotCreatedAt: release.snapshot_created_at,
  };
}

function buildMissingReleaseSummary(): ProjectReleaseSummary {
  return {
    id: null,
    releaseVersion: 1,
    status: "missing",
    assetCount: 0,
    createdAt: null,
    snapshotCreatedAt: null,
  };
}

function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}

function mapScopeStateForSnapshot(scopeState: ProjectConsentScopeState) {
  return {
    templateKey: scopeState.templateKey,
    scopeKey: scopeState.scopeOptionKey,
    label: scopeState.scopeLabel,
    status: scopeState.effectiveStatus,
    governingSourceKind: scopeState.governingSourceKind,
  } satisfies ProjectReleaseScopeSnapshot["owners"][number]["effectiveScopes"][number];
}

function sortScopeEntries(
  scopes: ProjectReleaseScopeSnapshot["owners"][number]["effectiveScopes"],
) {
  return scopes.slice().sort((left, right) => {
    if (left.templateKey !== right.templateKey) {
      return left.templateKey.localeCompare(right.templateKey);
    }

    return left.scopeKey.localeCompare(right.scopeKey);
  });
}

function sortSignedScopes(
  scopes: ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"],
) {
  return scopes.slice().sort((left, right) => {
    if (left.templateKey !== right.templateKey) {
      return left.templateKey.localeCompare(right.templateKey);
    }

    return left.scopeKey.localeCompare(right.scopeKey);
  });
}

function buildSignedScopesFromSnapshot(
  snapshot: StructuredFieldsSnapshot | Record<string, unknown> | null,
) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [] as ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"];
  }

  const typedSnapshot = snapshot as StructuredFieldsSnapshot;
  const templateKey = typedSnapshot.templateSnapshot?.templateKey ?? null;
  const scopeOptions = typedSnapshot.definition?.builtInFields?.scope?.options ?? [];
  const selectedOptionKeys =
    typedSnapshot.values?.scope?.valueType === "checkbox_list"
      ? new Set(typedSnapshot.values.scope.selectedOptionKeys)
      : new Set<string>();

  if (!templateKey) {
    return [] as ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"];
  }

  return sortSignedScopes(
    scopeOptions.map((option) => ({
      templateKey,
      scopeKey: option.optionKey,
      label: option.label,
      granted: selectedOptionKeys.has(option.optionKey),
    })),
  );
}

async function loadFinalizedProject(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("projects")
    .select("id, tenant_id, name, status, finalized_at, finalized_by")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load the finalized project.");
  }

  const project = (data as FinalizedProjectRow | null) ?? null;
  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  if (!project.finalized_at || !project.finalized_by) {
    throw new HttpError(
      409,
      "project_release_not_finalized",
      "Project releases can only be created after finalization.",
    );
  }

  return project;
}

async function loadProjectWorkspaces(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("project_workspaces")
    .select("id, tenant_id, project_id, workspace_kind, name")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load project workspaces.");
  }

  return ((data ?? []) as ProjectWorkspaceRow[]).reduce((map, workspace) => {
    map.set(workspace.id, workspace);
    return map;
  }, new Map<string, ProjectWorkspaceRow>());
}

async function loadEligibleSourceAssets(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("assets")
    .select(
      "id, tenant_id, project_id, workspace_id, asset_type, original_filename, content_type, file_size_bytes, uploaded_at, created_at, storage_bucket, storage_path",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .in("asset_type", ["photo", "video"])
    .eq("status", "uploaded")
    .is("archived_at", null)
    .order("uploaded_at", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load project assets.");
  }

  return (data ?? []) as ReleaseSourceAssetRow[];
}

async function loadCurrentPhotoMaterializations(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  photoAssetIds: string[],
) {
  if (photoAssetIds.length === 0) {
    return new Map<string, PhotoMaterializationRow>();
  }

  const rows = await runChunkedRead(photoAssetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materializations")
      .select(
        "id, asset_id, materializer_version, provider, provider_mode, face_count, source_image_width, source_image_height, source_coordinate_space",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "photo")
      .eq("materializer_version", getAutoMatchMaterializerVersion())
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load photo materializations.");
    }

    return (data ?? []) as PhotoMaterializationRow[];
  });

  return new Map(rows.map((row) => [row.asset_id, row] as const));
}

async function loadMaterializationFaces(
  supabase: SupabaseClient,
  materializationIds: string[],
) {
  if (materializationIds.length === 0) {
    return new Map<string, PhotoFaceRow[]>();
  }

  const rows = await runChunkedRead(materializationIds, async (materializationIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materialization_faces")
      .select(
        "id, asset_id, materialization_id, face_rank, detection_probability, face_box, face_box_normalized, face_source",
      )
      .in("materialization_id", materializationIdChunk)
      .order("face_rank", { ascending: true });

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load photo face snapshots.");
    }

    return (data ?? []) as PhotoFaceRow[];
  });

  const facesByMaterializationId = new Map<string, PhotoFaceRow[]>();
  for (const row of rows) {
    const current = facesByMaterializationId.get(row.materialization_id) ?? [];
    current.push(row);
    facesByMaterializationId.set(row.materialization_id, current);
  }

  return facesByMaterializationId;
}

async function loadCurrentFaceLinks(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as FaceLinkRow[];
  }

  return runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_consent_links")
      .select(
        "asset_face_id, asset_materialization_id, asset_id, project_face_assignee_id, link_source, match_confidence",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load current face links.");
    }

    return (data ?? []) as FaceLinkRow[];
  });
}

async function loadCurrentAssigneeSuppressions(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as AssigneeSuppressionRow[];
  }

  return runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_assignee_link_suppressions")
      .select("asset_face_id, asset_materialization_id, asset_id, project_face_assignee_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load assignee suppressions.");
    }

    return (data ?? []) as AssigneeSuppressionRow[];
  });
}

async function loadCurrentConsentSuppressions(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as ConsentSuppressionRow[];
  }

  return runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_consent_link_suppressions")
      .select("asset_face_id, asset_materialization_id, asset_id, consent_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load consent suppressions.");
    }

    return (data ?? []) as ConsentSuppressionRow[];
  });
}

async function loadManualFallbacks(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as ManualFallbackRow[];
  }

  return runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_manual_photo_fallbacks")
      .select("asset_id, consent_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load fallback links.");
    }

    return (data ?? []) as ManualFallbackRow[];
  });
}

async function loadConsentSummaries(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, ConsentSummaryRow>();
  }

  const rows = await runChunkedRead(consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("consents")
      .select(
        "id, signed_at, revoked_at, consent_version, face_match_opt_in, structured_fields_snapshot, subjects(email, full_name)",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load linked consent snapshots.");
    }

    return (data ?? []) as ConsentSummaryRow[];
  });

  return new Map(rows.map((row) => [row.id, row] as const));
}

async function loadSignedScopeProjections(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"]>();
  }

  const rows = await runChunkedRead(consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("project_consent_scope_signed_projections")
      .select(
        "consent_id, template_key, scope_option_key, scope_label_snapshot, granted, template_version_number",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("consent_id", consentIdChunk)
      .order("scope_order_index", { ascending: true });

    if (error) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to load signed scope snapshots.");
    }

    return (data ?? []) as SignedScopeProjectionRow[];
  });

  const signedScopesByConsentId = new Map<
    string,
    ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"]
  >();
  for (const row of rows) {
    if (!row.consent_id) {
      continue;
    }

    const current = signedScopesByConsentId.get(row.consent_id) ?? [];
    current.push({
      templateKey: row.template_key,
      scopeKey: row.scope_option_key,
      label: row.scope_label_snapshot,
      granted: row.granted,
    });
    signedScopesByConsentId.set(row.consent_id, current);
  }

  signedScopesByConsentId.forEach((value, key) => {
    signedScopesByConsentId.set(key, sortSignedScopes(value));
  });

  return signedScopesByConsentId;
}

async function countReleaseAssets(
  supabase: SupabaseClient,
  releaseId: string,
) {
  const { count, error } = await supabase
    .from("project_release_assets")
    .select("id", { count: "exact", head: true })
    .eq("release_id", releaseId);

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to count release assets.");
  }

  return count ?? 0;
}

async function loadReleaseByFinalizedAt(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  finalizedAt: string;
}) {
  const { data, error } = await input.supabase
    .from("project_releases")
    .select(
      "id, tenant_id, project_id, release_version, status, created_by, created_at, source_project_finalized_at, source_project_finalized_by, snapshot_created_at, project_snapshot",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("source_project_finalized_at", input.finalizedAt)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load the project release.");
  }

  return (data as ProjectReleaseRow | null) ?? null;
}

async function loadLatestProjectRelease(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("project_releases")
    .select(
      "id, tenant_id, project_id, release_version, status, created_by, created_at, source_project_finalized_at, source_project_finalized_by, snapshot_created_at, project_snapshot",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("release_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load the project release.");
  }

  return (data as ProjectReleaseRow | null) ?? null;
}

export async function loadPublishedProjectReleaseByFinalizedAt(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  finalizedAt: string;
}) {
  const { data, error } = await input.supabase
    .from("project_releases")
    .select(
      "id, tenant_id, project_id, release_version, status, created_by, created_at, source_project_finalized_at, source_project_finalized_by, snapshot_created_at, project_snapshot",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("source_project_finalized_at", input.finalizedAt)
    .eq("status", "published")
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load the project release.");
  }

  return (data as ProjectReleaseRow | null) ?? null;
}

async function resolveOrCreateBuildingRelease(input: {
  supabase: SupabaseClient;
  project: FinalizedProjectRow;
  actorUserId: string;
  workspacesById: Map<string, ProjectWorkspaceRow>;
  assetCounts: {
    total: number;
    photo: number;
    video: number;
  };
}) {
  const existingRelease = await loadReleaseByFinalizedAt({
    supabase: input.supabase,
    tenantId: input.project.tenant_id,
    projectId: input.project.id,
    finalizedAt: input.project.finalized_at as string,
  });

  if (existingRelease) {
    return existingRelease;
  }

  const latestProjectRelease = await loadLatestProjectRelease({
    supabase: input.supabase,
    tenantId: input.project.tenant_id,
    projectId: input.project.id,
  });
  const nextReleaseVersion = latestProjectRelease
    ? latestProjectRelease.release_version + 1
    : 1;

  const releaseId = randomUUID();
  const provisionalSnapshot = buildProjectSnapshot({
    project: input.project,
    release: {
      id: releaseId,
      release_version: nextReleaseVersion,
      status: "building",
      created_by: input.actorUserId,
      created_at: new Date().toISOString(),
      snapshot_created_at: null,
    },
    workspacesById: input.workspacesById,
    assetCounts: input.assetCounts,
  });

  const { data, error } = await input.supabase
    .from("project_releases")
    .insert({
      id: releaseId,
      tenant_id: input.project.tenant_id,
      project_id: input.project.id,
      release_version: nextReleaseVersion,
      status: "building",
      created_by: input.actorUserId,
      source_project_finalized_at: input.project.finalized_at,
      source_project_finalized_by: input.project.finalized_by,
      project_snapshot: provisionalSnapshot,
    })
    .select(
      "id, tenant_id, project_id, release_version, status, created_by, created_at, source_project_finalized_at, source_project_finalized_by, snapshot_created_at, project_snapshot",
    )
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      const concurrentRelease = await loadReleaseByFinalizedAt({
        supabase: input.supabase,
        tenantId: input.project.tenant_id,
        projectId: input.project.id,
        finalizedAt: input.project.finalized_at as string,
      });
      if (concurrentRelease) {
        return concurrentRelease;
      }
    }

    throw new HttpError(500, "project_release_write_failed", "Unable to create the project release.");
  }

  if (!data) {
    throw new HttpError(500, "project_release_write_failed", "Unable to create the project release.");
  }

  return data as ProjectReleaseRow;
}

function buildProjectSnapshot(input: {
  project: FinalizedProjectRow;
  release: Pick<ProjectReleaseRow, "id" | "release_version" | "status" | "created_by" | "created_at" | "snapshot_created_at">;
  workspacesById: Map<string, ProjectWorkspaceRow>;
  assetCounts: {
    total: number;
    photo: number;
    video: number;
  };
}) {
  return {
    schemaVersion: 1,
    project: {
      id: input.project.id,
      name: input.project.name,
      status: input.project.status,
      finalizedAt: input.project.finalized_at as string,
      finalizedBy: input.project.finalized_by as string,
    },
    release: {
      releaseId: input.release.id,
      releaseVersion: input.release.release_version,
      status: input.release.status,
      createdBy: input.release.created_by,
      createdAt: input.release.created_at,
      snapshotCreatedAt: input.release.snapshot_created_at,
    },
    workspaces: Array.from(input.workspacesById.values()).map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      workspaceKind: workspace.workspace_kind,
    })),
    assetCounts: input.assetCounts,
  } satisfies ProjectReleaseProjectSnapshot;
}

function buildWorkspaceSnapshot(input: {
  project: FinalizedProjectRow;
  workspace: ProjectWorkspaceRow;
  release: Pick<ProjectReleaseRow, "id" | "release_version" | "created_at">;
  snapshotCreatedAt: string;
}) {
  return {
    schemaVersion: 1,
    project: {
      id: input.project.id,
      name: input.project.name,
      status: input.project.status,
      finalizedAt: input.project.finalized_at as string,
      finalizedBy: input.project.finalized_by as string,
    },
    workspace: {
      id: input.workspace.id,
      name: input.workspace.name,
      workspaceKind: input.workspace.workspace_kind,
    },
    release: {
      releaseId: input.release.id,
      releaseVersion: input.release.release_version,
      createdAt: input.release.created_at,
      snapshotCreatedAt: input.snapshotCreatedAt,
    },
  } satisfies ProjectReleaseWorkspaceSnapshot;
}

function buildAssetMetadataSnapshot(input: {
  asset: ReleaseSourceAssetRow;
  photoMaterialization: PhotoMaterializationRow | null;
}) {
  return {
    schemaVersion: 1,
    sourceAsset: {
      assetId: input.asset.id,
      assetType: input.asset.asset_type,
      originalFilename: input.asset.original_filename,
      contentType: input.asset.content_type,
      fileSizeBytes: input.asset.file_size_bytes,
      uploadedAt: input.asset.uploaded_at,
      storageBucket: input.asset.storage_bucket as string,
      storagePath: input.asset.storage_path as string,
    },
    photoMaterialization: input.photoMaterialization
      ? {
          materializationId: input.photoMaterialization.id,
          materializerVersion: input.photoMaterialization.materializer_version,
          provider: input.photoMaterialization.provider,
          providerMode: input.photoMaterialization.provider_mode,
          faceCount: input.photoMaterialization.face_count,
          sourceImageWidth: input.photoMaterialization.source_image_width,
          sourceImageHeight: input.photoMaterialization.source_image_height,
          sourceCoordinateSpace: input.photoMaterialization.source_coordinate_space,
        }
      : null,
  } satisfies ProjectReleaseAssetMetadataSnapshot;
}

function buildFallbackOwnerSnapshot(input: {
  consentId: string;
  consent: ConsentSummaryRow;
}) {
  const subject = firstRelation(input.consent.subjects);
  return {
    projectFaceAssigneeId: `fallback:${input.consentId}`,
    identityKind: "project_consent" as const,
    consentId: input.consentId,
    recurringProfileConsentId: null,
    projectProfileParticipantId: null,
    profileId: null,
    displayName: subject?.full_name?.trim() ?? null,
    email: subject?.email?.trim() ?? null,
    currentStatus: input.consent.revoked_at ? "revoked" : "active",
    signedAt: input.consent.signed_at,
    consentVersion: input.consent.consent_version,
    faceMatchOptIn: input.consent.face_match_opt_in,
  };
}

function buildAssigneeOwnerSnapshot(assignee: ProjectFaceAssigneeDisplaySummary) {
  return {
    projectFaceAssigneeId: assignee.projectFaceAssigneeId,
    identityKind: assignee.identityKind,
    consentId: assignee.consentId,
    recurringProfileConsentId: assignee.recurringProfileConsentId,
    projectProfileParticipantId: assignee.projectProfileParticipantId,
    profileId: assignee.profileId,
    displayName: assignee.fullName,
    email: assignee.email,
    currentStatus: assignee.status,
    signedAt: assignee.signedAt,
    consentVersion: assignee.consentVersion,
    faceMatchOptIn: assignee.faceMatchOptIn ?? false,
  };
}

function buildConsentSnapshot(input: {
  exactFaceLinks: ProjectReleaseLinkSnapshot["exactFaceLinks"];
  wholeAssetLinks: ProjectReleaseLinkSnapshot["wholeAssetLinks"];
  fallbackLinks: ProjectReleaseLinkSnapshot["fallbackLinks"];
  assigneeDisplayById: Map<string, ProjectFaceAssigneeDisplaySummary>;
  consentSummaryById: Map<string, ConsentSummaryRow>;
}) {
  const ownersById = new Map<string, ProjectReleaseConsentSnapshot["linkedOwners"][number]>();

  for (const link of input.exactFaceLinks) {
    const assignee = input.assigneeDisplayById.get(link.projectFaceAssigneeId) ?? null;
    if (!assignee) {
      continue;
    }

    ownersById.set(assignee.projectFaceAssigneeId, buildAssigneeOwnerSnapshot(assignee));
  }

  for (const link of input.wholeAssetLinks) {
    const assignee = input.assigneeDisplayById.get(link.projectFaceAssigneeId) ?? null;
    if (!assignee) {
      continue;
    }

    ownersById.set(assignee.projectFaceAssigneeId, buildAssigneeOwnerSnapshot(assignee));
  }

  for (const link of input.fallbackLinks) {
    const consent = input.consentSummaryById.get(link.consentId) ?? null;
    if (!consent) {
      continue;
    }

    ownersById.set(link.projectFaceAssigneeId, buildFallbackOwnerSnapshot({
      consentId: link.consentId,
      consent,
    }));
  }

  return {
    schemaVersion: 1,
    linkedOwners: Array.from(ownersById.values()).sort((left, right) =>
      left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId),
    ),
    linkedPeopleCount: ownersById.size,
  } satisfies ProjectReleaseConsentSnapshot;
}

function buildScopeSnapshot(input: {
  linkedOwners: ProjectReleaseConsentSnapshot["linkedOwners"];
  effectiveScopesByConsentId: Map<string, ProjectConsentScopeState[]>;
  effectiveScopesByParticipantId: Map<string, ProjectConsentScopeState[]>;
  signedScopesByConsentId: Map<string, ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"]>;
  consentSummaryById: Map<string, ConsentSummaryRow>;
}) {
  return {
    schemaVersion: 1,
    owners: input.linkedOwners
      .map((owner) => {
        const effectiveScopes = owner.consentId
          ? (input.effectiveScopesByConsentId.get(owner.consentId) ?? []).map(mapScopeStateForSnapshot)
          : owner.projectProfileParticipantId
            ? (input.effectiveScopesByParticipantId.get(owner.projectProfileParticipantId) ?? []).map(
                mapScopeStateForSnapshot,
              )
            : [];
        const signedScopes = owner.consentId
          ? input.signedScopesByConsentId.get(owner.consentId)
            ?? buildSignedScopesFromSnapshot(
              input.consentSummaryById.get(owner.consentId)?.structured_fields_snapshot ?? null,
            )
          : [];

        return {
          projectFaceAssigneeId: owner.projectFaceAssigneeId,
          identityKind: owner.identityKind,
          consentId: owner.consentId,
          recurringProfileConsentId: owner.recurringProfileConsentId,
          projectProfileParticipantId: owner.projectProfileParticipantId,
          effectiveScopes: sortScopeEntries(effectiveScopes),
          signedScopes: sortSignedScopes(signedScopes),
        };
      })
      .sort((left, right) => left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId)),
  } satisfies ProjectReleaseScopeSnapshot;
}

function groupByAssetId<T extends { asset_id: string }>(rows: T[]) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const current = grouped.get(row.asset_id) ?? [];
    current.push(row);
    grouped.set(row.asset_id, current);
  }
  return grouped;
}

function buildReleaseAssetRows(input: {
  project: FinalizedProjectRow;
  release: ProjectReleaseRow;
  workspacesById: Map<string, ProjectWorkspaceRow>;
  assets: ReleaseSourceAssetRow[];
  photoMaterializationsByAssetId: Map<string, PhotoMaterializationRow>;
  facesByMaterializationId: Map<string, PhotoFaceRow[]>;
  hiddenFaces: HiddenFaceRow[];
  blockedFaces: BlockedFaceRow[];
  faceLinks: FaceLinkRow[];
  assigneeSuppressions: AssigneeSuppressionRow[];
  consentSuppressions: ConsentSuppressionRow[];
  wholeAssetLinks: EnrichedWholeAssetLinkRow[];
  fallbacks: ManualFallbackRow[];
  assigneeDisplayById: Map<string, ProjectFaceAssigneeDisplaySummary>;
  consentSummaryById: Map<string, ConsentSummaryRow>;
  consentAssigneeIdByConsentId: Map<string, string>;
  effectiveScopesByConsentId: Map<string, ProjectConsentScopeState[]>;
  effectiveScopesByParticipantId: Map<string, ProjectConsentScopeState[]>;
  signedScopesByConsentId: Map<string, ProjectReleaseScopeSnapshot["owners"][number]["signedScopes"]>;
  snapshotCreatedAt: string;
}) {
  const hiddenFacesByAssetId = groupByAssetId(input.hiddenFaces);
  const blockedFacesByAssetId = groupByAssetId(input.blockedFaces);
  const faceLinksByAssetId = groupByAssetId(input.faceLinks);
  const assigneeSuppressionsByAssetId = groupByAssetId(input.assigneeSuppressions);
  const consentSuppressionsByAssetId = groupByAssetId(input.consentSuppressions);
  const wholeAssetLinksByAssetId = groupByAssetId(input.wholeAssetLinks);
  const fallbacksByAssetId = groupByAssetId(input.fallbacks);

  return input.assets.map((asset) => {
    const workspace = input.workspacesById.get(asset.workspace_id) ?? null;
    if (!workspace) {
      throw new HttpError(500, "project_release_lookup_failed", "Unable to resolve the release workspace snapshot.");
    }

    if (!asset.storage_bucket || !asset.storage_path) {
      throw new HttpError(500, "project_release_source_missing", "One or more release source assets are missing.");
    }

    const photoMaterialization = input.photoMaterializationsByAssetId.get(asset.id) ?? null;
    const faces = photoMaterialization
      ? (input.facesByMaterializationId.get(photoMaterialization.id) ?? [])
      : [];
    const exactFaceLinks = (faceLinksByAssetId.get(asset.id) ?? [])
      .filter((link) => !photoMaterialization || link.asset_materialization_id === photoMaterialization.id)
      .map((link) => {
        const assignee = input.assigneeDisplayById.get(link.project_face_assignee_id) ?? null;
        const face = faces.find((candidate) => candidate.id === link.asset_face_id) ?? null;
        if (!assignee || !face) {
          return null;
        }

        return {
          assetFaceId: link.asset_face_id,
          materializationId: link.asset_materialization_id,
          faceRank: face.face_rank,
          projectFaceAssigneeId: assignee.projectFaceAssigneeId,
          identityKind: assignee.identityKind,
          consentId: assignee.consentId,
          recurringProfileConsentId: assignee.recurringProfileConsentId,
          projectProfileParticipantId: assignee.projectProfileParticipantId,
          profileId: assignee.profileId,
          linkSource: link.link_source,
          matchConfidence: link.match_confidence,
        } satisfies ProjectReleaseLinkSnapshot["exactFaceLinks"][number];
      })
      .filter((row): row is ProjectReleaseLinkSnapshot["exactFaceLinks"][number] => row !== null)
      .sort((left, right) => left.faceRank - right.faceRank);

    const wholeAssetLinks = (wholeAssetLinksByAssetId.get(asset.id) ?? [])
      .map((link) => {
        const assignee = input.assigneeDisplayById.get(link.project_face_assignee_id) ?? null;
        if (!assignee) {
          return null;
        }

        return {
          projectFaceAssigneeId: assignee.projectFaceAssigneeId,
          identityKind: assignee.identityKind,
          consentId: assignee.consentId,
          recurringProfileConsentId: assignee.recurringProfileConsentId,
          projectProfileParticipantId: assignee.projectProfileParticipantId,
          profileId: assignee.profileId,
          linkSource: link.link_source,
        } satisfies ProjectReleaseLinkSnapshot["wholeAssetLinks"][number];
      })
      .filter((row): row is ProjectReleaseLinkSnapshot["wholeAssetLinks"][number] => row !== null)
      .sort((left, right) => left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId));

    const canonicalWholeAssetConsentIds = new Set(
      wholeAssetLinks
        .map((link) => link.consentId)
        .filter((value): value is string => Boolean(value)),
    );
    const fallbackLinks = asset.asset_type === "photo"
      ? (fallbacksByAssetId.get(asset.id) ?? [])
          .filter((fallback) => !canonicalWholeAssetConsentIds.has(fallback.consent_id))
          .map((fallback) => ({
            consentId: fallback.consent_id,
            projectFaceAssigneeId:
              input.consentAssigneeIdByConsentId.get(fallback.consent_id) ?? `fallback:${fallback.consent_id}`,
          }))
          .sort((left, right) => left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId))
      : [];

    const linkSnapshot = {
      schemaVersion: 1,
      exactFaceLinks,
      wholeAssetLinks,
      fallbackLinks,
    } satisfies ProjectReleaseLinkSnapshot;

    const consentSnapshot = buildConsentSnapshot({
      exactFaceLinks,
      wholeAssetLinks,
      fallbackLinks,
      assigneeDisplayById: input.assigneeDisplayById,
      consentSummaryById: input.consentSummaryById,
    });

    const reviewSnapshot = {
      schemaVersion: 1,
      faces: faces.map((face) => ({
        assetFaceId: face.id,
        materializationId: face.materialization_id,
        faceRank: face.face_rank,
        faceSource: face.face_source,
        detectionProbability: face.detection_probability,
        faceBox: face.face_box,
        faceBoxNormalized: face.face_box_normalized,
      })),
      hiddenFaces: (hiddenFacesByAssetId.get(asset.id) ?? [])
        .filter((row) => !photoMaterialization || row.asset_materialization_id === photoMaterialization.id)
        .map((row) => ({
          assetFaceId: row.asset_face_id,
          hiddenAt: row.hidden_at,
        }))
        .sort((left, right) => left.assetFaceId.localeCompare(right.assetFaceId)),
      blockedFaces: (blockedFacesByAssetId.get(asset.id) ?? [])
        .filter((row) => !photoMaterialization || row.asset_materialization_id === photoMaterialization.id)
        .map((row) => ({
          assetFaceId: row.asset_face_id,
          blockedAt: row.blocked_at,
          reason: row.reason,
        }))
        .sort((left, right) => left.assetFaceId.localeCompare(right.assetFaceId)),
      faceLinkSuppressions: (consentSuppressionsByAssetId.get(asset.id) ?? [])
        .filter((row) => !photoMaterialization || row.asset_materialization_id === photoMaterialization.id)
        .map((row) => ({
          assetFaceId: row.asset_face_id,
          projectFaceAssigneeId:
            input.consentAssigneeIdByConsentId.get(row.consent_id) ?? `fallback:${row.consent_id}`,
        }))
        .sort((left, right) =>
          `${left.assetFaceId}:${left.projectFaceAssigneeId}`.localeCompare(
            `${right.assetFaceId}:${right.projectFaceAssigneeId}`,
          ),
        ),
      assigneeLinkSuppressions: (assigneeSuppressionsByAssetId.get(asset.id) ?? [])
        .filter((row) => !photoMaterialization || row.asset_materialization_id === photoMaterialization.id)
        .map((row) => ({
          assetFaceId: row.asset_face_id,
          projectFaceAssigneeId: row.project_face_assignee_id,
        }))
        .sort((left, right) =>
          `${left.assetFaceId}:${left.projectFaceAssigneeId}`.localeCompare(
            `${right.assetFaceId}:${right.projectFaceAssigneeId}`,
          ),
        ),
      manualFaces: faces
        .filter((face) => face.face_source === "manual")
        .map((face) => ({
          assetFaceId: face.id,
          faceRank: face.face_rank,
        }))
        .sort((left, right) => left.faceRank - right.faceRank),
    } satisfies ProjectReleaseReviewSnapshot;

    const scopeSnapshot = buildScopeSnapshot({
      linkedOwners: consentSnapshot.linkedOwners,
      effectiveScopesByConsentId: input.effectiveScopesByConsentId,
      effectiveScopesByParticipantId: input.effectiveScopesByParticipantId,
      signedScopesByConsentId: input.signedScopesByConsentId,
      consentSummaryById: input.consentSummaryById,
    });

    return {
      tenant_id: input.project.tenant_id,
      release_id: input.release.id,
      project_id: input.project.id,
      workspace_id: workspace.id,
      source_asset_id: asset.id,
      asset_type: asset.asset_type,
      original_filename: asset.original_filename,
      original_storage_bucket: asset.storage_bucket,
      original_storage_path: asset.storage_path,
      content_type: asset.content_type,
      file_size_bytes: asset.file_size_bytes,
      uploaded_at: asset.uploaded_at,
      asset_metadata_snapshot: buildAssetMetadataSnapshot({
        asset,
        photoMaterialization,
      }),
      workspace_snapshot: buildWorkspaceSnapshot({
        project: input.project,
        workspace,
        release: input.release,
        snapshotCreatedAt: input.snapshotCreatedAt,
      }),
      consent_snapshot: consentSnapshot,
      link_snapshot: linkSnapshot,
      review_snapshot: reviewSnapshot,
      scope_snapshot: scopeSnapshot,
    } satisfies Omit<ProjectReleaseAssetRow, "id" | "created_at">;
  });
}

async function insertReleaseAssetRowsInChunks(
  supabase: SupabaseClient,
  rows: Array<Omit<ProjectReleaseAssetRow, "id" | "created_at">>,
) {
  for (let index = 0; index < rows.length; index += RELEASE_ASSET_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(index, index + RELEASE_ASSET_INSERT_CHUNK_SIZE);
    const { error } = await supabase.from("project_release_assets").insert(chunk);

    if (error) {
      throw new HttpError(500, "project_release_write_failed", "Unable to write release asset snapshots.");
    }
  }
}

async function upsertMediaLibraryAssetsForReleaseRows(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
  rows: Array<Pick<ProjectReleaseAssetRow, "source_asset_id">>;
}) {
  const uniqueSourceAssetIds = Array.from(new Set(input.rows.map((row) => row.source_asset_id)));
  if (uniqueSourceAssetIds.length === 0) {
    return;
  }

  const { error } = await input.supabase
    .from("media_library_assets")
    .upsert(
      uniqueSourceAssetIds.map((sourceAssetId) => ({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        source_asset_id: sourceAssetId,
        created_by: input.actorUserId,
      })),
      {
        onConflict: "tenant_id,project_id,source_asset_id",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    throw new HttpError(
      500,
      "project_release_write_failed",
      "Unable to index release assets for the Media Library.",
    );
  }
}

export async function ensureProjectReleaseSnapshot(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  actorUserId: string;
}) {
  const project = await loadFinalizedProject({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });
  const existingRelease = await loadReleaseByFinalizedAt({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    finalizedAt: project.finalized_at as string,
  });

  if (existingRelease?.status === "published") {
    return buildPublishedReleaseSummary(
      existingRelease,
      await countReleaseAssets(input.supabase, existingRelease.id),
    );
  }

  const workspacesById = await loadProjectWorkspaces({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });
  const assets = await loadEligibleSourceAssets({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });
  const assetCounts = assets.reduce(
    (counts, asset) => ({
      total: counts.total + 1,
      photo: counts.photo + Number(asset.asset_type === "photo"),
      video: counts.video + Number(asset.asset_type === "video"),
    }),
    { total: 0, photo: 0, video: 0 },
  );

  const release =
    existingRelease
    ?? await resolveOrCreateBuildingRelease({
      supabase: input.supabase,
      project,
      actorUserId: input.actorUserId,
      workspacesById,
      assetCounts,
    });

  if (release.status === "published") {
    return buildPublishedReleaseSummary(
      release,
      await countReleaseAssets(input.supabase, release.id),
    );
  }

  // A repair retry rebuilds child rows in place so repeated finalize calls can recover a partial build.
  const { error: deleteError } = await input.supabase
    .from("project_release_assets")
    .delete()
    .eq("release_id", release.id);

  if (deleteError) {
    throw new HttpError(500, "project_release_write_failed", "Unable to repair the release snapshot.");
  }

  const photoAssetIds = assets
    .filter((asset) => asset.asset_type === "photo")
    .map((asset) => asset.id);
  const photoMaterializationsByAssetId = await loadCurrentPhotoMaterializations(
    input.supabase,
    input.tenantId,
    input.projectId,
    photoAssetIds,
  );
  const facesByMaterializationId = await loadMaterializationFaces(
    input.supabase,
    Array.from(new Set(Array.from(photoMaterializationsByAssetId.values()).map((row) => row.id))),
  );
  const currentMaterializationIdByAssetId = new Map(
    Array.from(photoMaterializationsByAssetId.entries()).map(([assetId, materialization]) => [assetId, materialization.id] as const),
  );
  const [
    hiddenFaces,
    blockedFaces,
    faceLinks,
    assigneeSuppressions,
    consentSuppressions,
    wholeAssetLinks,
    fallbacks,
  ] = await Promise.all([
    loadCurrentHiddenFacesForAssets(
      input.supabase,
      input.tenantId,
      input.projectId,
      photoAssetIds,
      currentMaterializationIdByAssetId,
    ),
    loadCurrentBlockedFacesForAssets(
      input.supabase,
      input.tenantId,
      input.projectId,
      photoAssetIds,
      currentMaterializationIdByAssetId,
    ),
    loadCurrentFaceLinks(input.supabase, input.tenantId, input.projectId, photoAssetIds),
    loadCurrentAssigneeSuppressions(input.supabase, input.tenantId, input.projectId, photoAssetIds),
    loadCurrentConsentSuppressions(input.supabase, input.tenantId, input.projectId, photoAssetIds),
    loadCurrentWholeAssetLinksForAssets({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetIds: assets.map((asset) => asset.id),
    }),
    loadManualFallbacks(input.supabase, input.tenantId, input.projectId, photoAssetIds),
  ]);

  const assigneeIds = Array.from(
    new Set([
      ...faceLinks.map((row) => row.project_face_assignee_id),
      ...wholeAssetLinks.map((row) => row.project_face_assignee_id),
    ]),
  );
  const consentIds = Array.from(
    new Set([
      ...wholeAssetLinks
        .map((row) => row.consent_id)
        .filter((value): value is string => Boolean(value)),
      ...fallbacks.map((row) => row.consent_id),
      ...consentSuppressions.map((row) => row.consent_id),
      ...Array.from(
        (await loadProjectFaceAssigneeDisplayMap({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
          assigneeIds,
        })).values(),
      )
        .map((assignee) => assignee.consentId)
        .filter((value): value is string => Boolean(value)),
    ]),
  );

  const assigneeDisplayById = await loadProjectFaceAssigneeDisplayMap({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assigneeIds,
  });
  const consentSummaryById = await loadConsentSummaries(
    input.supabase,
    input.tenantId,
    input.projectId,
    consentIds,
  );
  const participantIds = Array.from(
    new Set(
      Array.from(assigneeDisplayById.values())
        .map((assignee) => assignee.projectProfileParticipantId)
        .filter((value): value is string => Boolean(value)),
    ),
  );
  const [effectiveScopesByConsentId, effectiveScopesByParticipantId, signedScopesByConsentId, consentAssigneeIdByConsentId] =
    await Promise.all([
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
        participantIds,
      }),
      loadSignedScopeProjections(input.supabase, input.tenantId, input.projectId, consentIds),
      loadProjectConsentFaceAssigneeIdsByConsentIds({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        consentIds,
      }),
    ]);

  const snapshotCreatedAt = new Date().toISOString();
  const releaseAssetRows = buildReleaseAssetRows({
    project,
    release,
    workspacesById,
    assets,
    photoMaterializationsByAssetId,
    facesByMaterializationId,
    hiddenFaces: hiddenFaces as HiddenFaceRow[],
    blockedFaces: blockedFaces as BlockedFaceRow[],
    faceLinks,
    assigneeSuppressions,
    consentSuppressions,
    wholeAssetLinks,
    fallbacks,
    assigneeDisplayById,
    consentSummaryById,
    consentAssigneeIdByConsentId,
    effectiveScopesByConsentId,
    effectiveScopesByParticipantId,
    signedScopesByConsentId,
    snapshotCreatedAt,
  });

  await insertReleaseAssetRowsInChunks(input.supabase, releaseAssetRows);
  await upsertMediaLibraryAssetsForReleaseRows({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    actorUserId: input.actorUserId,
    rows: releaseAssetRows,
  });

  const projectSnapshot = buildProjectSnapshot({
    project,
    release: {
      ...release,
      status: "published",
      snapshot_created_at: snapshotCreatedAt,
    },
    workspacesById,
    assetCounts,
  });

  const { data: publishedRelease, error: publishError } = await input.supabase
    .from("project_releases")
    .update({
      status: "published",
      snapshot_created_at: snapshotCreatedAt,
      project_snapshot: projectSnapshot,
    })
    .eq("id", release.id)
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("status", "building")
    .select(
      "id, tenant_id, project_id, release_version, status, created_by, created_at, source_project_finalized_at, source_project_finalized_by, snapshot_created_at, project_snapshot",
    )
    .maybeSingle();

  if (publishError) {
    throw new HttpError(500, "project_release_write_failed", "Unable to publish the release snapshot.");
  }

  if (!publishedRelease) {
    const repairedRelease = await loadReleaseByFinalizedAt({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      finalizedAt: project.finalized_at as string,
    });

    if (repairedRelease?.status === "published") {
      return buildPublishedReleaseSummary(repairedRelease, releaseAssetRows.length);
    }

    throw new HttpError(409, "project_release_publish_conflict", "Release publication conflicted with another update.");
  }

  return buildPublishedReleaseSummary(publishedRelease as ProjectReleaseRow, releaseAssetRows.length);
}

export async function loadProjectRelease(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("project_releases")
    .select(
      "id, tenant_id, project_id, release_version, status, created_by, created_at, source_project_finalized_at, source_project_finalized_by, snapshot_created_at, project_snapshot",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("status", "published")
    .order("release_version", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_release_lookup_failed", "Unable to load the project release.");
  }

  return (data as ProjectReleaseRow | null) ?? null;
}

export async function authorizeMediaLibraryAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  return authorizeMediaLibraryAccessWithCustomRoles(input);
}

function sortMediaLibraryItems(left: MediaLibraryListItem, right: MediaLibraryListItem) {
  const releaseDateCompare = right.releaseCreatedAt.localeCompare(left.releaseCreatedAt);
  if (releaseDateCompare !== 0) {
    return releaseDateCompare;
  }

  const assetDateCompare = right.row.created_at.localeCompare(left.row.created_at);
  if (assetDateCompare !== 0) {
    return assetDateCompare;
  }

  return right.row.id.localeCompare(left.row.id);
}

function buildMediaLibraryLineageKey(projectId: string, sourceAssetId: string) {
  return `${projectId}:${sourceAssetId}`;
}

export function normalizeMediaLibraryPaginationInput(input: {
  page?: number | null;
  limit?: number | null;
}) {
  const page = Number.isInteger(input.page) && (input.page ?? 0) > 0 ? input.page as number : 1;
  const limit = MEDIA_LIBRARY_ALLOWED_PAGE_SIZES.includes(input.limit as (typeof MEDIA_LIBRARY_ALLOWED_PAGE_SIZES)[number])
    ? input.limit as (typeof MEDIA_LIBRARY_ALLOWED_PAGE_SIZES)[number]
    : MEDIA_LIBRARY_DEFAULT_PAGE_SIZE;

  return { page, limit };
}

function buildMediaLibraryPagination(input: {
  page?: number | null;
  limit?: number | null;
  totalCount: number;
}) {
  const normalized = normalizeMediaLibraryPaginationInput(input);
  const totalPages = Math.max(1, Math.ceil(input.totalCount / normalized.limit));
  const page = Math.min(normalized.page, totalPages);

  return {
    page,
    limit: normalized.limit,
    totalCount: input.totalCount,
    totalPages,
    hasPreviousPage: page > 1,
    hasNextPage: page < totalPages,
  } satisfies MediaLibraryPagination;
}

function sliceMediaLibraryPage<T>(items: T[], pagination: MediaLibraryPagination) {
  const offset = (pagination.page - 1) * pagination.limit;
  return items.slice(offset, offset + pagination.limit);
}

function sortMediaLibraryFolderRows(a: MediaLibraryFolderRow, b: MediaLibraryFolderRow) {
  const byName = a.name.localeCompare(b.name, undefined, {
    sensitivity: "base",
    numeric: true,
  });
  return byName === 0 ? a.id.localeCompare(b.id) : byName;
}

function buildVisibleMediaLibraryFolderTree(input: {
  folders: MediaLibraryFolderRow[];
  assetCountByFolderId?: Map<string, number>;
}) {
  const rowsById = new Map(input.folders.map((folder) => [folder.id, folder] as const));
  const childrenByParentId = new Map<string | null, MediaLibraryFolderRow[]>();
  for (const folder of input.folders) {
    if (folder.parent_folder_id && !rowsById.has(folder.parent_folder_id)) {
      continue;
    }

    const parentKey = folder.parent_folder_id ?? null;
    const children = childrenByParentId.get(parentKey) ?? [];
    children.push(folder);
    childrenByParentId.set(parentKey, children);
  }

  for (const children of childrenByParentId.values()) {
    children.sort(sortMediaLibraryFolderRows);
  }

  const flatOptions: MediaLibraryFolderOption[] = [];
  const visited = new Set<string>();

  function mapFolder(
    folder: MediaLibraryFolderRow,
    depth: number,
    path: MediaLibraryFolderPathSegment[],
  ): MediaLibraryFolderTreeNode | null {
    if (visited.has(folder.id)) {
      return null;
    }
    visited.add(folder.id);

    const nextPath = [...path, { id: folder.id, name: folder.name }];
    const children = (childrenByParentId.get(folder.id) ?? [])
      .map((child) => mapFolder(child, depth + 1, nextPath))
      .filter((child): child is MediaLibraryFolderTreeNode => Boolean(child));
    const descendantIds = children.flatMap((child) => [child.id, ...child.descendantIds]);
    const node: MediaLibraryFolderTreeNode = {
      id: folder.id,
      name: folder.name,
      parentFolderId: folder.parent_folder_id,
      assetCount: input.assetCountByFolderId?.get(folder.id) ?? 0,
      depth,
      path: nextPath,
      pathLabel: nextPath.map((segment) => segment.name).join(" / "),
      descendantIds,
      children,
    };
    flatOptions.push({
      id: node.id,
      name: node.name,
      parentFolderId: node.parentFolderId,
      assetCount: node.assetCount,
      depth: node.depth,
      path: node.path,
      pathLabel: node.pathLabel,
      descendantIds: node.descendantIds,
    });
    return node;
  }

  const tree = (childrenByParentId.get(null) ?? [])
    .map((folder) => mapFolder(folder, 0, []))
    .filter((folder): folder is MediaLibraryFolderTreeNode => Boolean(folder));

  return {
    tree,
    flatOptions,
    visibleFolderById: new Map(flatOptions.map((folder) => [folder.id, folder] as const)),
  };
}

export async function listMediaLibraryAssets(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  await authorizeMediaLibraryAccess({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const { data: releaseRows, error: releaseError } = await input.supabase
    .from("project_releases")
    .select("id, project_id, release_version, source_project_finalized_at")
    .eq("tenant_id", input.tenantId)
    .eq("status", "published")
    .order("release_version", { ascending: false })
    .order("source_project_finalized_at", { ascending: false });

  if (releaseError) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to load Media Library releases.");
  }

  const latestReleaseByProjectId = new Map<
    string,
    {
      id: string;
      project_id: string;
      release_version: number;
      source_project_finalized_at: string;
    }
  >();
  for (const row of (releaseRows ?? []) as Array<{
    id: string;
    project_id: string;
    release_version: number;
    source_project_finalized_at: string;
  }>) {
    if (!latestReleaseByProjectId.has(row.project_id)) {
      latestReleaseByProjectId.set(row.project_id, row);
    }
  }

  const releaseIds = Array.from(latestReleaseByProjectId.values()).map((row) => row.id);
  if (releaseIds.length === 0) {
    return [] as MediaLibraryListItem[];
  }

  const { data, error } = await input.supabase
    .from("project_release_assets")
    .select(
      "id, tenant_id, release_id, project_id, workspace_id, source_asset_id, asset_type, original_filename, original_storage_bucket, original_storage_path, content_type, file_size_bytes, uploaded_at, created_at, asset_metadata_snapshot, workspace_snapshot, consent_snapshot, link_snapshot, review_snapshot, scope_snapshot",
    )
    .eq("tenant_id", input.tenantId)
    .in("release_id", releaseIds);

  if (error) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to load Media Library assets.");
  }

  const rows = (data ?? []) as ProjectReleaseAssetRow[];
  return rows
    .map((row) => ({
      row,
      releaseCreatedAt: row.workspace_snapshot.release.createdAt,
      releaseVersion: row.workspace_snapshot.release.releaseVersion,
      projectName: row.workspace_snapshot.project.name,
      workspaceName: row.workspace_snapshot.workspace.name,
    }))
    .sort(sortMediaLibraryItems);
}

export async function getMediaLibraryPageData(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId?: string | null;
  page?: number | null;
  limit?: number | null;
}) {
  const [baseItems, foldersResult, access] = await Promise.all([
    listMediaLibraryAssets(input),
    input.supabase
      .from("media_library_folders")
      .select("id, tenant_id, name, parent_folder_id, archived_at")
      .eq("tenant_id", input.tenantId)
      .is("archived_at", null)
      .order("name", { ascending: true }),
    authorizeMediaLibraryAccess(input),
  ]);

  if (foldersResult.error) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to load Media Library folders.");
  }

  const activeFolderRows = (foldersResult.data ?? []) as MediaLibraryFolderRow[];
  const emptyTree = buildVisibleMediaLibraryFolderTree({ folders: activeFolderRows });
  const activeFolderById = emptyTree.visibleFolderById;
  const requestedFolderId = input.folderId?.trim() ? input.folderId.trim() : null;
  if (requestedFolderId && !activeFolderById.has(requestedFolderId)) {
    throw new HttpError(404, "folder_not_found", "Folder not found.");
  }

  if (baseItems.length === 0) {
    const pagination = buildMediaLibraryPagination({
      page: input.page,
      limit: input.limit,
      totalCount: 0,
    });
    const selectedFolder = requestedFolderId ? activeFolderById.get(requestedFolderId) ?? null : null;

    return {
      folders: emptyTree.tree,
      folderOptions: emptyTree.flatOptions,
      items: [],
      selectedFolderId: requestedFolderId,
      selectedFolder,
      selectedFolderPath: selectedFolder?.path ?? [],
      canManageFolders: access.canManageFolders,
      pagination,
    } satisfies MediaLibraryPageData;
  }

  const projectIds = Array.from(new Set(baseItems.map((item) => item.row.project_id)));
  const sourceAssetIds = Array.from(new Set(baseItems.map((item) => item.row.source_asset_id)));
  const identityResult = await input.supabase
    .from("media_library_assets")
    .select("id, tenant_id, project_id, source_asset_id")
    .eq("tenant_id", input.tenantId)
    .in("project_id", projectIds)
    .in("source_asset_id", sourceAssetIds);

  if (identityResult.error) {
    throw new HttpError(
      500,
      "media_library_lookup_failed",
      "Unable to load Media Library asset identities.",
    );
  }

  const identityByLineageKey = new Map(
    ((identityResult.data ?? []) as MediaLibraryAssetIdentityRow[]).map((row) => [
      buildMediaLibraryLineageKey(row.project_id, row.source_asset_id),
      row,
    ] as const),
  );
  const mediaLibraryAssetIds = Array.from(new Set(Array.from(identityByLineageKey.values()).map((row) => row.id)));

  const membershipByAssetId = new Map<string, MediaLibraryFolderMembershipRow>();
  if (mediaLibraryAssetIds.length > 0) {
    const membershipResult = await input.supabase
      .from("media_library_folder_memberships")
      .select("id, tenant_id, media_library_asset_id, folder_id")
      .eq("tenant_id", input.tenantId)
      .in("media_library_asset_id", mediaLibraryAssetIds);

    if (membershipResult.error) {
      throw new HttpError(
        500,
        "media_library_lookup_failed",
        "Unable to load Media Library folder memberships.",
      );
    }

    for (const membership of (membershipResult.data ?? []) as MediaLibraryFolderMembershipRow[]) {
      membershipByAssetId.set(membership.media_library_asset_id, membership);
    }
  }

  const assetCountByFolderId = new Map<string, number>();
  const enrichedItems = baseItems.map((item) => {
    const identity =
      identityByLineageKey.get(buildMediaLibraryLineageKey(item.row.project_id, item.row.source_asset_id))
      ?? null;
    const membership = identity ? membershipByAssetId.get(identity.id) ?? null : null;
    const activeFolder = membership ? activeFolderById.get(membership.folder_id) ?? null : null;

    if (activeFolder) {
      assetCountByFolderId.set(activeFolder.id, (assetCountByFolderId.get(activeFolder.id) ?? 0) + 1);
    }

    return {
      ...item,
      mediaLibraryAssetId: identity?.id ?? null,
      folderId: activeFolder?.id ?? null,
      folderName: activeFolder?.name ?? null,
    } satisfies MediaLibraryListItemWithFolder;
  });

  const folderTree = buildVisibleMediaLibraryFolderTree({
    folders: activeFolderRows,
    assetCountByFolderId,
  });
  const selectedFolder = requestedFolderId ? folderTree.visibleFolderById.get(requestedFolderId) ?? null : null;
  const items = requestedFolderId
    ? enrichedItems.filter((item) => item.folderId === requestedFolderId)
    : enrichedItems;
  const pagination = buildMediaLibraryPagination({
    page: input.page,
    limit: input.limit,
    totalCount: items.length,
  });

  return {
    folders: folderTree.tree,
    folderOptions: folderTree.flatOptions,
    items: sliceMediaLibraryPage(items, pagination),
    selectedFolderId: requestedFolderId,
    selectedFolder,
    selectedFolderPath: selectedFolder?.path ?? [],
    canManageFolders: access.canManageFolders,
    pagination,
  } satisfies MediaLibraryPageData;
}

export async function getReleaseAssetDetail(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  releaseAssetId: string;
}) {
  await authorizeMediaLibraryAccess({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  const { data, error } = await input.supabase
    .from("project_release_assets")
    .select(
      "id, tenant_id, release_id, project_id, workspace_id, source_asset_id, asset_type, original_filename, original_storage_bucket, original_storage_path, content_type, file_size_bytes, uploaded_at, created_at, asset_metadata_snapshot, workspace_snapshot, consent_snapshot, link_snapshot, review_snapshot, scope_snapshot",
    )
    .eq("tenant_id", input.tenantId)
    .eq("id", input.releaseAssetId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to load the released asset.");
  }

  const row = (data as ProjectReleaseAssetRow | null) ?? null;
  if (!row) {
    throw new HttpError(404, "release_asset_not_found", "Released asset not found.");
  }

  const { data: releaseRow, error: releaseError } = await input.supabase
    .from("project_releases")
    .select("id, project_snapshot")
    .eq("tenant_id", input.tenantId)
    .eq("id", row.release_id)
    .eq("status", "published")
    .maybeSingle();

  if (releaseError) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to validate the released asset.");
  }

  if (!releaseRow) {
    throw new HttpError(404, "release_asset_not_found", "Released asset not found.");
  }

  return {
    row,
    releaseCreatedAt: row.workspace_snapshot.release.createdAt,
    releaseVersion: row.workspace_snapshot.release.releaseVersion,
    projectName: row.workspace_snapshot.project.name,
    workspaceName: row.workspace_snapshot.workspace.name,
    releaseWorkspaceCount: ((releaseRow as Pick<ProjectReleaseRow, "project_snapshot">).project_snapshot?.workspaces ?? []).length,
    hasPhotographerWorkspaces: ((releaseRow as Pick<ProjectReleaseRow, "project_snapshot">).project_snapshot?.workspaces ?? []).some(
      (workspace) => workspace.workspaceKind === "photographer",
    ),
  } satisfies ReleaseAssetDetail;
}

export function buildReleaseSnapshotRepairWarning() {
  return {
    release: buildMissingReleaseSummary(),
    warnings: [
      {
        code: "release_snapshot_pending_repair",
        message:
          "Project finalized, but the release snapshot is not available yet. Retry finalization to repair it.",
      },
    ],
  };
}
