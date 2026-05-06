"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { PreviewableImage, type PreviewFaceOverlay } from "@/components/projects/previewable-image";
import type { ReleasePhotoFaceContext } from "@/lib/project-releases/media-library-release-overlays";

type ReleasedPhotoPreviewProps = {
  src: string;
  alt: string;
  faces: ReleasePhotoFaceContext[];
  selectedFaceId?: string | null;
  hoveredFaceId?: string | null;
  onSelectFaceId?: (faceId: string | null) => void;
  onHoverFaceId?: (faceId: string | null) => void;
};

type ReleasedPreviewOverlay = PreviewFaceOverlay & {
  ownerId: string | null;
  assetFaceId: string;
};

function buildPreviewFaceOverlays(
  faces: ReleasePhotoFaceContext[],
  labels: {
    faceLabel: (face: number) => string;
    faceBadgeLabel: (face: number) => string;
    stateBlocked: string;
    stateDetected: string;
    stateManual: string;
    linkSourceManual: string;
    linkSourceAuto: string;
    permissionsRestricted: string;
  },
) {
  return faces.map((face) => {
    const owner = face.linkedOwner;
    const label = labels.faceLabel(face.faceRank + 1);
    const linkSourceLabel =
      face.visualState === "blocked"
        ? labels.stateBlocked
        : face.visualState === "linked_manual"
          ? labels.linkSourceManual
          : face.visualState === "linked_auto"
            ? labels.linkSourceAuto
            : face.visualState === "manual_unlinked"
              ? labels.stateManual
              : labels.stateDetected;

    return {
      id: `release-face-${face.assetFaceId}`,
      href: `#release-face-${face.assetFaceId}`,
      label,
      badgeLabel: labels.faceBadgeLabel(face.faceRank + 1),
      faceBoxNormalized: face.faceBoxNormalized,
      linkSource: face.exactFaceLink?.linkSource ?? null,
      linkSourceLabel,
      tone: face.overlayTone,
      metaLabel:
        owner?.hasRestrictedState
          ? labels.permissionsRestricted
          : owner?.currentStatus === "revoked"
            ? labels.permissionsRestricted
          : linkSourceLabel,
      ownerId: owner?.projectFaceAssigneeId ?? null,
      assetFaceId: face.assetFaceId,
    } satisfies ReleasedPreviewOverlay;
  });
}

export function ReleasedPhotoPreview({
  src,
  alt,
  faces,
  selectedFaceId = null,
  hoveredFaceId = null,
  onSelectFaceId,
  onHoverFaceId,
}: ReleasedPhotoPreviewProps) {
  const t = useTranslations("mediaLibrary.detail");
  const [internalHoveredFaceId, setInternalHoveredFaceId] = useState<string | null>(null);
  const previewFaceOverlays = useMemo(
    () =>
      buildPreviewFaceOverlays(faces, {
        faceLabel: (face) => t("faceLabel", { face }),
        faceBadgeLabel: (face) => t("faceBadgeLabel", { face }),
        stateBlocked: t("overlay.stateBlocked"),
        stateDetected: t("overlay.stateDetected"),
        stateManual: t("overlay.stateManual"),
        linkSourceManual: t("overlay.linkSourceManual"),
        linkSourceAuto: t("overlay.linkSourceAuto"),
        permissionsRestricted: t("overlay.permissionsRestricted"),
      }),
    [faces, t],
  );
  const overlayIdByFaceId = useMemo(
    () => new Map(previewFaceOverlays.map((overlay) => [overlay.assetFaceId, overlay.id] as const)),
    [previewFaceOverlays],
  );
  const faceIdByOverlayId = useMemo(
    () => new Map(previewFaceOverlays.map((overlay) => [overlay.id, overlay.assetFaceId] as const)),
    [previewFaceOverlays],
  );
  const selectedInlinePreviewOverlayIds = useMemo(
    () =>
      selectedFaceId
        ? [overlayIdByFaceId.get(selectedFaceId)].filter((id): id is string => Boolean(id))
        : [],
    [overlayIdByFaceId, selectedFaceId],
  );
  const focusedOverlayId =
    hoveredFaceId
      ? overlayIdByFaceId.get(hoveredFaceId) ?? null
      : internalHoveredFaceId
        ? overlayIdByFaceId.get(internalHoveredFaceId) ?? null
        : null;

  return (
    <PreviewableImage
      src={src}
      previewSrc={src}
      alt={alt}
      className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
      imageClassName="h-[clamp(22rem,58vh,44rem)] w-full rounded-lg object-contain"
      previewImageClassName="h-full w-full object-contain"
      previewFaceOverlays={previewFaceOverlays}
      showInlineFaceOverlays
      selectedInlinePreviewOverlayIds={selectedInlinePreviewOverlayIds}
      hoveredInlinePreviewOverlayId={focusedOverlayId}
      onHoveredInlinePreviewOverlayIdChange={(overlayId) => {
        const nextFaceId = overlayId ? faceIdByOverlayId.get(overlayId) ?? null : null;
        setInternalHoveredFaceId(nextFaceId);
        onHoverFaceId?.(nextFaceId);
      }}
      onInlinePreviewOverlayActivate={(overlay, event) => {
        event.preventDefault();
        onSelectFaceId?.((overlay as ReleasedPreviewOverlay).assetFaceId);
      }}
    />
  );
}
