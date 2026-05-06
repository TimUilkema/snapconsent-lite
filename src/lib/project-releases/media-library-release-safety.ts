import type { ProjectReleaseAssetRow } from "@/lib/project-releases/types";

export type MediaLibrarySafetyState = "clear" | "restricted" | "blocked";
export type MediaLibrarySafetyBadge = "blocked" | "restricted" | "manual";

export type MediaLibraryReleaseSafetySummary = {
  blockedFaceCount: number;
  hiddenFaceCount: number;
  suppressedFaceCount: number;
  manualFaceCount: number;
  revokedLinkedOwnerCount: number;
  nonGrantedEffectiveScopeCount: number;
  hasBlockedFaces: boolean;
  hasHiddenFaces: boolean;
  hasSuppressedFaces: boolean;
  hasManualFaces: boolean;
  hasRevokedLinkedOwners: boolean;
  hasNonGrantedEffectiveScopes: boolean;
  hasRestrictedState: boolean;
  hasLowLevelReviewContext: boolean;
  requiresDownloadConfirmation: boolean;
  primaryState: MediaLibrarySafetyState;
  badges: MediaLibrarySafetyBadge[];
};

export type MediaLibraryUsagePermissionOwnerSummary = {
  projectFaceAssigneeId: string;
  displayName: string | null;
  email: string | null;
  identityKind: ProjectReleaseAssetRow["consent_snapshot"]["linkedOwners"][number]["identityKind"] | null;
  currentStatus: ProjectReleaseAssetRow["consent_snapshot"]["linkedOwners"][number]["currentStatus"] | null;
  effectiveScopes: ProjectReleaseAssetRow["scope_snapshot"]["owners"][number]["effectiveScopes"];
  effectiveScopeCount: number;
  nonGrantedEffectiveScopeCount: number;
  hasNonGrantedEffectiveScopes: boolean;
  hasRestrictedState: boolean;
  exactFaceLinks: ProjectReleaseAssetRow["link_snapshot"]["exactFaceLinks"];
  hasWholeAssetLink: boolean;
  hasFallbackLink: boolean;
};

function sortStrings(values: Iterable<string>) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function collectManualFaceIds(
  reviewSnapshot: ProjectReleaseAssetRow["review_snapshot"],
) {
  const manualFaceIds = new Set<string>();

  for (const face of reviewSnapshot.manualFaces) {
    manualFaceIds.add(face.assetFaceId);
  }

  for (const face of reviewSnapshot.faces) {
    if (face.faceSource === "manual") {
      manualFaceIds.add(face.assetFaceId);
    }
  }

  return manualFaceIds;
}

export function collectSuppressedFaceIds(
  reviewSnapshot: ProjectReleaseAssetRow["review_snapshot"],
) {
  const faceIds = new Set<string>();

  for (const suppression of reviewSnapshot.faceLinkSuppressions) {
    faceIds.add(suppression.assetFaceId);
  }

  for (const suppression of reviewSnapshot.assigneeLinkSuppressions) {
    faceIds.add(suppression.assetFaceId);
  }

  return sortStrings(faceIds);
}

export function deriveMediaLibraryReleaseSafety(
  row: Pick<ProjectReleaseAssetRow, "consent_snapshot" | "review_snapshot" | "scope_snapshot">,
): MediaLibraryReleaseSafetySummary {
  const blockedFaceCount = row.review_snapshot.blockedFaces.length;
  const hiddenFaceCount = row.review_snapshot.hiddenFaces.length;
  const suppressedFaceCount = collectSuppressedFaceIds(row.review_snapshot).length;
  const manualFaceCount = collectManualFaceIds(row.review_snapshot).size;
  const revokedLinkedOwnerCount = row.consent_snapshot.linkedOwners.filter(
    (owner) => owner.currentStatus === "revoked",
  ).length;
  const nonGrantedEffectiveScopeCount = row.scope_snapshot.owners.flatMap((owner) => owner.effectiveScopes).filter(
    (scope) => scope.status !== "granted",
  ).length;

  const hasBlockedFaces = blockedFaceCount > 0;
  const hasHiddenFaces = hiddenFaceCount > 0;
  const hasSuppressedFaces = suppressedFaceCount > 0;
  const hasManualFaces = manualFaceCount > 0;
  const hasRevokedLinkedOwners = revokedLinkedOwnerCount > 0;
  const hasNonGrantedEffectiveScopes = nonGrantedEffectiveScopeCount > 0;
  const hasRestrictedState = hasRevokedLinkedOwners || hasNonGrantedEffectiveScopes;
  const hasLowLevelReviewContext = hasHiddenFaces || hasSuppressedFaces || hasManualFaces;
  const requiresDownloadConfirmation = hasBlockedFaces || hasRestrictedState;

  return {
    blockedFaceCount,
    hiddenFaceCount,
    suppressedFaceCount,
    manualFaceCount,
    revokedLinkedOwnerCount,
    nonGrantedEffectiveScopeCount,
    hasBlockedFaces,
    hasHiddenFaces,
    hasSuppressedFaces,
    hasManualFaces,
    hasRevokedLinkedOwners,
    hasNonGrantedEffectiveScopes,
    hasRestrictedState,
    hasLowLevelReviewContext,
    requiresDownloadConfirmation,
    primaryState: hasBlockedFaces ? "blocked" : hasRestrictedState ? "restricted" : "clear",
    badges: [
      ...(hasBlockedFaces ? (["blocked"] as const) : []),
      ...(hasManualFaces ? (["manual"] as const) : []),
    ],
  };
}

export function buildMediaLibraryUsagePermissionSummaries(
  row: Pick<ProjectReleaseAssetRow, "consent_snapshot" | "link_snapshot" | "scope_snapshot">,
): MediaLibraryUsagePermissionOwnerSummary[] {
  const linkedOwnerByAssigneeId = new Map(
    row.consent_snapshot.linkedOwners.map((owner) => [owner.projectFaceAssigneeId, owner] as const),
  );
  const exactFaceLinksByAssigneeId = new Map<string, ProjectReleaseAssetRow["link_snapshot"]["exactFaceLinks"]>();

  for (const link of row.link_snapshot.exactFaceLinks) {
    const current = exactFaceLinksByAssigneeId.get(link.projectFaceAssigneeId) ?? [];
    current.push(link);
    exactFaceLinksByAssigneeId.set(link.projectFaceAssigneeId, current);
  }

  const wholeAssetAssigneeIds = new Set(
    row.link_snapshot.wholeAssetLinks.map((link) => link.projectFaceAssigneeId),
  );
  const fallbackAssigneeIds = new Set(
    row.link_snapshot.fallbackLinks.map((link) => link.projectFaceAssigneeId),
  );
  const assigneeIds = new Set<string>([
    ...linkedOwnerByAssigneeId.keys(),
    ...row.scope_snapshot.owners.map((owner) => owner.projectFaceAssigneeId),
    ...row.link_snapshot.exactFaceLinks.map((link) => link.projectFaceAssigneeId),
    ...row.link_snapshot.wholeAssetLinks.map((link) => link.projectFaceAssigneeId),
    ...row.link_snapshot.fallbackLinks.map((link) => link.projectFaceAssigneeId),
  ]);

  return sortStrings(assigneeIds).map((projectFaceAssigneeId) => {
    const linkedOwner = linkedOwnerByAssigneeId.get(projectFaceAssigneeId) ?? null;
    const scopeOwner =
      row.scope_snapshot.owners.find((owner) => owner.projectFaceAssigneeId === projectFaceAssigneeId) ?? null;
    const effectiveScopes = [...(scopeOwner?.effectiveScopes ?? [])].sort((left, right) => {
      if (left.templateKey !== right.templateKey) {
        return left.templateKey.localeCompare(right.templateKey);
      }

      return left.scopeKey.localeCompare(right.scopeKey);
    });
    const exactFaceLinks = [...(exactFaceLinksByAssigneeId.get(projectFaceAssigneeId) ?? [])].sort(
      (left, right) => left.faceRank - right.faceRank,
    );
    const nonGrantedEffectiveScopeCount = effectiveScopes.filter((scope) => scope.status !== "granted").length;

    return {
      projectFaceAssigneeId,
      displayName: linkedOwner?.displayName ?? null,
      email: linkedOwner?.email ?? null,
      identityKind: linkedOwner?.identityKind ?? scopeOwner?.identityKind ?? null,
      currentStatus: linkedOwner?.currentStatus ?? null,
      effectiveScopes,
      effectiveScopeCount: effectiveScopes.length,
      nonGrantedEffectiveScopeCount,
      hasNonGrantedEffectiveScopes: nonGrantedEffectiveScopeCount > 0,
      hasRestrictedState:
        linkedOwner?.currentStatus === "revoked" || nonGrantedEffectiveScopeCount > 0,
      exactFaceLinks,
      hasWholeAssetLink: wholeAssetAssigneeIds.has(projectFaceAssigneeId),
      hasFallbackLink: fallbackAssigneeIds.has(projectFaceAssigneeId),
    } satisfies MediaLibraryUsagePermissionOwnerSummary;
  });
}
