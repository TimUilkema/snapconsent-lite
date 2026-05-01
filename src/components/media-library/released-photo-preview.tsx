"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { PreviewableImage, type PreviewFaceOverlay } from "@/components/projects/previewable-image";
import type { ReleasePhotoFaceContext } from "@/lib/project-releases/media-library-release-overlays";

type ReleasedPhotoPreviewProps = {
  src: string;
  alt: string;
  faces: ReleasePhotoFaceContext[];
  selectedOwnerId?: string | null;
  onSelectOwnerId?: (ownerId: string | null) => void;
};

type ReleasedPreviewOverlay = PreviewFaceOverlay & {
  ownerId: string | null;
};

function buildPreviewFaceOverlays(
  faces: ReleasePhotoFaceContext[],
  labels: {
    blockedFaceLabel: (face: number) => string;
    detectedFaceLabel: (face: number) => string;
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
    const label =
      owner?.displayName
      ?? owner?.email
      ?? (face.visualState === "blocked"
        ? labels.blockedFaceLabel(face.faceRank + 1)
        : labels.detectedFaceLabel(face.faceRank + 1));
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
      href: owner ? `#usage-owner-${owner.projectFaceAssigneeId}` : `#release-face-${face.assetFaceId}`,
      label,
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
    } satisfies ReleasedPreviewOverlay;
  });
}

export function ReleasedPhotoPreview({
  src,
  alt,
  faces,
  selectedOwnerId = null,
  onSelectOwnerId,
}: ReleasedPhotoPreviewProps) {
  const t = useTranslations("mediaLibrary.detail");
  const [hoveredOverlayId, setHoveredOverlayId] = useState<string | null>(null);
  const previewFaceOverlays = useMemo(
    () =>
      buildPreviewFaceOverlays(faces, {
        blockedFaceLabel: (face) => t("overlay.blockedFaceLabel", { face }),
        detectedFaceLabel: (face) => t("overlay.detectedFaceLabel", { face }),
        stateBlocked: t("overlay.stateBlocked"),
        stateDetected: t("overlay.stateDetected"),
        stateManual: t("overlay.stateManual"),
        linkSourceManual: t("overlay.linkSourceManual"),
        linkSourceAuto: t("overlay.linkSourceAuto"),
        permissionsRestricted: t("overlay.permissionsRestricted"),
      }),
    [faces, t],
  );
  const selectedInlinePreviewOverlayIds = useMemo(
    () =>
      selectedOwnerId
        ? previewFaceOverlays
            .filter((overlay) => overlay.ownerId === selectedOwnerId)
            .map((overlay) => overlay.id)
        : [],
    [previewFaceOverlays, selectedOwnerId],
  );

  return (
    <PreviewableImage
      src={src}
      previewSrc={src}
      alt={alt}
      className="rounded-[22px] border border-zinc-200/90 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.88),_rgba(244,244,245,0.96)_42%,_rgba(228,228,231,1)_100%)] p-3"
      imageClassName="h-[clamp(22rem,58vh,44rem)] w-full rounded-[18px] object-contain"
      previewImageClassName="h-full w-full object-contain"
      previewFaceOverlays={previewFaceOverlays}
      showInlineFaceOverlays
      selectedInlinePreviewOverlayIds={selectedInlinePreviewOverlayIds}
      hoveredInlinePreviewOverlayId={hoveredOverlayId}
      onHoveredInlinePreviewOverlayIdChange={setHoveredOverlayId}
      onInlinePreviewOverlayActivate={(overlay, event) => {
        event.preventDefault();
        const ownerId = (overlay as ReleasedPreviewOverlay).ownerId;
        onSelectOwnerId?.(ownerId);
      }}
    />
  );
}
