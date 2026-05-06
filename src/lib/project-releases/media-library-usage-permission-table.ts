import type { ReleasePhotoFaceContext } from "@/lib/project-releases/media-library-release-overlays";
import type { MediaLibraryUsagePermissionOwnerSummary } from "@/lib/project-releases/media-library-release-safety";

type EffectiveScope = MediaLibraryUsagePermissionOwnerSummary["effectiveScopes"][number];

export type MediaLibraryUsagePermissionCellStatus =
  | EffectiveScope["status"]
  | "blocked"
  | "not_available";

export type MediaLibraryUsagePermissionColumnKind = "face" | "asset_link";

export type MediaLibraryUsagePermissionColumn = {
  id: string;
  kind: MediaLibraryUsagePermissionColumnKind;
  assetFaceId: string | null;
  faceRank: number | null;
  projectFaceAssigneeId: string | null;
  linkSource: "manual" | "auto" | null;
  ownerStatus: MediaLibraryUsagePermissionOwnerSummary["currentStatus"] | null;
  visualState: ReleasePhotoFaceContext["visualState"] | null;
  isBlocked: boolean;
  isManual: boolean;
  hasRestrictedState: boolean;
};

export type MediaLibraryUsagePermissionCell = {
  columnId: string;
  status: MediaLibraryUsagePermissionCellStatus;
};

export type MediaLibraryUsagePermissionRow = {
  id: string;
  templateKey: string;
  scopeKey: string;
  label: string;
  cells: MediaLibraryUsagePermissionCell[];
  finalStatus: "granted" | "blocked";
};

export type MediaLibraryUsagePermissionTable = {
  columns: MediaLibraryUsagePermissionColumn[];
  rows: MediaLibraryUsagePermissionRow[];
};

function buildScopeId(scope: Pick<EffectiveScope, "templateKey" | "scopeKey">) {
  return `${scope.templateKey}:${scope.scopeKey}`;
}

function sortOwnersBySnapshotContext(
  owners: MediaLibraryUsagePermissionOwnerSummary[],
) {
  return [...owners].sort((left, right) => {
    const leftFaceRank = left.exactFaceLinks[0]?.faceRank ?? Number.MAX_SAFE_INTEGER;
    const rightFaceRank = right.exactFaceLinks[0]?.faceRank ?? Number.MAX_SAFE_INTEGER;
    if (leftFaceRank !== rightFaceRank) {
      return leftFaceRank - rightFaceRank;
    }

    return left.projectFaceAssigneeId.localeCompare(right.projectFaceAssigneeId);
  });
}

function buildOwnerScopeById(owner: MediaLibraryUsagePermissionOwnerSummary) {
  return new Map(owner.effectiveScopes.map((scope) => [buildScopeId(scope), scope] as const));
}

function getCellStatus(input: {
  owner: MediaLibraryUsagePermissionOwnerSummary | null;
  scopeId: string;
  scopeByOwnerId: Map<string, Map<string, EffectiveScope>>;
  isBlockedColumn: boolean;
}): MediaLibraryUsagePermissionCellStatus {
  if (input.isBlockedColumn) {
    return "blocked";
  }

  if (!input.owner) {
    return "not_available";
  }

  if (input.owner.currentStatus === "revoked") {
    return "revoked";
  }

  return input.scopeByOwnerId
    .get(input.owner.projectFaceAssigneeId)
    ?.get(input.scopeId)
    ?.status ?? "not_available";
}

export function buildMediaLibraryUsagePermissionTable(input: {
  owners: MediaLibraryUsagePermissionOwnerSummary[];
  faces?: ReleasePhotoFaceContext[];
}): MediaLibraryUsagePermissionTable {
  const ownerByAssigneeId = new Map(
    input.owners.map((owner) => [owner.projectFaceAssigneeId, owner] as const),
  );
  const representedOwnerIds = new Set<string>();
  const visibleFaces = [...(input.faces ?? [])].sort((left, right) => left.faceRank - right.faceRank);
  const columns: MediaLibraryUsagePermissionColumn[] = [];

  for (const face of visibleFaces) {
    const owner = face.linkedOwner;
    if (owner) {
      representedOwnerIds.add(owner.projectFaceAssigneeId);
    }

    columns.push({
      id: `face:${face.assetFaceId}`,
      kind: "face",
      assetFaceId: face.assetFaceId,
      faceRank: face.faceRank,
      projectFaceAssigneeId: owner?.projectFaceAssigneeId ?? null,
      linkSource: face.exactFaceLink?.linkSource ?? null,
      ownerStatus: owner?.currentStatus ?? null,
      visualState: face.visualState,
      isBlocked: face.isBlocked || face.visualState === "blocked",
      isManual: face.isManual || face.visualState === "linked_manual" || face.visualState === "manual_unlinked",
      hasRestrictedState: Boolean(owner?.hasRestrictedState) || face.isBlocked,
    });
  }

  const unrepresentedOwners = sortOwnersBySnapshotContext(input.owners).filter(
    (owner) => !representedOwnerIds.has(owner.projectFaceAssigneeId),
  );

  for (const owner of unrepresentedOwners) {
    columns.push({
      id: `owner:${owner.projectFaceAssigneeId}`,
      kind: "asset_link",
      assetFaceId: null,
      faceRank: null,
      projectFaceAssigneeId: owner.projectFaceAssigneeId,
      linkSource: owner.hasWholeAssetLink || owner.hasFallbackLink ? "manual" : null,
      ownerStatus: owner.currentStatus,
      visualState: null,
      isBlocked: false,
      isManual: owner.hasWholeAssetLink || owner.hasFallbackLink,
      hasRestrictedState: owner.hasRestrictedState,
    });
  }

  const scopeById = new Map<string, EffectiveScope>();
  const scopeByOwnerId = new Map<string, Map<string, EffectiveScope>>();
  for (const owner of input.owners) {
    const ownerScopeById = buildOwnerScopeById(owner);
    scopeByOwnerId.set(owner.projectFaceAssigneeId, ownerScopeById);
    for (const scope of owner.effectiveScopes) {
      scopeById.set(buildScopeId(scope), scope);
    }
  }

  const rows = [...scopeById.values()]
    .sort((left, right) => {
      if (left.templateKey !== right.templateKey) {
        return left.templateKey.localeCompare(right.templateKey);
      }

      return left.scopeKey.localeCompare(right.scopeKey);
    })
    .map((scope) => {
      const scopeId = buildScopeId(scope);
      const cells = columns.map((column) => {
        const owner = column.projectFaceAssigneeId
          ? ownerByAssigneeId.get(column.projectFaceAssigneeId) ?? null
          : null;
        return {
          columnId: column.id,
          status: getCellStatus({
            owner,
            scopeId,
            scopeByOwnerId,
            isBlockedColumn: column.isBlocked || !owner,
          }),
        } satisfies MediaLibraryUsagePermissionCell;
      });
      const finalStatus =
        cells.length > 0 && cells.every((cell) => cell.status === "granted")
          ? "granted"
          : "blocked";

      return {
        id: scopeId,
        templateKey: scope.templateKey,
        scopeKey: scope.scopeKey,
        label: scope.label,
        cells,
        finalStatus,
      } satisfies MediaLibraryUsagePermissionRow;
    });

  return { columns, rows };
}
