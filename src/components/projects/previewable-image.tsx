"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  getContainedImageRect,
  getFaceOverlayStyle,
  type ContainedImageRect,
  type MeasuredSize,
  type NormalizedFaceBox,
} from "@/lib/client/face-overlay";

export type PreviewFaceOverlay = {
  id: string;
  href: string;
  label: string;
  faceBoxNormalized: NormalizedFaceBox;
  headshotThumbnailUrl?: string | null;
  matchConfidence?: number | null;
  linkSource?: "manual" | "auto" | null;
  linkSourceLabel?: string | null;
  tone?: "manual" | "auto" | "unlinked" | "hidden" | "blocked" | null;
  metaLabel?: string | null;
};

type PreviewableImageProps = {
  src: string | null;
  previewSrc?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  previewImageClassName?: string;
  onImageLoad?: React.ReactEventHandler<HTMLImageElement>;
  emptyState?: "processing" | "unavailable";
  emptyLabel?: string;
  previewFaceOverlays?: PreviewFaceOverlay[];
  showInlineFaceOverlays?: boolean;
  faceOverlayFit?: "contain" | "cover";
  onOpenPreview?: () => void;
  lightboxChrome?: "header" | "floating";
};

type LightboxPan = {
  x: number;
  y: number;
};

type PreviewOverlayCardRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type PreviewOverlayBoxStyle = {
  left: string;
  top: string;
  width: string;
  height: string;
};

type DrawFacePointerPoint = {
  x: number;
  y: number;
};

type ImagePreviewLightboxProps = {
  open: boolean;
  src: string | null;
  alt: string;
  previewImageClassName?: string;
  emptyState?: "processing" | "unavailable";
  emptyLabel?: string;
  previewFaceOverlays?: PreviewFaceOverlay[];
  onClose: () => void;
  onPrevious?: (() => void) | null;
  onNext?: (() => void) | null;
  canPrevious?: boolean;
  canNext?: boolean;
  previousLabel?: string;
  nextLabel?: string;
  closeLabel?: string;
  zoomInLabel?: string;
  zoomOutLabel?: string;
  zoomResetLabel?: string;
  zoomInputLabel?: string;
  zoomInputHint?: string;
  metadataLabel?: string | null;
  counterLabel?: string | null;
  preloadSrcs?: string[];
  hoveredOverlayId?: string | null;
  onHoveredOverlayIdChange?: (overlayId: string | null) => void;
  selectedOverlayId?: string | null;
  onPreviewOverlayActivate?: (overlay: PreviewFaceOverlay, event: React.MouseEvent<HTMLAnchorElement>) => void;
  selectedOverlayDetail?: React.ReactNode;
  belowScene?: React.ReactNode;
  sidePanel?: React.ReactNode;
  chrome?: "header" | "floating";
  isDrawFaceMode?: boolean;
  draftFaceBoxNormalized?: NormalizedFaceBox;
  onDraftFaceBoxChange?: (faceBoxNormalized: NormalizedFaceBox) => void;
};

function getConsentInitials(label: string) {
  const parts = label
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length === 0) {
    return "?";
  }

  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function useMeasuredElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState<MeasuredSize | null>(null);
  const [node, setNode] = useState<T | null>(null);

  useEffect(() => {
    if (!node) {
      return;
    }

    const updateSize = () => {
      const nextWidth = node.clientWidth;
      const nextHeight = node.clientHeight;
      setSize((current) => {
        if (current?.width === nextWidth && current?.height === nextHeight) {
          return current;
        }

        return {
          width: nextWidth,
          height: nextHeight,
        };
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  const ref = useCallback((nextNode: T | null) => {
    setNode(nextNode);
    if (!nextNode) {
      setSize(null);
    }
  }, []);

  return { ref, size };
}

function useImageNaturalSize() {
  const [size, setSize] = useState<MeasuredSize | null>(null);

  const updateSize = useCallback((node: HTMLImageElement | null) => {
    if (!node || node.naturalWidth <= 0 || node.naturalHeight <= 0) {
      return;
    }

    setSize((current) => {
      if (current?.width === node.naturalWidth && current?.height === node.naturalHeight) {
        return current;
      }

      return {
        width: node.naturalWidth,
        height: node.naturalHeight,
      };
    });
  }, []);

  const ref = useCallback(
    (node: HTMLImageElement | null) => {
      if (!node) {
        setSize(null);
        return;
      }

      updateSize(node);
    },
    [updateSize],
  );

  const onLoad = useCallback<React.ReactEventHandler<HTMLImageElement>>(
    (event) => {
      updateSize(event.currentTarget);
    },
    [updateSize],
  );

  return { ref, size, onLoad };
}

function renderEmptyState(emptyState: "processing" | "unavailable", emptyLabel: string, className: string) {
  return (
    <div
      className={`grid place-items-center overflow-hidden rounded-lg bg-zinc-100 text-center ${className}`}
      aria-label={emptyLabel}
    >
      <div className="px-3 text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
        {emptyState === "processing" ? "Processing" : "Unavailable"}
        <div className="mt-1 text-[10px] tracking-[0.12em] text-zinc-400">{emptyLabel}</div>
      </div>
    </div>
  );
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parsePixelValue(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function getPreviewSceneImageRect(
  frameSize: MeasuredSize | null,
  imageSize: MeasuredSize | null,
) {
  return getContainedImageRect(frameSize, imageSize);
}

export function getPreviewScenePointFromClientPoint(input: {
  clientX: number;
  clientY: number;
  frameRect: DOMRect;
  frameSize: MeasuredSize;
  zoom: number;
  pan: LightboxPan;
}) {
  const localX = input.clientX - input.frameRect.left;
  const localY = input.clientY - input.frameRect.top;
  const centerX = input.frameSize.width / 2;
  const centerY = input.frameSize.height / 2;

  return {
    x: centerX + (localX - centerX - input.pan.x) / input.zoom,
    y: centerY + (localY - centerY - input.pan.y) / input.zoom,
  };
}

export function getConstrainedPreviewDrawPoint(input: {
  clientX: number;
  clientY: number;
  frameRect: DOMRect;
  frameSize: MeasuredSize | null;
  imageRect: ContainedImageRect | null;
  zoom: number;
  pan: LightboxPan;
}) {
  if (!input.frameSize || !input.imageRect) {
    return null;
  }

  const scenePoint = getPreviewScenePointFromClientPoint({
    clientX: input.clientX,
    clientY: input.clientY,
    frameRect: input.frameRect,
    frameSize: input.frameSize,
    zoom: input.zoom,
    pan: input.pan,
  });
  const isInsideImage =
    scenePoint.x >= input.imageRect.left &&
    scenePoint.x <= input.imageRect.left + input.imageRect.width &&
    scenePoint.y >= input.imageRect.top &&
    scenePoint.y <= input.imageRect.top + input.imageRect.height;

  return {
    point: {
      x: clampNumber(scenePoint.x, input.imageRect.left, input.imageRect.left + input.imageRect.width),
      y: clampNumber(scenePoint.y, input.imageRect.top, input.imageRect.top + input.imageRect.height),
    },
    isInsideImage,
  };
}

export function buildNormalizedFaceBoxFromPreviewPoints(
  startPoint: DrawFacePointerPoint | null,
  endPoint: DrawFacePointerPoint | null,
  imageRect: ContainedImageRect | null,
): NormalizedFaceBox {
  if (!startPoint || !endPoint || !imageRect || imageRect.width <= 0 || imageRect.height <= 0) {
    return null;
  }

  const xMin = clampNumber((Math.min(startPoint.x, endPoint.x) - imageRect.left) / imageRect.width, 0, 1);
  const yMin = clampNumber((Math.min(startPoint.y, endPoint.y) - imageRect.top) / imageRect.height, 0, 1);
  const xMax = clampNumber((Math.max(startPoint.x, endPoint.x) - imageRect.left) / imageRect.width, 0, 1);
  const yMax = clampNumber((Math.max(startPoint.y, endPoint.y) - imageRect.top) / imageRect.height, 0, 1);

  return {
    x_min: xMin,
    y_min: yMin,
    x_max: xMax,
    y_max: yMax,
  };
}

export function transformPreviewOverlayStyle(
  overlayStyle: NonNullable<ReturnType<typeof getFaceOverlayStyle>>,
  frameSize: MeasuredSize,
  zoom: number,
  pan: LightboxPan,
): PreviewOverlayBoxStyle {
  const left = parsePixelValue(overlayStyle.left);
  const top = parsePixelValue(overlayStyle.top);
  const width = parsePixelValue(overlayStyle.width);
  const height = parsePixelValue(overlayStyle.height);
  const centerX = frameSize.width / 2;
  const centerY = frameSize.height / 2;

  return {
    left: `${centerX + pan.x + (left - centerX) * zoom}px`,
    top: `${centerY + pan.y + (top - centerY) * zoom}px`,
    width: `${width * zoom}px`,
    height: `${height * zoom}px`,
  };
}

export function clampPreviewPan(pan: LightboxPan, zoom: number, frameSize: MeasuredSize | null): LightboxPan {
  if (!frameSize || zoom <= 1) {
    return { x: 0, y: 0 };
  }

  const maxX = ((zoom - 1) * frameSize.width) / 2;
  const maxY = ((zoom - 1) * frameSize.height) / 2;
  return {
    x: clampNumber(pan.x, -maxX, maxX),
    y: clampNumber(pan.y, -maxY, maxY),
  };
}

export function getPreviewOverlayCardStyle(
  overlayStyle: NonNullable<ReturnType<typeof getFaceOverlayStyle>>,
  frameSize: MeasuredSize,
): React.CSSProperties {
  const cardRect = getPreviewOverlayCardRect(overlayStyle, frameSize);

  return {
    left: `${cardRect.left}px`,
    top: `${cardRect.top}px`,
    width: `${cardRect.width}px`,
  };
}

function getPreviewOverlayCardRect(
  overlayStyle: NonNullable<ReturnType<typeof getFaceOverlayStyle>>,
  frameSize: MeasuredSize,
): PreviewOverlayCardRect {
  const faceLeft = parsePixelValue(overlayStyle.left);
  const faceTop = parsePixelValue(overlayStyle.top);
  const faceWidth = parsePixelValue(overlayStyle.width);
  const faceHeight = parsePixelValue(overlayStyle.height);
  const cardWidth = 156;
  const cardHeight = 72;
  const gap = 10;
  const inset = 12;
  const maxLeft = Math.max(inset, frameSize.width - cardWidth - inset);
  const left = clampNumber(faceLeft + faceWidth - cardWidth, inset, maxLeft);
  const maxTop = Math.max(inset, frameSize.height - cardHeight - inset);
  const belowTop = faceTop + faceHeight + gap;
  const aboveTop = faceTop - cardHeight - gap;
  const top = belowTop <= maxTop ? belowTop : clampNumber(aboveTop, inset, maxTop);

  return { left, top, width: cardWidth, height: cardHeight };
}

function rectsOverlap(a: PreviewOverlayCardRect, b: PreviewOverlayCardRect, padding = 8) {
  return !(
    a.left + a.width + padding <= b.left ||
    b.left + b.width + padding <= a.left ||
    a.top + a.height + padding <= b.top ||
    b.top + b.height + padding <= a.top
  );
}

function clampCardRectToFrame(rect: PreviewOverlayCardRect, frameSize: MeasuredSize) {
  return {
    ...rect,
    left: clampNumber(rect.left, 12, Math.max(12, frameSize.width - rect.width - 12)),
    top: clampNumber(rect.top, 12, Math.max(12, frameSize.height - rect.height - 12)),
  };
}

function getSelectedOverlayDetailStyle(cardRect: PreviewOverlayCardRect, frameSize: MeasuredSize): React.CSSProperties {
  const detailWidth = Math.min(352, Math.max(280, frameSize.width - 24));
  const left = clampNumber(cardRect.left, 12, Math.max(12, frameSize.width - detailWidth - 12));
  const minimumDetailHeight = 184;
  const preferredTop = cardRect.top + cardRect.height + 8;
  const preferredBottomSpace = frameSize.height - preferredTop - 12;
  const top =
    preferredBottomSpace >= minimumDetailHeight
      ? clampNumber(preferredTop, 12, Math.max(12, frameSize.height - minimumDetailHeight - 12))
      : clampNumber(cardRect.top - minimumDetailHeight - 8, 12, Math.max(12, frameSize.height - minimumDetailHeight - 12));
  const maxHeight = Math.max(minimumDetailHeight, frameSize.height - top - 12);

  return {
    left: `${left}px`,
    top: `${top}px`,
    width: `${detailWidth}px`,
    maxHeight: `${maxHeight}px`,
  };
}

export function getPreviewOverlayCardLayout(
  overlays: Array<{
    id: string;
    overlayStyle: NonNullable<ReturnType<typeof getFaceOverlayStyle>>;
  }>,
  frameSize: MeasuredSize,
) {
  const attempts = [0, 82, -82, 164, -164, 246, -246];
  const placed = new Map<string, PreviewOverlayCardRect>();
  const ordered = [...overlays].sort(
    (left, right) => parsePixelValue(left.overlayStyle.top) - parsePixelValue(right.overlayStyle.top),
  );

  for (const overlay of ordered) {
    const baseRect = getPreviewOverlayCardRect(overlay.overlayStyle, frameSize);
    let resolvedRect = clampCardRectToFrame(baseRect, frameSize);

    for (const offset of attempts) {
      const candidate = clampCardRectToFrame(
        {
          ...baseRect,
          top: baseRect.top + offset,
        },
        frameSize,
      );

      if (![...placed.values()].some((current) => rectsOverlap(candidate, current))) {
        resolvedRect = candidate;
        break;
      }
    }

    placed.set(overlay.id, resolvedRect);
  }

  return placed;
}

function renderOverlayBadge(overlay: PreviewFaceOverlay, size: "inline" | "preview") {
  const badgeSizeClass =
    size === "inline" ? "h-8 w-8 rounded-md text-[10px]" : "h-12 w-12 rounded-xl text-xs";
  const toneKey = overlay.tone ?? overlay.linkSource ?? "auto";

  if (overlay.headshotThumbnailUrl) {
    return (
      <span
        aria-hidden="true"
        className={`border-2 border-white bg-white bg-cover bg-center shadow-sm ${badgeSizeClass}`}
        style={{ backgroundImage: `url("${overlay.headshotThumbnailUrl}")` }}
      />
    );
  }

  if (toneKey === "unlinked") {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center border-2 border-white bg-zinc-200 text-zinc-500 shadow-sm ${badgeSizeClass}`}
      >
        <svg
          viewBox="0 0 24 24"
          className={size === "inline" ? "h-4 w-4" : "h-6 w-6"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 20a6 6 0 0 0-12 0" />
          <circle cx="12" cy="10" r="4" />
        </svg>
      </span>
    );
  }

  if (toneKey === "blocked") {
    return (
      <span
        aria-hidden="true"
        className={`inline-flex items-center justify-center border-2 border-white bg-red-700 text-white shadow-sm ${badgeSizeClass}`}
      >
        <svg
          viewBox="0 0 24 24"
          className={size === "inline" ? "h-4 w-4" : "h-6 w-6"}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="8" />
          <path d="m8.5 15.5 7-7" />
        </svg>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center border-2 border-white bg-emerald-700 font-semibold text-white shadow-sm ${badgeSizeClass}`}
    >
      {getConsentInitials(overlay.label)}
    </span>
  );
}

function getPreviewOverlayToneClasses(
  tone: NonNullable<PreviewFaceOverlay["tone"]> | PreviewFaceOverlay["linkSource"],
  active: boolean,
) {
  if (tone === "manual") {
    return active
      ? {
          box: "border-sky-900 bg-sky-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.98),0_0_0_4px_rgba(14,165,233,0.18),0_16px_32px_rgba(2,132,199,0.24)]",
          card: "border-sky-300 bg-sky-50/95 ring-sky-200/90 shadow-[0_24px_48px_rgba(14,165,233,0.14),0_8px_16px_rgba(15,23,42,0.12)]",
          hoverCard: "border-sky-200 bg-sky-50/92 ring-sky-100/80 hover:border-sky-300 hover:shadow-[0_22px_44px_rgba(14,165,233,0.12),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-950",
          meta: "text-zinc-500",
          icon: "text-sky-700",
        }
      : {
          box: "border-sky-700 bg-sky-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_10px_20px_rgba(2,132,199,0.18)] hover:border-sky-800",
          card: "border-white/95 bg-sky-50/92 ring-sky-100/80 shadow-[0_18px_38px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.1)]",
          hoverCard: "border-sky-200 bg-sky-50/92 ring-sky-100/80 hover:border-sky-300 hover:shadow-[0_22px_44px_rgba(14,165,233,0.12),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-900",
          meta: "text-zinc-500",
          icon: "text-sky-700",
        };
  }

  if (tone === "unlinked") {
    return active
      ? {
          box: "border-amber-950 bg-amber-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.98),0_0_0_4px_rgba(245,158,11,0.18),0_16px_32px_rgba(180,83,9,0.24)]",
          card: "border-amber-300 bg-amber-50/95 ring-amber-200/90 shadow-[0_24px_48px_rgba(245,158,11,0.14),0_8px_16px_rgba(15,23,42,0.12)]",
          hoverCard: "border-amber-200 bg-amber-50/92 ring-amber-100/80 hover:border-amber-300 hover:shadow-[0_22px_44px_rgba(245,158,11,0.12),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-950",
          meta: "text-zinc-500",
          icon: "text-amber-700",
        }
      : {
          box: "border-amber-700 bg-amber-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_10px_20px_rgba(180,83,9,0.2)] hover:border-amber-800",
          card: "border-white/95 bg-amber-50/92 ring-amber-100/80 shadow-[0_18px_38px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.1)]",
          hoverCard: "border-amber-200 bg-amber-50/92 ring-amber-100/80 hover:border-amber-300 hover:shadow-[0_22px_44px_rgba(245,158,11,0.12),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-900",
          meta: "text-zinc-500",
          icon: "text-amber-700",
        };
  }

  if (tone === "hidden") {
    return active
      ? {
          box: "border-zinc-900 bg-zinc-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.98),0_0_0_4px_rgba(113,113,122,0.18),0_16px_32px_rgba(63,63,70,0.22)]",
          card: "border-zinc-300 bg-zinc-50/95 ring-zinc-200/90 shadow-[0_24px_48px_rgba(63,63,70,0.1),0_8px_16px_rgba(15,23,42,0.12)]",
          hoverCard: "border-zinc-200 bg-zinc-50/92 ring-zinc-100/80 hover:border-zinc-300 hover:shadow-[0_18px_36px_rgba(63,63,70,0.1),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-950",
          meta: "text-zinc-500",
          icon: "text-zinc-700",
        }
      : {
          box: "border-zinc-500 bg-zinc-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_10px_20px_rgba(63,63,70,0.14)] hover:border-zinc-700",
          card: "border-white/95 bg-zinc-50/92 ring-zinc-100/80 shadow-[0_18px_38px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.1)]",
          hoverCard: "border-zinc-200 bg-zinc-50/92 ring-zinc-100/80 hover:border-zinc-300 hover:shadow-[0_18px_36px_rgba(63,63,70,0.1),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-900",
          meta: "text-zinc-500",
          icon: "text-zinc-700",
        };
  }

  if (tone === "blocked") {
    return active
      ? {
          box: "border-red-950 bg-red-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.98),0_0_0_4px_rgba(239,68,68,0.2),0_16px_32px_rgba(127,29,29,0.24)]",
          card: "border-red-300 bg-red-50/95 ring-red-200/90 shadow-[0_24px_48px_rgba(239,68,68,0.14),0_8px_16px_rgba(15,23,42,0.12)]",
          hoverCard: "border-red-200 bg-red-50/92 ring-red-100/80 hover:border-red-300 hover:shadow-[0_22px_44px_rgba(239,68,68,0.12),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-950",
          meta: "text-zinc-500",
          icon: "text-red-700",
        }
      : {
          box: "border-red-700 bg-red-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_10px_20px_rgba(127,29,29,0.18)] hover:border-red-800",
          card: "border-white/95 bg-red-50/92 ring-red-100/80 shadow-[0_18px_38px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.1)]",
          hoverCard: "border-red-200 bg-red-50/92 ring-red-100/80 hover:border-red-300 hover:shadow-[0_22px_44px_rgba(239,68,68,0.12),0_6px_14px_rgba(15,23,42,0.1)]",
          label: "text-zinc-900",
          meta: "text-zinc-500",
          icon: "text-red-700",
        };
  }

  return active
    ? {
        box: "border-emerald-950 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.98),0_0_0_4px_rgba(5,150,105,0.18),0_16px_32px_rgba(6,95,70,0.28)]",
        card: "border-emerald-300 bg-emerald-50/95 ring-emerald-200/90 shadow-[0_24px_48px_rgba(16,185,129,0.16),0_8px_16px_rgba(15,23,42,0.12)]",
        hoverCard: "border-emerald-200 bg-emerald-50/92 ring-emerald-100/80 hover:border-emerald-300 hover:shadow-[0_22px_44px_rgba(16,185,129,0.14),0_6px_14px_rgba(15,23,42,0.1)]",
        label: "text-zinc-950",
        meta: "text-zinc-500",
        icon: "text-emerald-700",
      }
    : {
        box: "border-emerald-700 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_10px_20px_rgba(6,95,70,0.2)] hover:border-emerald-800",
        card: "border-white/95 bg-emerald-50/92 ring-emerald-100/80 shadow-[0_18px_38px_rgba(15,23,42,0.14),0_4px_12px_rgba(15,23,42,0.1)]",
        hoverCard: "border-emerald-200 bg-emerald-50/92 ring-emerald-100/80 hover:border-emerald-300 hover:shadow-[0_22px_44px_rgba(16,185,129,0.14),0_6px_14px_rgba(15,23,42,0.1)]",
        label: "text-zinc-900",
        meta: "text-zinc-500",
        icon: "text-emerald-700",
      };
}

function renderLinkSourceIcon(
  tone: NonNullable<PreviewFaceOverlay["tone"]> | PreviewFaceOverlay["linkSource"],
  className: string,
) {
  if (tone === "unlinked") {
    return null;
  }

  if (tone === "manual") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }

  if (tone === "hidden") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="m3 3 18 18" />
        <path d="M10.6 10.5a2 2 0 0 0 2.9 2.8" />
        <path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c5 0 8.6 4 9.5 5-.4.5-1.4 1.7-2.9 2.9" />
        <path d="M6.2 6.3C4.1 7.7 2.8 9.4 2.5 9.9c.5.6 1.9 2.2 4.1 3.7" />
      </svg>
    );
  }

  if (tone === "blocked") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 15.5 7-7" />
      </svg>
    );
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className={`h-3.5 w-3.5 ${className}`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 3 9.7 6.7 6 8l3.7 1.3L11 13l1.3-3.7L16 8l-3.7-1.3Z" />
      <path d="M18 13.5 17.2 15.7 15 16.5l2.2.8.8 2.2.8-2.2 2.2-.8-2.2-.8Z" />
    </svg>
  );
}

export function PreviewImageFaceOverlayLink({
  overlay,
  overlayStyle,
  size,
  cardStyle,
  interactive = true,
  active,
  selected,
  dimmed,
  onHoverChange,
  onActivate,
}: {
  overlay: PreviewFaceOverlay;
  overlayStyle: PreviewOverlayBoxStyle;
  size: "inline" | "preview";
  cardStyle?: React.CSSProperties | null;
  interactive?: boolean;
  active?: boolean;
  selected?: boolean;
  dimmed?: boolean;
  onHoverChange?: (active: boolean) => void;
  onActivate?: (overlay: PreviewFaceOverlay, event: React.MouseEvent<HTMLAnchorElement>) => void;
}) {
  const toneKey = overlay.tone ?? overlay.linkSource ?? "auto";
  const tone = getPreviewOverlayToneClasses(toneKey, Boolean(active));
  const linkSourceLabel =
    overlay.metaLabel ?? overlay.linkSourceLabel ?? (overlay.linkSource === "manual" ? "Manual" : "Auto");

  if (size === "preview" && cardStyle) {
    const sharedHoverProps = interactive
      ? {
      onMouseEnter: () => onHoverChange?.(true),
          onMouseLeave: () => onHoverChange?.(false),
          onFocus: () => onHoverChange?.(true),
          onBlur: () => onHoverChange?.(false),
          onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
            if (!onActivate) {
              return;
            }

            event.preventDefault();
            onActivate(overlay, event);
          },
        }
      : {};
    const interactiveClassName = interactive ? "pointer-events-auto" : "pointer-events-none";
    const CardElement = interactive ? "a" : "div";

    return (
      <div className="pointer-events-none absolute inset-0" style={{ zIndex: active ? 40 : selected ? 30 : 20 }}>
        <CardElement
          {...(interactive ? { href: overlay.href, tabIndex: -1 } : {})}
          data-preview-overlay-link="true"
          className={`${interactiveClassName} absolute block rounded-[10px] border-[3px] transition-[border-color,box-shadow,opacity] ${tone.box} ${dimmed ? "opacity-40" : "opacity-100"}`}
          style={overlayStyle}
          title={`Open ${overlay.label}`}
          {...sharedHoverProps}
        />
        <CardElement
          {...(interactive ? { href: overlay.href } : {})}
          data-preview-overlay-link="true"
          className={`${interactiveClassName} absolute flex items-center gap-3 rounded-2xl border px-3 py-2 ring-1 transition-[transform,border-color,box-shadow,opacity] ${
            active || selected ? tone.card : tone.hoverCard
          } ${dimmed ? "opacity-50" : "opacity-100"} ${active ? "-translate-y-0.5" : "translate-y-0"}`}
          style={cardStyle}
          aria-label={`Open ${overlay.label}`}
          title={`Open ${overlay.label}`}
          {...sharedHoverProps}
        >
          {renderOverlayBadge(overlay, "preview")}
          <span className="min-w-0 flex-1">
              <span className={`block truncate text-[11px] font-semibold leading-tight ${tone.label}`}>
                {overlay.label}
              </span>
              <span className={`mt-1 flex items-center gap-1.5 text-[10px] leading-tight ${tone.meta}`}>
                {renderLinkSourceIcon(toneKey, tone.icon)}
                <span>{linkSourceLabel}</span>
              </span>
            </span>
          </CardElement>
      </div>
    );
  }

  return (
    <a
      href={overlay.href}
      className={`absolute z-10 block rounded-[10px] border-[3px] transition-colors ${getPreviewOverlayToneClasses(
        overlay.tone ?? overlay.linkSource ?? "auto",
        false,
      ).box}`}
      style={overlayStyle}
      aria-label={`Open ${overlay.label}`}
      title={`Open ${overlay.label}`}
      >
        <span className="absolute left-1 top-1">{renderOverlayBadge(overlay, "inline")}</span>
      </a>
    );
  }

export function ImagePreviewLightbox({
  open,
  src,
  alt,
  previewImageClassName = "",
  emptyState = "unavailable",
  emptyLabel = "Image preview unavailable",
  previewFaceOverlays,
  onClose,
  onPrevious = null,
  onNext = null,
  canPrevious = false,
  canNext = false,
  previousLabel = "Previous",
  nextLabel = "Next",
  closeLabel = "Close",
  zoomInLabel = "Zoom in",
  zoomOutLabel = "Zoom out",
  zoomResetLabel = "Reset zoom",
  zoomInputLabel = "Zoom %",
  zoomInputHint = "Type 25-500",
  metadataLabel = null,
  counterLabel = null,
  preloadSrcs = [],
  hoveredOverlayId: controlledHoveredOverlayId,
  onHoveredOverlayIdChange,
  selectedOverlayId = null,
  onPreviewOverlayActivate,
  selectedOverlayDetail,
  belowScene,
  sidePanel,
  chrome = "header",
  isDrawFaceMode = false,
  draftFaceBoxNormalized = null,
  onDraftFaceBoxChange,
}: ImagePreviewLightboxProps) {
  const [failedPreviewSrc, setFailedPreviewSrc] = useState<string | null>(null);
  const [uncontrolledHoveredOverlayId, setUncontrolledHoveredOverlayId] = useState<string | null>(null);
  const { ref: previewFrameRef, size: previewFrameSize } = useMeasuredElementSize<HTMLDivElement>();
  const {
    ref: previewImageRef,
    size: previewImageSize,
    onLoad: handlePreviewImageLoad,
  } = useImageNaturalSize();
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<LightboxPan>({ x: 0, y: 0 });
  const [zoomInputValue, setZoomInputValue] = useState("100");
  const dragStateRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startPan: LightboxPan;
  } | null>(null);
  const drawStateRef = useRef<{
    pointerId: number;
    startPoint: DrawFacePointerPoint;
  } | null>(null);
  const canPan = zoom > 1.01 && !isDrawFaceMode;
  const clampedPan = clampPreviewPan(pan, zoom, previewFrameSize);
  const previewImageRect = getPreviewSceneImageRect(previewFrameSize, previewImageSize);
  const hoveredOverlayId =
    controlledHoveredOverlayId !== undefined ? controlledHoveredOverlayId : uncontrolledHoveredOverlayId;
  const activeOverlayId = hoveredOverlayId ?? selectedOverlayId ?? null;

  const setHoveredOverlayId = useCallback(
    (overlayId: string | null) => {
      if (controlledHoveredOverlayId === undefined) {
        setUncontrolledHoveredOverlayId(overlayId);
      }
      onHoveredOverlayIdChange?.(overlayId);
    },
    [controlledHoveredOverlayId, onHoveredOverlayIdChange],
  );

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key === "ArrowLeft" && canPrevious && onPrevious) {
        event.preventDefault();
        onPrevious();
        return;
      }

      if (event.key === "ArrowRight" && canNext && onNext) {
        event.preventDefault();
        onNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canNext, canPrevious, onClose, onNext, onPrevious, open]);

  useEffect(() => {
    if (!open || typeof document === "undefined") {
      return;
    }

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [open]);

  useEffect(() => {
    if (!open || typeof window === "undefined") {
      return;
    }

    preloadSrcs
      .filter((candidate): candidate is string => typeof candidate === "string" && candidate.length > 0)
      .forEach((candidate) => {
        const image = new window.Image();
        image.decoding = "async";
        image.src = candidate;
      });
  }, [open, preloadSrcs]);

  useEffect(() => {
    setZoomInputValue(String(Math.round(zoom * 100)));
  }, [zoom]);

  function applyZoom(nextZoom: number) {
    const clampedZoom = clampNumber(nextZoom, 0.25, 5);
    setZoom(clampedZoom);
    setPan((current) => clampPreviewPan(current, clampedZoom, previewFrameSize));
  }

  function commitZoomInput() {
    const parsed = Number.parseInt(zoomInputValue, 10);
    if (!Number.isFinite(parsed)) {
      setZoomInputValue(String(Math.round(zoom * 100)));
      return;
    }

    applyZoom(clampNumber(parsed, 25, 500) / 100);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      target.closest("[data-preview-overlay-link='true']") ||
      target.closest("button")
    ) {
      return;
    }

    if (isDrawFaceMode) {
      const frameRect = event.currentTarget.getBoundingClientRect();
      const constrainedPoint = getConstrainedPreviewDrawPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        frameRect,
        frameSize: previewFrameSize,
        imageRect: previewImageRect,
        zoom,
        pan: clampedPan,
      });

      if (!constrainedPoint?.isInsideImage) {
        return;
      }

      drawStateRef.current = {
        pointerId: event.pointerId,
        startPoint: constrainedPoint.point,
      };
      onDraftFaceBoxChange?.(
        buildNormalizedFaceBoxFromPreviewPoints(
          constrainedPoint.point,
          constrainedPoint.point,
          previewImageRect,
        ),
      );
      setHoveredOverlayId(null);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    if (!canPan) {
      return;
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startPan: clampedPan,
    };
    setHoveredOverlayId(null);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const drawState = drawStateRef.current;
    if (drawState && drawState.pointerId === event.pointerId) {
      const frameRect = event.currentTarget.getBoundingClientRect();
      const constrainedPoint = getConstrainedPreviewDrawPoint({
        clientX: event.clientX,
        clientY: event.clientY,
        frameRect,
        frameSize: previewFrameSize,
        imageRect: previewImageRect,
        zoom,
        pan: clampedPan,
      });

      if (!constrainedPoint) {
        return;
      }

      onDraftFaceBoxChange?.(
        buildNormalizedFaceBoxFromPreviewPoints(
          drawState.startPoint,
          constrainedPoint.point,
          previewImageRect,
        ),
      );
      return;
    }

    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    const nextPan = {
      x: dragState.startPan.x + (event.clientX - dragState.startClientX),
      y: dragState.startPan.y + (event.clientY - dragState.startClientY),
    };
    setPan(clampPreviewPan(nextPan, zoom, previewFrameSize));
  }

  function handlePointerEnd(event: React.PointerEvent<HTMLDivElement>) {
    if (drawStateRef.current?.pointerId === event.pointerId) {
      drawStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }

    if (dragStateRef.current?.pointerId !== event.pointerId) {
      return;
    }

    dragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  const sceneStyle: React.CSSProperties = {
    transform: `translate(${clampedPan.x}px, ${clampedPan.y}px) scale(${zoom})`,
    transformOrigin: "center center",
  };
  const overlayEntries =
    src && failedPreviewSrc !== src
      ? (previewFaceOverlays ?? [])
          .map((overlay) => {
            const baseOverlayStyle = getFaceOverlayStyle(
              overlay.faceBoxNormalized,
              previewFrameSize,
              previewImageSize,
            );
            if (!baseOverlayStyle || !previewFrameSize) {
              return null;
            }

            return {
              overlay,
              overlayStyle: transformPreviewOverlayStyle(baseOverlayStyle, previewFrameSize, zoom, clampedPan),
            };
          })
          .filter((entry): entry is { overlay: PreviewFaceOverlay; overlayStyle: PreviewOverlayBoxStyle } => Boolean(entry))
      : [];
  const draftOverlayStyle =
    draftFaceBoxNormalized && previewFrameSize
      ? (() => {
          const baseOverlayStyle = getFaceOverlayStyle(
            draftFaceBoxNormalized,
            previewFrameSize,
            previewImageSize,
          );
          if (!baseOverlayStyle) {
            return null;
          }

          return transformPreviewOverlayStyle(baseOverlayStyle, previewFrameSize, zoom, clampedPan);
        })()
      : null;
  const previewCardLayout =
    previewFrameSize && overlayEntries.length > 0
      ? getPreviewOverlayCardLayout(
          overlayEntries.map((entry) => ({
            id: entry.overlay.id,
            overlayStyle: entry.overlayStyle,
          })),
          previewFrameSize,
        )
      : new Map<string, PreviewOverlayCardRect>();
  const previewScene = (
    <div className="relative h-[clamp(19rem,56vh,48rem)] overflow-hidden rounded-[22px] border border-zinc-200/90 bg-zinc-100 p-3 select-none lg:h-[clamp(21rem,58vh,50rem)]">
      {onPrevious ? (
        <button
          type="button"
          onClick={onPrevious}
          disabled={!canPrevious}
          className="absolute left-5 top-1/2 z-30 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/90 bg-white/94 text-zinc-800 shadow-lg transition-colors hover:bg-white disabled:opacity-45"
          aria-label={previousLabel}
          title={previousLabel}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m15 18-6-6 6-6" />
          </svg>
        </button>
      ) : null}

      {onNext ? (
        <button
          type="button"
          onClick={onNext}
          disabled={!canNext}
          className="absolute right-5 top-1/2 z-30 inline-flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full border border-white/90 bg-white/94 text-zinc-800 shadow-lg transition-colors hover:bg-white disabled:opacity-45"
          aria-label={nextLabel}
          title={nextLabel}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="h-5 w-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        </button>
      ) : null}

      <div
        ref={previewFrameRef}
        className={`relative h-full w-full overflow-hidden rounded-[18px] bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.88),_rgba(244,244,245,0.96)_42%,_rgba(228,228,231,1)_100%)] ${
          isDrawFaceMode ? "cursor-crosshair" : canPan ? "cursor-grab active:cursor-grabbing" : "cursor-default"
        }`}
        onWheel={(event) => {
          event.preventDefault();
          event.stopPropagation();
          applyZoom(zoom + (event.deltaY < 0 ? 0.25 : -0.25));
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ touchAction: canPan ? "none" : "auto" }}
      >
        <div className="relative h-full w-full will-change-transform" style={sceneStyle}>
          {src && failedPreviewSrc !== src ? (
            <img
              key={src}
              ref={previewImageRef}
              src={src}
              alt={alt}
              className={`h-full w-full object-contain ${previewImageClassName}`}
              onLoad={handlePreviewImageLoad}
              onError={() => setFailedPreviewSrc(src)}
              onDragStart={(event) => event.preventDefault()}
            />
          ) : (
            renderEmptyState(emptyState, emptyLabel, "min-h-[24rem] min-w-[24rem]")
          )}
        </div>
        <div className="pointer-events-none absolute inset-0">
          {overlayEntries.map(({ overlay, overlayStyle }) => {
            const cardRect = previewCardLayout.get(overlay.id);
            return (
              <PreviewImageFaceOverlayLink
                key={overlay.id}
                overlay={overlay}
                overlayStyle={overlayStyle}
                size="preview"
                interactive={!isDrawFaceMode}
                cardStyle={
                  cardRect
                    ? {
                        left: `${cardRect.left}px`,
                        top: `${cardRect.top}px`,
                        width: `${cardRect.width}px`,
                      }
                    : null
                }
                active={activeOverlayId === overlay.id}
                selected={selectedOverlayId === overlay.id}
                dimmed={
                  hoveredOverlayId !== null &&
                  hoveredOverlayId !== overlay.id &&
                  selectedOverlayId !== overlay.id
                }
                onHoverChange={(active) => setHoveredOverlayId(active ? overlay.id : null)}
                onActivate={onPreviewOverlayActivate}
              />
            );
          })}
          {draftOverlayStyle ? (
            <div
              className="absolute z-50 rounded-[10px] border-[3px] border-amber-700 bg-amber-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_10px_20px_rgba(180,83,9,0.2)]"
              style={draftOverlayStyle}
            />
          ) : null}
          {selectedOverlayId && selectedOverlayDetail && previewFrameSize
            ? (() => {
                const cardRect = previewCardLayout.get(selectedOverlayId);
                if (!cardRect) {
                  return null;
                }

                return (
                  <div
                    className="pointer-events-auto absolute z-50 select-none"
                    style={getSelectedOverlayDetailStyle(cardRect, previewFrameSize)}
                  >
                    {selectedOverlayDetail}
                  </div>
                );
              })()
            : null}
        </div>
        {chrome === "floating" ? (
          <div className="pointer-events-none absolute right-4 top-4 z-40 flex items-center gap-2">
            <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-zinc-200 bg-white/92 px-1.5 py-1.5 shadow-sm backdrop-blur">
              <button
                type="button"
                onClick={() => applyZoom(zoom - 0.25)}
                disabled={zoom <= 0.25}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60"
                aria-label={zoomOutLabel}
                title={zoomOutLabel}
              >
                -
              </button>
              <label
                className="flex items-center gap-1 rounded-full px-1 text-[11px] text-zinc-700"
                title={zoomResetLabel}
              >
                <input
                  type="text"
                  inputMode="numeric"
                  value={zoomInputValue}
                  onChange={(event) => setZoomInputValue(event.currentTarget.value.replace(/[^0-9]/g, ""))}
                  onBlur={commitZoomInput}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitZoomInput();
                      return;
                    }

                    if (event.key === "Escape") {
                      event.preventDefault();
                      setZoomInputValue(String(Math.round(zoom * 100)));
                    }
                  }}
                  className="w-12 bg-transparent px-1 py-1 text-right text-[11px] font-medium text-zinc-900 outline-none ring-0"
                  aria-label={`${zoomInputLabel} ${zoomInputHint}`}
                />
                <span className="font-medium text-zinc-700">%</span>
              </label>
              <button
                type="button"
                onClick={() => applyZoom(zoom + 0.25)}
                disabled={zoom >= 5}
                className="rounded-full px-2.5 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60"
                aria-label={zoomInLabel}
                title={zoomInLabel}
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-black bg-black text-white shadow-sm hover:bg-zinc-900"
              aria-label={closeLabel}
              title={closeLabel}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M5 5 15 15" />
                <path d="M15 5 5 15" />
              </svg>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-3 backdrop-blur-[2px] select-none sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[96vh] w-[min(96vw,1520px)] overflow-y-auto rounded-[28px] border border-white/85 bg-white/94 p-3 shadow-[0_36px_120px_rgba(15,23,42,0.34),0_12px_32px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        {chrome === "header" ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-zinc-200/90 bg-white/92 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900">{alt}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
              {counterLabel ? (
                <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-medium text-zinc-700">
                  {counterLabel}
                </span>
              ) : null}
              {metadataLabel ? <span>{metadataLabel}</span> : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => applyZoom(zoom - 0.25)}
              disabled={zoom <= 0.25}
              className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
              aria-label={zoomOutLabel}
              title={zoomOutLabel}
            >
              -
            </button>
            <label
              className="flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-[11px] text-zinc-700"
              title={zoomResetLabel}
            >
              <input
                type="text"
                inputMode="numeric"
                value={zoomInputValue}
                onChange={(event) => setZoomInputValue(event.currentTarget.value.replace(/[^0-9]/g, ""))}
                onBlur={commitZoomInput}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitZoomInput();
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    setZoomInputValue(String(Math.round(zoom * 100)));
                  }
                }}
                className="w-14 rounded-md border border-zinc-300 bg-white px-2 py-1 text-right text-[11px] font-medium text-zinc-900 outline-none ring-0 placeholder:text-zinc-400 focus:border-zinc-400"
                aria-label={`${zoomInputLabel} ${zoomInputHint}`}
              />
              <span className="font-medium text-zinc-700">%</span>
            </label>
            <button
              type="button"
              onClick={() => applyZoom(zoom + 0.25)}
              disabled={zoom >= 5}
              className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-60"
              aria-label={zoomInLabel}
              title={zoomInLabel}
            >
              +
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black bg-black text-white shadow-sm hover:bg-zinc-900"
              aria-label={closeLabel}
              title={closeLabel}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="M5 5 15 15" />
                <path d="M15 5 5 15" />
              </svg>
            </button>
          </div>
        </div>
        ) : null}

          {sidePanel ? (
            <div className={`${chrome === "header" ? "mt-3" : ""} grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] 2xl:grid-cols-[minmax(0,1fr)_26rem]`}>
              <div className="min-w-0 space-y-3">
                {previewScene}
                {belowScene}
              </div>
              <div className="min-w-0">{sidePanel}</div>
            </div>
          ) : (
            <div className={`${chrome === "header" ? "mt-3" : ""} space-y-3`}>
              {previewScene}
              {belowScene}
            </div>
          )}
        </div>
      </div>,
      document.body,
  );
}

export function PreviewableImage({
  src,
  previewSrc,
  alt,
  className = "",
  imageClassName = "",
  previewImageClassName = "",
  onImageLoad,
  emptyState = "unavailable",
  emptyLabel = "Image preview unavailable",
  previewFaceOverlays,
  showInlineFaceOverlays = false,
  faceOverlayFit = "contain",
  onOpenPreview,
  lightboxChrome = "header",
}: PreviewableImageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const { ref: inlineFrameRef, size: inlineFrameSize } = useMeasuredElementSize<HTMLDivElement>();
  const {
    ref: inlineImageRef,
    size: inlineImageSize,
    onLoad: handleInlineImageLoad,
  } = useImageNaturalSize();
  const resolvedPreviewSrc = previewSrc ?? src;

  if (!src || failedImageSrc === src) {
    return renderEmptyState(emptyState, emptyLabel, className);
  }

  return (
    <>
      <div ref={inlineFrameRef} className={`relative overflow-hidden ${className}`}>
        <button
          type="button"
          onClick={() => {
            if (onOpenPreview) {
              onOpenPreview();
              return;
            }

            setIsOpen(true);
          }}
          className="group block h-full w-full cursor-zoom-in overflow-hidden"
          aria-label={`Preview ${alt}`}
        >
          <img
            key={src}
            ref={inlineImageRef}
            src={src}
            alt={alt}
            loading="lazy"
            className={imageClassName}
            onLoad={(event) => {
              handleInlineImageLoad(event);
              onImageLoad?.(event);
            }}
            onError={() => setFailedImageSrc(src)}
          />
          <span className="pointer-events-none absolute inset-0 bg-zinc-950/0 transition-colors group-hover:bg-zinc-950/20" />
          <span className="pointer-events-none absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-900 opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 3h6v6" />
              <path d="M9 21H3v-6" />
              <path d="M21 3l-7 7" />
              <path d="M3 21l7-7" />
            </svg>
          </span>
        </button>

        {showInlineFaceOverlays
          ? (previewFaceOverlays ?? []).map((overlay) => {
              const overlayStyle = getFaceOverlayStyle(
                overlay.faceBoxNormalized,
                inlineFrameSize,
                inlineImageSize,
                faceOverlayFit,
              );
              if (!overlayStyle) {
                return null;
              }

              return (
                <PreviewImageFaceOverlayLink
                  key={overlay.id}
                  overlay={overlay}
                  overlayStyle={overlayStyle}
                  size="inline"
                />
              );
            })
          : null}
      </div>

      {!onOpenPreview && isOpen ? (
        <ImagePreviewLightbox
          key={resolvedPreviewSrc ?? alt}
          open
          src={resolvedPreviewSrc}
          alt={alt}
          previewImageClassName={previewImageClassName}
          emptyState={emptyState}
          emptyLabel={emptyLabel}
          previewFaceOverlays={previewFaceOverlays}
          chrome={lightboxChrome}
          onClose={() => setIsOpen(false)}
        />
      ) : null}
    </>
  );
}
