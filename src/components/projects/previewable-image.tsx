"use client";

import { useState } from "react";
import { createPortal } from "react-dom";

type PreviewableImageProps = {
  src: string | null;
  previewSrc?: string | null;
  alt: string;
  className?: string;
  imageClassName?: string;
  previewImageClassName?: string;
};

export function PreviewableImage({
  src,
  previewSrc,
  alt,
  className = "",
  imageClassName = "",
  previewImageClassName = "",
}: PreviewableImageProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!src) {
    return null;
  }

  const resolvedPreviewSrc = previewSrc ?? src;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={`group relative block cursor-zoom-in overflow-hidden ${className}`}
        aria-label={`Preview ${alt}`}
      >
        <img src={src} alt={alt} loading="lazy" className={imageClassName} />
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
            <div className="grid max-h-[76vh] max-w-[76vw] place-items-center overflow-hidden rounded-xl border border-zinc-200/90 bg-white">
              <img
                src={resolvedPreviewSrc}
                alt={alt}
                className={`block max-h-[72vh] max-w-[72vw] object-contain ${previewImageClassName}`}
              />
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}
    </>
  );
}
