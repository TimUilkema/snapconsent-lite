"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getFaceOverlayStyle, type MeasuredSize, type NormalizedFaceBox } from "@/lib/client/face-overlay";

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
  previewFaceOverlays?: Array<{
    id: string;
    href: string;
    label: string;
    faceBoxNormalized: NormalizedFaceBox;
    headshotThumbnailUrl?: string | null;
  }>;
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

function useMeasuredSize(ref: React.RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<MeasuredSize | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const updateSize = () => {
      setSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
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
}: PreviewableImageProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [failedPreviewSrc, setFailedPreviewSrc] = useState<string | null>(null);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const previewFrameSize = useMeasuredSize(previewFrameRef);
  const [previewImageSize, setPreviewImageSize] = useState<MeasuredSize | null>(null);
  const resolvedPreviewSrc = previewSrc ?? src;

  if (!src || failedImageSrc === src) {
    return renderEmptyState(emptyState, emptyLabel, className);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setPreviewImageSize(null);
          setIsOpen(true);
        }}
        className={`group relative block cursor-zoom-in overflow-hidden ${className}`}
        aria-label={`Preview ${alt}`}
      >
        <img
          src={src}
          alt={alt}
          loading="lazy"
          className={imageClassName}
          onLoad={onImageLoad}
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

      {isOpen && typeof document !== "undefined"
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/35 p-6 backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="relative rounded-2xl border border-white/90 bg-white/95 p-2 shadow-[0_30px_80px_rgba(15,23,42,0.28),0_8px_24px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="absolute right-3 top-3 z-10 rounded-full border border-zinc-200 bg-white/95 px-3 py-2 text-xs font-medium text-zinc-900 shadow-md hover:bg-white"
            >
              Close
            </button>
            <div className="grid max-h-[82vh] max-w-[82vw] place-items-center overflow-auto rounded-xl border border-zinc-200/90 bg-white p-3">
              <div ref={previewFrameRef} className="relative inline-block">
                {resolvedPreviewSrc && failedPreviewSrc !== resolvedPreviewSrc ? (
                  <img
                    key={resolvedPreviewSrc}
                    src={resolvedPreviewSrc}
                    alt={alt}
                    className={`block h-auto max-h-[76vh] w-auto max-w-[76vw] object-contain ${previewImageClassName}`}
                    onLoad={(event) =>
                      setPreviewImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                    onError={() => setFailedPreviewSrc(resolvedPreviewSrc)}
                  />
                ) : (
                  renderEmptyState(emptyState, emptyLabel, "min-h-[24rem] min-w-[24rem]")
                )}
                {(previewFaceOverlays ?? []).map((overlay) => {
                  if (failedPreviewSrc === resolvedPreviewSrc || !resolvedPreviewSrc) {
                    return null;
                  }
                  const overlayStyle = getFaceOverlayStyle(
                    overlay.faceBoxNormalized,
                    previewFrameSize,
                    previewImageSize,
                  );
                  if (!overlayStyle) {
                    return null;
                  }

                  return (
                    <a
                      key={overlay.id}
                      href={overlay.href}
                      className="absolute z-10 block rounded-[12px] border-[4px] border-emerald-700 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.96),0_12px_24px_rgba(6,95,70,0.22)] transition-colors hover:border-emerald-800"
                      style={overlayStyle}
                      aria-label={`Open ${overlay.label}`}
                      title={`Open ${overlay.label}`}
                    >
                      {overlay.headshotThumbnailUrl ? (
                        <span
                          aria-hidden="true"
                          className="absolute left-full top-full h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-white bg-white bg-cover bg-center shadow-[0_10px_22px_rgba(15,23,42,0.22)]"
                          style={{ backgroundImage: `url("${overlay.headshotThumbnailUrl}")` }}
                        />
                      ) : (
                        <span className="absolute left-full top-full inline-flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-md border-2 border-white bg-emerald-700 text-xs font-semibold text-white shadow-[0_10px_22px_rgba(15,23,42,0.22)]">
                          {getConsentInitials(overlay.label)}
                        </span>
                      )}
                    </a>
                  );
                })}
              </div>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
