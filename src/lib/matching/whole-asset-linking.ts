import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  ensureProjectConsentFaceAssignee,
  ensureProjectRecurringConsentFaceAssignee,
  loadProjectFaceAssigneeRowsByIds,
  type ProjectFaceAssigneeKind,
} from "@/lib/matching/project-face-assignees";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

export type WholeAssetLinkRow = {
  asset_id: string;
  project_face_assignee_id: string;
  tenant_id: string;
  project_id: string;
  workspace_id?: string | null;
  link_source: "manual";
  created_at: string;
  created_by: string | null;
  updated_at: string;
};

export type EnrichedWholeAssetLinkRow = WholeAssetLinkRow & {
  identity_kind: ProjectFaceAssigneeKind;
  consent_id: string | null;
  recurring_profile_consent_id: string | null;
  project_profile_participant_id: string | null;
  profile_id: string | null;
};

export type ManualWholeAssetLinkResult =
  | {
      kind: "linked";
      mode: "whole_asset";
    }
  | {
      kind: "already_linked";
      mode: "whole_asset";
    }
  | {
      kind: "exact_face_conflict";
      mode: "whole_asset";
      assetFaceId: string;
      faceRank: number | null;
      linkSource: "manual" | "auto";
    };

export type ManualWholeAssetUnlinkResult = {
  kind: "unlinked" | "already_unlinked";
  mode: "whole_asset";
};

type WholeAssetScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetId: string;
  actorUserId?: string | null;
};

type ManualWholeAssetProjectAssigneeInput = WholeAssetScopeInput & {
  projectFaceAssigneeId: string;
};

async function requireWholeAssetLinkableAsset(input: WholeAssetScopeInput) {
  const { data, error } = await input.supabase
    .from("assets")
    .select("id, asset_type, status, archived_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.assetId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to load the asset.");
  }

  const asset = (data as {
    id: string;
    asset_type: string;
    status: string;
    archived_at: string | null;
  } | null) ?? null;
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

async function loadCurrentWholeAssetLinkRowsForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as WholeAssetLinkRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    let query = supabase
      .from("asset_assignee_links")
      .select(
        "asset_id, project_face_assignee_id, tenant_id, project_id, workspace_id, link_source, created_at, created_by, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "whole_asset_link_lookup_failed", "Unable to load whole-asset links.");
    }

    return (data ?? []) as WholeAssetLinkRow[];
  });

  return rows;
}

export async function loadCurrentWholeAssetLinksForAssets(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetIds: string[];
}) {
  const rows = await loadCurrentWholeAssetLinkRowsForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    Array.from(new Set(input.assetIds)),
  );
  if (rows.length === 0) {
    return [] as EnrichedWholeAssetLinkRow[];
  }

  const assigneeRowsById = await loadProjectFaceAssigneeRowsByIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    assigneeIds: rows.map((row) => row.project_face_assignee_id),
  });

  return rows
    .map((row) => {
      const assignee = assigneeRowsById.get(row.project_face_assignee_id) ?? null;
      if (!assignee) {
        return null;
      }

      return {
        ...row,
        identity_kind: assignee.assignee_kind,
        consent_id: assignee.consent_id,
        recurring_profile_consent_id: assignee.recurring_profile_consent_id,
        project_profile_participant_id: assignee.project_profile_participant_id,
        profile_id: assignee.recurring_profile_id,
      } satisfies EnrichedWholeAssetLinkRow;
    })
    .filter((row): row is EnrichedWholeAssetLinkRow => row !== null);
}

export async function loadCurrentWholeAssetLinksForAsset(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetId: string;
}) {
  const rows = await loadCurrentWholeAssetLinksForAssets({
    ...input,
    assetIds: [input.assetId],
  });

  return rows.filter((row) => row.asset_id === input.assetId);
}

async function loadExactFaceConflictForAssignee(input: ManualWholeAssetProjectAssigneeInput) {
  let query = input.supabase
    .from("asset_face_consent_links")
    .select("asset_face_id, link_source")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("project_face_assignee_id", input.projectFaceAssigneeId);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new HttpError(500, "photo_face_link_lookup_failed", "Unable to load current face assignments.");
  }

  const exactFaceLink = (data as {
    asset_face_id: string;
    link_source: "manual" | "auto";
  } | null) ?? null;
  if (!exactFaceLink) {
    return null;
  }

  const { data: faceData, error: faceError } = await input.supabase
    .from("asset_face_materialization_faces")
    .select("id, face_rank")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("id", exactFaceLink.asset_face_id)
    .maybeSingle();

  if (faceError) {
    throw new HttpError(500, "photo_face_link_lookup_failed", "Unable to load current face assignments.");
  }

  return {
    assetFaceId: exactFaceLink.asset_face_id,
    faceRank: ((faceData as { id: string; face_rank: number | null } | null) ?? null)?.face_rank ?? null,
    linkSource: exactFaceLink.link_source,
  };
}

export async function deleteWholeAssetLinkForAssignee(input: ManualWholeAssetProjectAssigneeInput) {
  let query = input.supabase
    .from("asset_assignee_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("project_face_assignee_id", input.projectFaceAssigneeId);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { error } = await query;

  if (error) {
    throw new HttpError(500, "whole_asset_link_delete_failed", "Unable to delete the whole-asset link.");
  }
}

export async function deleteWholeAssetLinksForAssigneeIds(input: WholeAssetScopeInput & {
  projectFaceAssigneeIds: string[];
}) {
  const uniqueAssigneeIds = Array.from(new Set(input.projectFaceAssigneeIds));
  if (uniqueAssigneeIds.length === 0) {
    return;
  }

  let query = input.supabase
    .from("asset_assignee_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .in("project_face_assignee_id", uniqueAssigneeIds);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { error } = await query;

  if (error) {
    throw new HttpError(500, "whole_asset_link_delete_failed", "Unable to delete whole-asset links.");
  }
}

export async function manualLinkWholeAssetToProjectFaceAssignee(
  input: ManualWholeAssetProjectAssigneeInput,
): Promise<ManualWholeAssetLinkResult> {
  await requireWholeAssetLinkableAsset(input);

  const assigneeRowsById = await loadProjectFaceAssigneeRowsByIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    assigneeIds: [input.projectFaceAssigneeId],
  });
  if (!assigneeRowsById.has(input.projectFaceAssigneeId)) {
    throw new HttpError(404, "project_face_assignee_not_found", "Project assignee not found.");
  }

  const exactFaceConflict = await loadExactFaceConflictForAssignee(input);
  if (exactFaceConflict) {
    return {
      kind: "exact_face_conflict",
      mode: "whole_asset",
      assetFaceId: exactFaceConflict.assetFaceId,
      faceRank: exactFaceConflict.faceRank,
      linkSource: exactFaceConflict.linkSource,
    };
  }

  const existingLinks = await loadCurrentWholeAssetLinksForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });
  const alreadyLinked = existingLinks.some((row) => row.project_face_assignee_id === input.projectFaceAssigneeId);
  if (alreadyLinked) {
    return {
      kind: "already_linked",
      mode: "whole_asset",
    };
  }

  const nowIso = new Date().toISOString();
  const { error } = await input.supabase.from("asset_assignee_links").upsert(
    {
      asset_id: input.assetId,
      project_face_assignee_id: input.projectFaceAssigneeId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      workspace_id: input.workspaceId ?? null,
      link_source: "manual",
      created_by: input.actorUserId ?? null,
      updated_at: nowIso,
    },
    {
      onConflict: "asset_id,project_face_assignee_id",
    },
  );

  if (error) {
    throw new HttpError(500, "whole_asset_link_write_failed", "Unable to save the whole-asset link.");
  }

  return {
    kind: "linked",
    mode: "whole_asset",
  };
}

export async function manualLinkWholeAssetToConsent(
  input: WholeAssetScopeInput & {
    consentId: string;
  },
) {
  const assignee = await ensureProjectConsentFaceAssignee({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    consentId: input.consentId,
  });

  return manualLinkWholeAssetToProjectFaceAssignee({
    ...input,
    projectFaceAssigneeId: assignee.id,
  });
}

export async function manualLinkWholeAssetToRecurringProjectParticipant(
  input: WholeAssetScopeInput & {
    projectProfileParticipantId: string;
  },
) {
  const { assignee } = await ensureProjectRecurringConsentFaceAssignee({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    projectProfileParticipantId: input.projectProfileParticipantId,
  });

  return manualLinkWholeAssetToProjectFaceAssignee({
    ...input,
    projectFaceAssigneeId: assignee.id,
  });
}

export async function manualUnlinkWholeAssetAssignment(
  input: ManualWholeAssetProjectAssigneeInput,
): Promise<ManualWholeAssetUnlinkResult> {
  await requireWholeAssetLinkableAsset(input);

  const existingLinks = await loadCurrentWholeAssetLinksForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });
  const existing = existingLinks.find((row) => row.project_face_assignee_id === input.projectFaceAssigneeId) ?? null;
  if (!existing) {
    return {
      kind: "already_unlinked",
      mode: "whole_asset",
    };
  }

  await deleteWholeAssetLinkForAssignee(input);

  return {
    kind: "unlinked",
    mode: "whole_asset",
  };
}

export async function manualUnlinkWholeAssetFromConsent(
  input: WholeAssetScopeInput & {
    consentId: string;
  },
) {
  const assignee = await ensureProjectConsentFaceAssignee({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    consentId: input.consentId,
  });

  return manualUnlinkWholeAssetAssignment({
    ...input,
    projectFaceAssigneeId: assignee.id,
  });
}

export async function manualUnlinkWholeAssetFromRecurringProjectParticipant(
  input: WholeAssetScopeInput & {
    projectProfileParticipantId: string;
  },
) {
  const existingLinks = await loadCurrentWholeAssetLinksForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });
  const assigneeIds = existingLinks
    .filter((row) => row.project_profile_participant_id === input.projectProfileParticipantId)
    .map((row) => row.project_face_assignee_id);

  if (assigneeIds.length === 0) {
    return {
      kind: "already_unlinked",
      mode: "whole_asset",
    } satisfies ManualWholeAssetUnlinkResult;
  }

  await deleteWholeAssetLinksForAssigneeIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
    projectFaceAssigneeIds: assigneeIds,
  });

  return {
    kind: "unlinked",
    mode: "whole_asset",
  } satisfies ManualWholeAssetUnlinkResult;
}
