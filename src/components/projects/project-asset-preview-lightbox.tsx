"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { ImagePreviewLightbox, PreviewableImage, type PreviewFaceOverlay } from "@/components/projects/previewable-image";
import { formatDate } from "@/lib/i18n/format";

type LinkedFacePreview = {
  assetFaceId: string;
  faceRank: number;
  faceBoxNormalized: Record<string, number | null> | null;
  faceThumbnailUrl: string | null;
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
  consent: {
    consentId: string;
    fullName: string | null;
    email: string | null;
    status: "active" | "revoked";
    signedAt: string | null;
    consentVersion: string | null;
    faceMatchOptIn: boolean | null;
    structuredSnapshotSummary: string[] | null;
    headshotThumbnailUrl: string | null;
    headshotPreviewUrl: string | null;
    goToConsentHref: string;
  };
};

type PreviewConsentSummary = LinkedFacePreview["consent"];

type AssetPreviewFace = {
  assetFaceId: string;
  faceRank: number;
  faceBoxNormalized: Record<string, number | null> | null;
  faceThumbnailUrl: string | null;
  detectionProbability: number | null;
  faceState: "linked_manual" | "linked_auto" | "unlinked" | "hidden";
  hiddenAt: string | null;
  currentLink: null | {
    consentId: string;
    linkSource: "manual" | "auto";
    matchConfidence: number | null;
    consent: PreviewConsentSummary;
  };
};

type AssetPreviewFacesResponse = {
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  activeLinkedFaceCount: number;
  hiddenFaceCount: number;
  faces: AssetPreviewFace[];
};

type AssetPreviewCandidate = {
  consentId: string;
  fullName: string | null;
  email: string | null;
  headshotThumbnailUrl: string | null;
  rank?: number | null;
  similarityScore?: number | null;
  scoreSource?: "current_compare" | "likely_candidate" | "unscored";
  currentAssetLink: {
    assetFaceId: string;
    faceRank: number | null;
  } | null;
};

type AssetPreviewFaceCandidatesResponse = {
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  candidates: AssetPreviewCandidate[];
};

type ProjectAssetPreviewLightboxProps = {
  projectId: string;
  asset: {
    id: string;
    originalFilename: string;
    previewUrl: string | null;
    thumbnailUrl: string | null;
    previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
    initialPreviewFaceOverlays: PreviewFaceOverlay[];
  };
  metadataLabel?: string | null;
  counterLabel?: string | null;
  preloadSrcs?: string[];
  open: boolean;
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
  onRefreshAssetData?: () => Promise<void> | void;
};

function buildOverlayId(assetFaceId: string, consentId?: string | null) {
  return consentId ? `${assetFaceId}:${consentId}` : assetFaceId;
}

function extractAssetFaceId(overlayId: string | null | undefined) {
  return String(overlayId ?? "").split(":")[0] ?? null;
}

function toLinkedFacePreview(face: AssetPreviewFace | null): LinkedFacePreview | null {
  if (!face?.currentLink) {
    return null;
  }

  return {
    assetFaceId: face.assetFaceId,
    faceRank: face.faceRank,
    faceBoxNormalized: face.faceBoxNormalized,
    faceThumbnailUrl: face.faceThumbnailUrl,
    linkSource: face.currentLink.linkSource,
    matchConfidence: face.currentLink.matchConfidence,
    consent: {
      consentId: face.currentLink.consentId,
      ...face.currentLink.consent,
    },
  };
}

function getPersonInitials(label: string) {
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

function describeLinkMeta(linkedFace: LinkedFacePreview) {
  const linkLabel = linkedFace.linkSource === "manual" ? "Manual" : "Auto";
  if (typeof linkedFace.matchConfidence === "number" && Number.isFinite(linkedFace.matchConfidence)) {
    return `${linkLabel} · ${Math.round(linkedFace.matchConfidence * 100)}%`;
  }

  return linkLabel;
}

void describeLinkMeta;

function getLinkToneClasses(linkSource: LinkedFacePreview["linkSource"], active: boolean) {
  if (linkSource === "manual") {
    return active
      ? "border-sky-300 bg-sky-50/80"
      : "border-zinc-200 bg-sky-50/55 hover:border-sky-300 hover:bg-sky-50/80";
  }

  return active
    ? "border-emerald-300 bg-emerald-50/80"
    : "border-zinc-200 bg-emerald-50/55 hover:border-emerald-300 hover:bg-emerald-50/80";
}

function getLinkIconToneClass(linkSource: LinkedFacePreview["linkSource"]) {
  return linkSource === "manual" ? "text-sky-700" : "text-emerald-700";
}

function LinkSourceIcon({
  linkSource,
  className,
}: {
  linkSource: LinkedFacePreview["linkSource"];
  className?: string;
}) {
  if (linkSource === "manual") {
    return (
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={className ?? "h-3.5 w-3.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 20h9" />
        <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className ?? "h-3.5 w-3.5"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 3 9.7 6.7 6 8l3.7 1.3L11 13l1.3-3.7L16 8l-3.7-1.3Z" />
      <path d="M18 13.5 17.2 15.7 15 16.5l2.2.8.8 2.2.8-2.2 2.2-.8-2.2-.8Z" />
    </svg>
  );
}

function AutoCandidateIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className ?? "h-3.5 w-3.5"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M11 3 9.7 6.7 6 8l3.7 1.3L11 13l1.3-3.7L16 8l-3.7-1.3Z" />
      <path d="M18 13.5 17.2 15.7 15 16.5l2.2.8.8 2.2.8-2.2 2.2-.8-2.2-.8Z" />
    </svg>
  );
}

function HideFaceIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m3 3 18 18" />
      <path d="M10.6 10.5a2 2 0 0 0 2.9 2.8" />
      <path d="M9.9 4.2A9.8 9.8 0 0 1 12 4c5 0 8.6 4 9.5 5-.4.5-1.4 1.7-2.9 2.9" />
      <path d="M6.2 6.3C4.1 7.7 2.8 9.4 2.5 9.9c.5.6 1.9 2.2 4.1 3.7" />
    </svg>
  );
}

function CloseTrayIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className ?? "h-4 w-4"}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function EnlargeImageIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className ?? "h-4 w-4"}
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
  );
}

export function AssetPreviewConsentPanel({
  linkedFace,
  locale,
  placeholderLabel,
  goToConsentLabel,
  signedLabel,
  consentSummaryLabel,
  headshotLabel,
  noEmailLabel,
  unknownValueLabel,
  activeLabel,
  revokedLabel,
  autoLinkLabel,
  manualLinkLabel,
  removeLinkLabel,
  changePersonLabel,
  changePersonCloseLabel,
  saveChangeLabel,
  currentLabel,
  linkedToFaceLabel,
  pickerLoadingLabel,
  pickerEmptyLabel,
  removeLinkErrorLabel,
  changePersonErrorLabel,
  moveWarningLabel,
  hideFaceLabel,
  hideFaceBusyLabel,
  isSaving,
  actionError,
  isChangePersonOpen,
  isLoadingCandidates,
  candidates,
  selectedReplacementConsentId,
  onRemoveLink,
  onHideFace,
  onToggleChangePerson,
  onSelectReplacement,
  onSaveChange,
}: {
  linkedFace: LinkedFacePreview | null;
  locale: string;
  placeholderLabel: string;
  goToConsentLabel: string;
  signedLabel: string;
  consentSummaryLabel: string;
  headshotLabel: string;
  noEmailLabel: string;
  unknownValueLabel: string;
  activeLabel: string;
  revokedLabel: string;
  autoLinkLabel: string;
  manualLinkLabel: string;
  removeLinkLabel: string;
  changePersonLabel: string;
  changePersonCloseLabel: string;
  saveChangeLabel: string;
  currentLabel: string;
  linkedToFaceLabel: (face: number) => string;
  pickerLoadingLabel: string;
  pickerEmptyLabel: string;
  removeLinkErrorLabel: string;
  changePersonErrorLabel: string;
  moveWarningLabel: (face: number) => string;
  hideFaceLabel?: string;
  hideFaceBusyLabel?: string;
  isSaving: boolean;
  actionError: string | null;
  isChangePersonOpen: boolean;
  isLoadingCandidates: boolean;
  candidates: AssetPreviewCandidate[];
  selectedReplacementConsentId: string | null;
  onRemoveLink: () => void;
  onHideFace?: (() => void) | null;
  onToggleChangePerson: () => void;
  onSelectReplacement: (consentId: string) => void;
  onSaveChange: () => void;
}) {
  if (!linkedFace) {
    return (
      <div className="flex h-full min-h-[240px] items-center rounded-xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600">
        {placeholderLabel}
      </div>
    );
  }

  const displayName =
    linkedFace.consent.fullName ||
    linkedFace.consent.email ||
    `Consent ${linkedFace.consent.consentId}`;
  const selectedReplacement =
    candidates.find((candidate) => candidate.consentId === selectedReplacementConsentId) ?? null;
  const movingExistingLink =
    selectedReplacement?.currentAssetLink &&
    selectedReplacement.currentAssetLink.assetFaceId !== linkedFace.assetFaceId
      ? selectedReplacement.currentAssetLink
      : null;

  return (
    <div className="h-full rounded-xl border border-zinc-200 bg-white p-4">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
            {linkedFace.faceThumbnailUrl ? (
              <span
                aria-hidden="true"
                className="h-full w-full bg-cover bg-center"
                style={{ backgroundImage: `url("${linkedFace.faceThumbnailUrl}")` }}
              />
            ) : (
              <span className="text-sm font-semibold text-zinc-700">{getPersonInitials(displayName)}</span>
            )}
          </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-zinc-900">{displayName}</p>
              <p className="mt-1 truncate text-sm text-zinc-600">{linkedFace.consent.email ?? noEmailLabel}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {linkedFace.consent.status === "revoked" ? revokedLabel : activeLabel}
                </span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {linkedFace.linkSource === "auto" && typeof linkedFace.matchConfidence === "number"
                    ? `${autoLinkLabel} ${Math.round(linkedFace.matchConfidence * 100)}%`
                    : linkedFace.linkSource === "manual"
                      ? manualLinkLabel
                      : autoLinkLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{signedLabel}</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">
                {linkedFace.consent.signedAt ? formatDate(linkedFace.consent.signedAt, locale) : unknownValueLabel}
              </p>
            </div>
          </div>

          {linkedFace.consent.structuredSnapshotSummary?.length ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{consentSummaryLabel}</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-800">
                {linkedFace.consent.structuredSnapshotSummary.map((summary) => (
                  <li key={summary}>{summary}</li>
                ))}
            </ul>
          </div>
        ) : null}

          {linkedFace.consent.headshotThumbnailUrl ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{headshotLabel}</p>
              <div className="mt-2 h-20 w-20 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                <PreviewableImage
                  src={linkedFace.consent.headshotThumbnailUrl}
                  previewSrc={linkedFace.consent.headshotPreviewUrl}
                  alt={headshotLabel}
                  className="h-full w-full"
                  imageClassName="h-full w-full object-cover"
                  previewImageClassName="object-contain"
                  lightboxChrome="floating"
                />
            </div>
          </div>
        ) : null}

          {actionError ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {actionError}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 pt-1">
            <a
              href={linkedFace.consent.goToConsentHref}
              className="inline-flex rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              {goToConsentLabel}
            </a>
            <button
              type="button"
              disabled={isSaving}
              onClick={onRemoveLink}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              {isSaving ? removeLinkErrorLabel : removeLinkLabel}
            </button>
            {onHideFace && hideFaceLabel && hideFaceBusyLabel ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={onHideFace}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                {isSaving ? hideFaceBusyLabel : hideFaceLabel}
              </button>
            ) : null}
            <button
              type="button"
              disabled={isSaving}
              onClick={onToggleChangePerson}
              className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {isChangePersonOpen ? changePersonCloseLabel : changePersonLabel}
            </button>
          </div>

          {isChangePersonOpen ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="space-y-3">
                {isLoadingCandidates ? (
                  <p className="text-sm text-zinc-600">{pickerLoadingLabel}</p>
                ) : candidates.length === 0 ? (
                  <p className="text-sm text-zinc-600">{pickerEmptyLabel}</p>
                ) : (
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {candidates.map((candidate) => {
                      const candidateName = candidate.fullName || `Consent ${candidate.consentId}`;
                      const isCurrent = candidate.consentId === linkedFace.consent.consentId;
                      const isSelectedCandidate = candidate.consentId === selectedReplacementConsentId;

                      return (
                        <button
                          key={candidate.consentId}
                          type="button"
                          onClick={() => onSelectReplacement(candidate.consentId)}
                          className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left ${
                            isSelectedCandidate
                              ? "border-zinc-900 bg-white"
                              : "border-zinc-200 bg-white hover:border-zinc-300"
                          }`}
                        >
                          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                            {candidate.headshotThumbnailUrl ? (
                              <span
                                aria-hidden="true"
                                className="h-full w-full bg-cover bg-center"
                                style={{ backgroundImage: `url("${candidate.headshotThumbnailUrl}")` }}
                              />
                            ) : (
                              <span className="text-xs font-semibold text-zinc-700">
                                {getPersonInitials(candidateName)}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-zinc-900">{candidateName}</span>
                            {typeof candidate.similarityScore === "number" ? (
                              <span className="mt-1 block text-xs text-zinc-500">
                                {Math.round(candidate.similarityScore * 100)}%
                              </span>
                            ) : null}
                          </span>
                          {isCurrent ? (
                            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
                              {currentLabel}
                            </span>
                          ) : candidate.currentAssetLink ? (
                            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
                              {linkedToFaceLabel((candidate.currentAssetLink.faceRank ?? 0) + 1)}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}

                {movingExistingLink ? (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    {moveWarningLabel((movingExistingLink.faceRank ?? 0) + 1)}
                  </div>
                ) : null}

                <button
                  type="button"
                  disabled={
                    isSaving ||
                    !selectedReplacement ||
                    selectedReplacement.consentId === linkedFace.consent.consentId
                  }
                  onClick={onSaveChange}
                  className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {isSaving ? changePersonErrorLabel : saveChangeLabel}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

export function AssetPreviewLinkedPeopleStrip({
  linkedFaces,
  hoveredLinkedFaceId,
  selectedLinkedFaceId,
  isLoading,
  errorMessage,
  onHoverChange,
  onSelect,
  emptyLabel,
  autoLinkLabel,
  manualLinkLabel,
}: {
  linkedFaces: LinkedFacePreview[];
  hoveredLinkedFaceId: string | null;
  selectedLinkedFaceId: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  onHoverChange: (assetFaceId: string | null) => void;
  onSelect: (assetFaceId: string) => void;
  emptyLabel: string;
  autoLinkLabel: string;
  manualLinkLabel: string;
}) {
  if (isLoading && linkedFaces.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
        Loading linked people...
      </div>
    );
  }

  if (errorMessage && linkedFaces.length === 0) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {errorMessage}
      </div>
    );
  }

  if (linkedFaces.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {linkedFaces.map((linkedFace) => {
          const displayName = linkedFace.consent.fullName || `Consent ${linkedFace.consent.consentId}`;
          const isHovered = hoveredLinkedFaceId === linkedFace.assetFaceId;
          const isSelected = selectedLinkedFaceId === linkedFace.assetFaceId;
          const thumbnailUrl = linkedFace.consent.headshotThumbnailUrl ?? linkedFace.faceThumbnailUrl ?? null;

          return (
            <button
              key={linkedFace.assetFaceId}
              type="button"
              onMouseEnter={() => onHoverChange(linkedFace.assetFaceId)}
              onMouseLeave={() => onHoverChange(null)}
              onFocus={() => onHoverChange(linkedFace.assetFaceId)}
              onBlur={() => onHoverChange(null)}
              onClick={() => onSelect(linkedFace.assetFaceId)}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                isSelected || isHovered
                  ? getLinkToneClasses(linkedFace.linkSource, true)
                  : getLinkToneClasses(linkedFace.linkSource, false)
              }`}
            >
              <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                {thumbnailUrl ? (
                  <span
                    aria-hidden="true"
                    className="h-full w-full bg-cover bg-center"
                    style={{ backgroundImage: `url("${thumbnailUrl}")` }}
                  />
                ) : (
                  <span className="text-xs font-semibold text-zinc-700">{getPersonInitials(displayName)}</span>
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-zinc-900">{displayName}</span>
                <span className="mt-1 flex items-center gap-1.5 text-xs text-zinc-600">
                  <LinkSourceIcon
                    linkSource={linkedFace.linkSource}
                    className={`h-3.5 w-3.5 ${getLinkIconToneClass(linkedFace.linkSource)}`}
                  />
                  <span>
                    {linkedFace.linkSource === "auto" && typeof linkedFace.matchConfidence === "number"
                      ? `${autoLinkLabel} ${Math.round(linkedFace.matchConfidence * 100)}%`
                      : linkedFace.linkSource === "manual"
                        ? manualLinkLabel
                        : autoLinkLabel}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssetPreviewShowHiddenToggle({
  hiddenFaceCount,
  checked,
  onChange,
  label,
}: {
  hiddenFaceCount: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: (count: number) => string;
}) {
  if (hiddenFaceCount <= 0) {
    return null;
  }

  return (
    <label className="inline-flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
      />
      <span>{label(hiddenFaceCount)}</span>
    </label>
  );
}

function AssetPreviewUnlinkedFaceTray({
  candidates,
  isLoadingCandidates,
  selectedCandidateConsentId,
  onSelectCandidate,
  onSave,
  onHide,
  onClose,
  isSavingLink,
  isSavingHide,
  isConfirmingHide,
  onToggleHideConfirm,
  actionError,
  selectionLabel,
  closeLabel,
  pickerLoadingLabel,
  pickerEmptyLabel,
  saveLabel,
  savingLabel,
  hideLabel,
  hidingLabel,
  linkedToFaceLabel,
  moveWarningLabel,
  confirmMoveLabel,
  cancelLabel,
  autoLabel,
}: {
  candidates: AssetPreviewCandidate[];
  isLoadingCandidates: boolean;
  selectedCandidateConsentId: string | null;
  onSelectCandidate: (consentId: string) => void;
  onSave: () => void;
  onHide: () => void;
  onClose: () => void;
  isSavingLink: boolean;
  isSavingHide: boolean;
  isConfirmingHide: boolean;
  onToggleHideConfirm: () => void;
  actionError: string | null;
  selectionLabel: string;
  closeLabel: string;
  pickerLoadingLabel: string;
  pickerEmptyLabel: string;
  saveLabel: string;
  savingLabel: string;
  hideLabel: string;
  hidingLabel: string;
  linkedToFaceLabel: (face: number) => string;
  moveWarningLabel: (face: number) => string;
  confirmMoveLabel: string;
  cancelLabel: string;
  autoLabel: string;
}) {
  const [previewCandidate, setPreviewCandidate] = useState<AssetPreviewCandidate | null>(null);
  const [confirmMoveConsentId, setConfirmMoveConsentId] = useState<string | null>(null);

  return (
    <div className="flex h-[20rem] max-h-full select-none flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{selectionLabel}</p>
        </div>
        <button
          type="button"
          disabled={isSavingLink || isSavingHide}
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-black bg-black text-white shadow-sm hover:bg-zinc-900 disabled:opacity-60"
          aria-label={closeLabel}
          title={closeLabel}
        >
          <CloseTrayIcon />
        </button>
      </div>

      <div className="mt-3 min-h-0 flex-1 overflow-hidden">
        {isLoadingCandidates ? (
          <p className="text-sm text-zinc-600">{pickerLoadingLabel}</p>
        ) : candidates.length === 0 ? (
          <p className="text-sm text-zinc-600">{pickerEmptyLabel}</p>
        ) : (
          <div
            className="h-full min-h-0 space-y-2 overflow-y-auto pr-1"
            onWheel={(event) => {
              event.stopPropagation();
            }}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {candidates.map((candidate) => {
              const candidateName = candidate.fullName || `Consent ${candidate.consentId}`;
              const isSelected = candidate.consentId === selectedCandidateConsentId;
              const isLinkedElsewhere =
                Boolean(candidate.currentAssetLink) &&
                candidate.currentAssetLink?.assetFaceId !== null;
              const isAwaitingMoveConfirm = confirmMoveConsentId === candidate.consentId;

              return (
                <div
                  key={candidate.consentId}
                  onClick={() => {
                    if (isLinkedElsewhere && !isAwaitingMoveConfirm) {
                      setConfirmMoveConsentId(candidate.consentId);
                      return;
                    }

                    setConfirmMoveConsentId(null);
                    onSelectCandidate(candidate.consentId);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (isLinkedElsewhere && !isAwaitingMoveConfirm) {
                        setConfirmMoveConsentId(candidate.consentId);
                        return;
                      }

                      setConfirmMoveConsentId(null);
                      onSelectCandidate(candidate.consentId);
                    }
                  }}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    isSelected
                      ? "border-zinc-900 bg-zinc-50"
                      : isLinkedElsewhere
                        ? "border-zinc-300 bg-zinc-100 text-zinc-600 opacity-80 ring-1 ring-zinc-200 hover:border-zinc-400"
                        : "border-zinc-200 bg-white hover:border-zinc-300"
                  }`}
                >
                  <span className="flex items-start gap-3">
                    {candidate.headshotThumbnailUrl ? (
                      <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                        <span
                          aria-hidden="true"
                          className={`block h-full w-full bg-cover bg-center ${isLinkedElsewhere ? "opacity-70" : ""}`}
                          style={{ backgroundImage: `url("${candidate.headshotThumbnailUrl}")` }}
                        />
                        <button
                          type="button"
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setPreviewCandidate(candidate);
                          }}
                          className="absolute right-1 top-1 inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white/95 text-zinc-700 hover:bg-white"
                          aria-label={`Open ${candidateName}`}
                          title={`Open ${candidateName}`}
                        >
                          <EnlargeImageIcon className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    ) : (
                      <span className="grid h-16 w-16 shrink-0 place-items-center rounded-md border border-zinc-200 bg-zinc-100 text-xs font-semibold text-zinc-700">
                        {getPersonInitials(candidateName)}
                      </span>
                    )}
                    <span className="block min-w-0 flex-1">
                      <span className={`block truncate text-sm font-medium ${isLinkedElsewhere ? "text-zinc-600" : "text-zinc-900"}`}>
                        {candidateName}
                      </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                        <AutoCandidateIcon className="h-3.5 w-3.5 text-zinc-700" />
                        <span>{autoLabel}</span>
                        {typeof candidate.similarityScore === "number" ? (
                          <span>{Math.round(candidate.similarityScore * 100)}%</span>
                        ) : null}
                      </span>
                      {candidate.currentAssetLink ? (
                        <span className="mt-2 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
                          {linkedToFaceLabel((candidate.currentAssetLink.faceRank ?? 0) + 1)}
                        </span>
                      ) : null}
                      {isAwaitingMoveConfirm && candidate.currentAssetLink ? (
                        <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-2 text-xs text-amber-900">
                          <span className="block">
                            {moveWarningLabel((candidate.currentAssetLink.faceRank ?? 0) + 1)}
                          </span>
                          <span className="mt-2 flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setConfirmMoveConsentId(null);
                                onSelectCandidate(candidate.consentId);
                              }}
                              className="rounded-md border border-zinc-900 bg-zinc-900 px-2 py-1 text-xs font-medium text-white hover:bg-zinc-800"
                            >
                              {confirmMoveLabel}
                            </button>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                setConfirmMoveConsentId(null);
                              }}
                              className="text-xs font-medium text-zinc-600 hover:text-zinc-900"
                            >
                              {cancelLabel}
                            </button>
                          </span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {actionError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-zinc-200 pt-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isSavingLink || isSavingHide || !selectedCandidateConsentId}
            onClick={onSave}
            className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {isSavingLink ? savingLabel : saveLabel}
          </button>
          {isConfirmingHide ? (
            <button
              type="button"
              disabled={isSavingLink || isSavingHide}
              onClick={onHide}
              className="rounded-lg border border-red-700 bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
            >
              {isSavingHide ? hidingLabel : hideLabel}
            </button>
          ) : (
            <button
              type="button"
              disabled={isSavingLink || isSavingHide}
              onClick={onToggleHideConfirm}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              aria-label={hideLabel}
              title={hideLabel}
            >
              <HideFaceIcon />
            </button>
          )}
        </div>
        {isConfirmingHide ? (
          <button
            type="button"
            disabled={isSavingHide}
            onClick={onToggleHideConfirm}
            className="text-xs font-medium text-zinc-600 hover:text-zinc-900 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
        ) : null}
      </div>

      {previewCandidate?.headshotThumbnailUrl ? (
        <ImagePreviewLightbox
          open
          src={previewCandidate.headshotThumbnailUrl}
          alt={previewCandidate.fullName || `Consent ${previewCandidate.consentId}`}
          previewImageClassName="object-contain"
          chrome="floating"
          onClose={() => setPreviewCandidate(null)}
        />
      ) : null}
    </div>
  );
}

function AssetPreviewHiddenFaceTray({
  selectedFace,
  onRestore,
  isSavingRestore,
  actionError,
  titleLabel,
  descriptionLabel,
  restoreLabel,
  restoringLabel,
}: {
  selectedFace: AssetPreviewFace;
  onRestore: () => void;
  isSavingRestore: boolean;
  actionError: string | null;
  titleLabel: (face: number) => string;
  descriptionLabel: string;
  restoreLabel: string;
  restoringLabel: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{titleLabel(selectedFace.faceRank + 1)}</p>
          <p className="mt-1 text-sm text-zinc-600">{descriptionLabel}</p>
        </div>
        <div className="h-14 w-14 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
          {selectedFace.faceThumbnailUrl ? (
            <span
              aria-hidden="true"
              className="block h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url("${selectedFace.faceThumbnailUrl}")` }}
            />
          ) : null}
        </div>
      </div>

      {actionError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="mt-4">
        <button
          type="button"
          disabled={isSavingRestore}
          onClick={onRestore}
          className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {isSavingRestore ? restoringLabel : restoreLabel}
        </button>
      </div>
    </div>
  );
}

export function ProjectAssetPreviewLightbox({
  projectId,
  asset,
  metadataLabel = null,
  counterLabel = null,
  preloadSrcs = [],
  open,
  onClose,
  onPrevious = null,
  onNext = null,
  canPrevious = false,
  canNext = false,
  previousLabel,
  nextLabel,
  closeLabel,
  zoomInLabel,
  zoomOutLabel,
  zoomResetLabel,
  zoomInputLabel,
  zoomInputHint,
  onRefreshAssetData,
}: ProjectAssetPreviewLightboxProps) {
  const locale = useLocale();
  const t = useTranslations("projects.assetsList");
  const [previewData, setPreviewData] = useState<AssetPreviewFacesResponse | null>(null);
  const [candidateData, setCandidateData] = useState<AssetPreviewFaceCandidatesResponse | null>(null);
  const [isLoadingPreviewData, setIsLoadingPreviewData] = useState(false);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [isSavingHide, setIsSavingHide] = useState(false);
  const [isSavingRestore, setIsSavingRestore] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [isChangePersonOpen, setIsChangePersonOpen] = useState(false);
  const [selectedReplacementConsentId, setSelectedReplacementConsentId] = useState<string | null>(null);
  const [showHiddenFaces, setShowHiddenFaces] = useState(false);
  const [isConfirmingHideFace, setIsConfirmingHideFace] = useState(false);

  const loadPreviewData = useCallback(async (signal?: AbortSignal) => {
    setIsLoadingPreviewData(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/assets/${asset.id}/preview-faces`, {
        method: "GET",
        cache: "no-store",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as
        | (AssetPreviewFacesResponse & { message?: string })
        | null;

      if (!response.ok || !payload) {
        setPreviewError(payload?.message ?? t("previewLoadError"));
        setPreviewData(null);
        return;
      }

      setPreviewData(payload);
      setPreviewError(null);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return;
      }

      setPreviewError(t("previewLoadError"));
      setPreviewData(null);
    } finally {
      setIsLoadingPreviewData(false);
    }
  }, [asset.id, projectId, t]);

  const loadCandidateData = useCallback(async (assetFaceId: string) => {
    setIsLoadingCandidates(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/faces/${assetFaceId}/preview-candidates`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (AssetPreviewFaceCandidatesResponse & { message?: string })
        | null;

      if (!response.ok || !payload) {
        setActionError(payload?.message ?? t("previewCandidateLoadError"));
        setCandidateData(null);
        return;
      }

      setCandidateData(payload);
      setActionError(null);
    } catch {
      setActionError(t("previewCandidateLoadError"));
      setCandidateData(null);
    } finally {
      setIsLoadingCandidates(false);
    }
  }, [asset.id, projectId, t]);

  useEffect(() => {
    if (!open) {
      setHoveredFaceId(null);
      setSelectedFaceId(null);
      setShowHiddenFaces(false);
      setIsConfirmingHideFace(false);
      return;
    }

    setPreviewData(null);
    setCandidateData(null);
    setPreviewError(null);
    setActionError(null);
    setHoveredFaceId(null);
    setSelectedFaceId(null);
    setIsChangePersonOpen(false);
    setSelectedReplacementConsentId(null);
    setShowHiddenFaces(false);
    setIsConfirmingHideFace(false);

    const controller = new AbortController();

    void loadPreviewData(controller.signal);

    return () => controller.abort();
  }, [asset.id, loadPreviewData, open]);

  const allFaces = useMemo(() => previewData?.faces ?? [], [previewData]);
  const visibleFaces = useMemo(
    () => (showHiddenFaces ? allFaces : allFaces.filter((face) => face.faceState !== "hidden")),
    [allFaces, showHiddenFaces],
  );
  const linkedFaces = useMemo(
    () =>
      allFaces
        .map((face) => toLinkedFacePreview(face))
        .filter((face): face is LinkedFacePreview => Boolean(face)),
    [allFaces],
  );
  const selectedFace = allFaces.find((face) => face.assetFaceId === selectedFaceId) ?? null;
  const selectedLinkedFace = toLinkedFacePreview(selectedFace);
  const selectedFaceCandidates =
    selectedFace && candidateData?.assetFaceId === selectedFace.assetFaceId ? candidateData.candidates : [];
  const selectedLinkedFaceCandidates =
    selectedLinkedFace && candidateData?.assetFaceId === selectedLinkedFace.assetFaceId ? candidateData.candidates : [];
  const selectedFacePreviewCandidate =
    selectedFace?.faceState === "unlinked" &&
    selectedReplacementConsentId &&
    candidateData?.assetFaceId === selectedFace.assetFaceId
      ? candidateData.candidates.find((candidate) => candidate.consentId === selectedReplacementConsentId) ?? null
      : null;

  const previewFaceOverlays = useMemo(() => {
    if (previewData?.faces?.length) {
      return visibleFaces
        .filter((face) => Boolean(face.faceBoxNormalized))
        .map((face) => {
          const isSelectedUnlinkedPreview =
            selectedFacePreviewCandidate && selectedFace?.assetFaceId === face.assetFaceId;

          return {
            id: buildOverlayId(
              face.assetFaceId,
              isSelectedUnlinkedPreview
                ? selectedFacePreviewCandidate.consentId
                : face.currentLink?.consentId,
            ),
            href:
              !isSelectedUnlinkedPreview && face.currentLink?.consent.goToConsentHref
                ? face.currentLink.consent.goToConsentHref
                : "#",
            label:
              isSelectedUnlinkedPreview
                ? selectedFacePreviewCandidate.fullName ||
                  selectedFacePreviewCandidate.email ||
                  `Consent ${selectedFacePreviewCandidate.consentId}`
                : face.currentLink?.consent.fullName ||
                  face.currentLink?.consent.email ||
                  t("previewDetectedFaceLabel", { face: face.faceRank + 1 }),
            faceBoxNormalized: face.faceBoxNormalized!,
            headshotThumbnailUrl:
              isSelectedUnlinkedPreview
                ? selectedFacePreviewCandidate.headshotThumbnailUrl ?? null
                : face.currentLink?.consent.headshotThumbnailUrl ?? null,
            matchConfidence:
              isSelectedUnlinkedPreview
                ? selectedFacePreviewCandidate.similarityScore ?? null
                : face.currentLink?.matchConfidence ?? null,
            linkSource: face.currentLink?.linkSource ?? null,
            linkSourceLabel:
              face.faceState === "linked_manual"
                ? t("previewLinkSourceManual")
                : face.faceState === "linked_auto"
                  ? t("previewLinkSourceAuto")
                  : face.faceState === "hidden"
                    ? t("previewFaceStateHidden")
                    : t("previewFaceStateDetected"),
            tone:
              face.faceState === "linked_manual"
                ? "manual"
                : face.faceState === "linked_auto"
                  ? "auto"
                  : face.faceState === "hidden"
                    ? "hidden"
                    : "unlinked",
            metaLabel:
              isSelectedUnlinkedPreview
                ? t("previewFaceStateDetected")
                : face.faceState === "linked_manual"
                  ? t("previewLinkSourceManual")
                  : face.faceState === "linked_auto"
                    ? t("previewLinkSourceAuto")
                    : face.faceState === "hidden"
                      ? t("previewFaceStateHidden")
                      : t("previewFaceStateDetected"),
          };
        }) satisfies PreviewFaceOverlay[];
    }

    return asset.initialPreviewFaceOverlays;
  }, [asset.initialPreviewFaceOverlays, previewData, selectedFace?.assetFaceId, selectedFacePreviewCandidate, t, visibleFaces]);

  const selectedOverlayId = useMemo(() => {
    if (!selectedFaceId) {
      return null;
    }

    return previewFaceOverlays.find((overlay) => extractAssetFaceId(overlay.id) === selectedFaceId)?.id ?? null;
  }, [previewFaceOverlays, selectedFaceId]);

  useEffect(() => {
    if (!selectedFaceId) {
      return;
    }

    if (!allFaces.some((face) => face.assetFaceId === selectedFaceId)) {
      setSelectedFaceId(null);
      setIsChangePersonOpen(false);
      setSelectedReplacementConsentId(null);
      setCandidateData(null);
      setIsConfirmingHideFace(false);
    }
  }, [allFaces, selectedFaceId]);

  useEffect(() => {
    if (!showHiddenFaces && selectedFace?.faceState === "hidden") {
      setSelectedFaceId(null);
      setCandidateData(null);
      setSelectedReplacementConsentId(null);
      setIsConfirmingHideFace(false);
    }
  }, [selectedFace, showHiddenFaces]);

  useEffect(() => {
    if (!selectedFace) {
      setCandidateData(null);
      setSelectedReplacementConsentId(null);
      setIsConfirmingHideFace(false);
      return;
    }

    const shouldLoadCandidates =
      selectedFace.faceState === "unlinked" ||
      ((selectedFace.faceState === "linked_manual" || selectedFace.faceState === "linked_auto") && isChangePersonOpen);

    if (!shouldLoadCandidates) {
      setCandidateData(null);
      setSelectedReplacementConsentId(null);
      setIsConfirmingHideFace(false);
      return;
    }

    if (candidateData?.assetFaceId === selectedFace.assetFaceId) {
      return;
    }

    setCandidateData(null);
    setSelectedReplacementConsentId(null);
    setIsConfirmingHideFace(false);
    void loadCandidateData(selectedFace.assetFaceId);
  }, [candidateData?.assetFaceId, isChangePersonOpen, loadCandidateData, selectedFace]);

  async function refreshAfterWrite(nextSelectedFaceId: string | null) {
    await loadPreviewData();
    await onRefreshAssetData?.();
    setSelectedFaceId(nextSelectedFaceId);
    setCandidateData(null);
    setIsChangePersonOpen(false);
    setSelectedReplacementConsentId(null);
    setIsConfirmingHideFace(false);
  }

  async function handleRemoveLink() {
    if (!selectedLinkedFace) {
      return;
    }

    setIsSavingLink(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/consents/${selectedLinkedFace.consent.consentId}/assets/links`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            assetId: asset.id,
            mode: "face",
            assetFaceId: selectedLinkedFace.assetFaceId,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setActionError(payload?.message ?? t("previewRemoveLinkError"));
        return;
      }

      await refreshAfterWrite(null);
    } catch {
      setActionError(t("previewRemoveLinkError"));
    } finally {
      setIsSavingLink(false);
    }
  }

  async function submitSelectedFaceLink() {
    if (!selectedFace || !selectedReplacementConsentId) {
      return;
    }

    setIsSavingLink(true);
    setActionError(null);
    try {
      let shouldForceReplace = false;
      let response: Response | null = null;
      let payload:
        | {
            message?: string;
            canForceReplace?: boolean;
          }
        | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        response = await fetch(
          `/api/projects/${projectId}/consents/${selectedReplacementConsentId}/assets/links`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              assetId: asset.id,
              mode: "face",
              assetFaceId: selectedFace.assetFaceId,
              forceReplace: shouldForceReplace,
            }),
          },
        );
        payload = (await response.json().catch(() => null)) as
          | {
              message?: string;
              canForceReplace?: boolean;
            }
          | null;

        if (response.status === 409 && payload?.canForceReplace && !shouldForceReplace) {
          shouldForceReplace = true;
          continue;
        }

        break;
      }

      if (!response?.ok) {
        setActionError(payload?.message ?? t("previewChangePersonError"));
        return;
      }

      await refreshAfterWrite(selectedFace.assetFaceId);
    } catch {
      setActionError(
        selectedFace.faceState === "unlinked" ? t("previewSaveFaceLinkError") : t("previewChangePersonError"),
      );
    } finally {
      setIsSavingLink(false);
    }
  }

  async function handleHideFace() {
    if (!selectedFace || selectedFace.faceState === "hidden") {
      return;
    }

    setIsSavingHide(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/hidden-faces/${selectedFace.assetFaceId}`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setActionError(payload?.message ?? t("previewHideFaceError"));
        return;
      }

      await refreshAfterWrite(showHiddenFaces ? selectedFace.assetFaceId : null);
    } catch {
      setActionError(t("previewHideFaceError"));
    } finally {
      setIsSavingHide(false);
    }
  }

  async function handleRestoreFace() {
    if (!selectedFace || selectedFace.faceState !== "hidden") {
      return;
    }

    setIsSavingRestore(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/hidden-faces/${selectedFace.assetFaceId}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setActionError(payload?.message ?? t("previewRestoreFaceError"));
        return;
      }

      await refreshAfterWrite(selectedFace.assetFaceId);
    } catch {
      setActionError(t("previewRestoreFaceError"));
    } finally {
      setIsSavingRestore(false);
    }
  }

  return (
    <ImagePreviewLightbox
      key={`${asset.id}:project-preview`}
      open={open}
      src={asset.previewUrl ?? asset.thumbnailUrl ?? null}
      alt={asset.originalFilename || t("previewFallbackTitle")}
      emptyState={asset.previewState === "processing" ? "processing" : "unavailable"}
      emptyLabel={asset.previewState === "processing" ? t("processingDisplay") : t("unavailableDisplay")}
      previewFaceOverlays={previewFaceOverlays}
      hoveredOverlayId={
        hoveredFaceId
          ? previewFaceOverlays.find((overlay) => extractAssetFaceId(overlay.id) === hoveredFaceId)?.id ?? null
          : null
      }
      selectedOverlayId={selectedOverlayId}
      onHoveredOverlayIdChange={(overlayId) => {
        if (!overlayId) {
          setHoveredFaceId(null);
          return;
        }

        setHoveredFaceId(extractAssetFaceId(overlayId));
      }}
      onPreviewOverlayActivate={(overlay) => {
        const nextFaceId = extractAssetFaceId(overlay.id);
        setSelectedFaceId(nextFaceId);
        setIsChangePersonOpen(false);
        setSelectedReplacementConsentId(null);
        setCandidateData(null);
        setIsConfirmingHideFace(false);
        setActionError(null);
      }}
      selectedOverlayDetail={
        selectedFace?.faceState === "unlinked" ? (
          <AssetPreviewUnlinkedFaceTray
            candidates={selectedFaceCandidates}
            isLoadingCandidates={isLoadingCandidates}
            selectedCandidateConsentId={selectedReplacementConsentId}
            onSelectCandidate={(consentId) => {
              setSelectedReplacementConsentId(consentId);
              setActionError(null);
            }}
            onSave={() => {
              void submitSelectedFaceLink();
            }}
            onHide={() => {
              void handleHideFace();
            }}
            onClose={() => {
              setSelectedFaceId(null);
              setSelectedReplacementConsentId(null);
              setCandidateData(null);
              setIsConfirmingHideFace(false);
              setActionError(null);
            }}
            isSavingLink={isSavingLink}
            isSavingHide={isSavingHide}
            isConfirmingHide={isConfirmingHideFace}
            onToggleHideConfirm={() => {
              setIsConfirmingHideFace((current) => !current);
            }}
            actionError={actionError}
            selectionLabel={t("previewSelectPerson")}
            closeLabel={t("previewCloseChangePerson")}
            pickerLoadingLabel={t("previewPickerLoading")}
            pickerEmptyLabel={t("previewPickerEmpty")}
            saveLabel={t("previewSaveFaceLink")}
            savingLabel={t("previewSavingFaceLink")}
            hideLabel={t("previewHideFace")}
            hidingLabel={t("previewHidingFace")}
            linkedToFaceLabel={(face) => t("previewLinkedToFace", { face })}
            moveWarningLabel={(face) => t("previewMoveLinkedPersonWarning", { face })}
            confirmMoveLabel={t("previewSelectPerson")}
            cancelLabel={t("previewCancel")}
            autoLabel={t("previewLinkSourceAuto")}
          />
        ) : null
      }
      belowScene={
        <div className="space-y-3">
          <AssetPreviewShowHiddenToggle
            hiddenFaceCount={previewData?.hiddenFaceCount ?? 0}
            checked={showHiddenFaces}
            onChange={(checked) => setShowHiddenFaces(checked)}
            label={(count) => t("previewShowHiddenFaces", { count })}
          />
          <AssetPreviewLinkedPeopleStrip
            linkedFaces={linkedFaces}
            hoveredLinkedFaceId={hoveredFaceId}
            selectedLinkedFaceId={selectedLinkedFace?.assetFaceId ?? null}
            isLoading={isLoadingPreviewData}
            errorMessage={previewError}
            emptyLabel={t("previewLinkedPeopleEmpty")}
            autoLinkLabel={t("previewLinkSourceAuto")}
            manualLinkLabel={t("previewLinkSourceManual")}
            onHoverChange={setHoveredFaceId}
            onSelect={setSelectedFaceId}
          />
          {selectedFace?.faceState === "hidden" && showHiddenFaces ? (
            <AssetPreviewHiddenFaceTray
              selectedFace={selectedFace}
              onRestore={() => {
                void handleRestoreFace();
              }}
              isSavingRestore={isSavingRestore}
              actionError={actionError}
              titleLabel={(face) => t("previewHiddenFaceTitle", { face })}
              descriptionLabel={t("previewHiddenFaceHelp")}
              restoreLabel={t("previewRestoreFace")}
              restoringLabel={t("previewRestoringFace")}
            />
          ) : null}
        </div>
      }
      sidePanel={
        <AssetPreviewConsentPanel
          linkedFace={selectedLinkedFace}
          locale={locale}
          placeholderLabel={t("previewConsentPanelPlaceholder")}
          goToConsentLabel={t("previewGoToConsent")}
          signedLabel={t("previewSignedLabel")}
          consentSummaryLabel={t("previewConsentSummaryLabel")}
          headshotLabel={t("previewHeadshotLabel")}
          noEmailLabel={t("previewNoEmail")}
          unknownValueLabel={t("previewUnknownValue")}
          activeLabel={t("previewStatusActive")}
          revokedLabel={t("previewStatusRevoked")}
          autoLinkLabel={t("previewLinkSourceAuto")}
          manualLinkLabel={t("previewLinkSourceManual")}
          removeLinkLabel={t("previewRemoveLink")}
          changePersonLabel={t("previewChangePerson")}
            changePersonCloseLabel={t("previewCloseChangePerson")}
            saveChangeLabel={t("previewSavePersonChange")}
            currentLabel={t("previewCurrentPerson")}
            linkedToFaceLabel={(face) => t("previewLinkedToFace", { face })}
            pickerLoadingLabel={t("previewPickerLoading")}
          pickerEmptyLabel={t("previewPickerEmpty")}
          removeLinkErrorLabel={t("previewRemovingLink")}
          changePersonErrorLabel={t("previewSavingPersonChange")}
          moveWarningLabel={(face) => t("previewMoveLinkedPersonWarning", { face })}
          hideFaceLabel={t("previewHideFace")}
          hideFaceBusyLabel={t("previewHidingFace")}
          isSaving={isSavingLink || isSavingHide}
          actionError={actionError}
          isChangePersonOpen={isChangePersonOpen}
          isLoadingCandidates={isLoadingCandidates}
          candidates={selectedLinkedFaceCandidates}
          selectedReplacementConsentId={selectedReplacementConsentId}
          onRemoveLink={() => {
            void handleRemoveLink();
          }}
          onHideFace={
            selectedLinkedFace
              ? () => {
                  void handleHideFace();
                }
              : null
          }
          onToggleChangePerson={() => {
            setActionError(null);
            setCandidateData(null);
            setSelectedReplacementConsentId(null);
            setIsChangePersonOpen((current) => !current);
          }}
          onSelectReplacement={(consentId) => {
            setSelectedReplacementConsentId(consentId);
            setActionError(null);
          }}
          onSaveChange={() => {
            void submitSelectedFaceLink();
          }}
        />
      }
      onClose={onClose}
      onPrevious={onPrevious}
      onNext={onNext}
      canPrevious={canPrevious}
      canNext={canNext}
      previousLabel={previousLabel}
      nextLabel={nextLabel}
      closeLabel={closeLabel}
      zoomInLabel={zoomInLabel}
      zoomOutLabel={zoomOutLabel}
      zoomResetLabel={zoomResetLabel}
      zoomInputLabel={zoomInputLabel}
      zoomInputHint={zoomInputHint}
      metadataLabel={metadataLabel}
      counterLabel={counterLabel}
      preloadSrcs={preloadSrcs}
    />
  );
}
