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
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
  displayName: string | null;
  email: string | null;
  ownerState: "active" | "revoked";
  consent: null | {
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
  recurring: null | {
    projectProfileParticipantId: string;
    profileId: string | null;
    recurringProfileConsentId: string | null;
    projectConsentState: "signed" | "revoked";
    signedAt: string | null;
    consentVersion: string | null;
    faceMatchOptIn: boolean | null;
    headshotThumbnailUrl: string | null;
    headshotPreviewUrl: string | null;
  };
};

type WholeAssetLinkPreview = {
  projectFaceAssigneeId: string;
  identityKind: "project_consent" | "project_recurring_consent";
  linkMode: "whole_asset";
  linkSource: "manual";
  matchConfidence: null;
  displayName: string | null;
  email: string | null;
  ownerState: "active" | "revoked";
  consent: LinkedFacePreview["consent"];
  recurring: LinkedFacePreview["recurring"];
};

type AssetPreviewFace = {
  assetFaceId: string;
  faceRank: number;
  faceSource: "detector" | "manual";
  faceBoxNormalized: Record<string, number | null> | null;
  faceThumbnailUrl: string | null;
  detectionProbability: number | null;
  faceState: "linked_manual" | "linked_auto" | "unlinked" | "hidden" | "blocked";
  hiddenAt: string | null;
  blockedAt: string | null;
  blockedReason: "no_consent" | null;
  currentLink: null | {
    projectFaceAssigneeId: string;
    identityKind: "project_consent" | "project_recurring_consent";
    consentId: string | null;
    projectProfileParticipantId: string | null;
    profileId: string | null;
    recurringProfileConsentId: string | null;
    linkSource: "manual" | "auto";
    matchConfidence: number | null;
    displayName: string | null;
    email: string | null;
    ownerState: "active" | "revoked";
    consent: LinkedFacePreview["consent"];
    recurring: LinkedFacePreview["recurring"];
  };
};

type AssetPreviewFacesResponse = {
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  activeLinkedFaceCount: number;
  wholeAssetLinkCount: number;
  hiddenFaceCount: number;
  wholeAssetLinks: WholeAssetLinkPreview[];
  faces: AssetPreviewFace[];
};

type AssetPreviewCandidate = {
  candidateKey: string;
  identityKind: "project_consent" | "recurring_profile_match";
  assignable: boolean;
  assignmentBlockedReason:
    | null
    | "project_consent_missing"
    | "project_consent_pending"
    | "project_consent_revoked";
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
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  projectConsentState: "missing" | "pending" | "signed" | "revoked" | null;
};

type AssetPreviewFaceCandidatesResponse = {
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  candidates: AssetPreviewCandidate[];
};

type AssetPreviewWholeAssetCandidate = {
  candidateKey: string;
  identityKind: "project_consent" | "recurring_profile_match";
  assignable: boolean;
  assignmentBlockedReason:
    | null
    | "project_consent_missing"
    | "project_consent_pending"
    | "project_consent_revoked";
  fullName: string | null;
  email: string | null;
  headshotThumbnailUrl: string | null;
  currentExactFaceLink: {
    assetFaceId: string;
    faceRank: number | null;
  } | null;
  currentWholeAssetLink: {
    projectFaceAssigneeId: string;
  } | null;
  consentId: string | null;
  projectProfileParticipantId: string | null;
  profileId: string | null;
  projectConsentState: "missing" | "pending" | "signed" | "revoked" | null;
};

type AssetPreviewWholeAssetCandidatesResponse = {
  assetId: string;
  candidates: AssetPreviewWholeAssetCandidate[];
};

type ManualAssetFaceCreateResponse = {
  ok: boolean;
  created: boolean;
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  faceRank: number;
  faceSource: "detector" | "manual";
  message?: string;
};

const MIN_MANUAL_FACE_BOX_SIZE = 0.02;

export type ProjectPhotoAssetPreviewLightboxProps = {
  projectId: string;
  asset: {
    id: string;
    assetType: "photo";
    originalFilename: string;
    previewUrl: string | null;
    thumbnailUrl: string | null;
    previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
    initialPreviewFaceOverlays: PreviewFaceOverlay[];
  };
  metadataLabel?: string | null;
  counterLabel?: string | null;
  preloadSrcs?: string[];
  initialSelectedFaceId?: string | null;
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

function buildOverlayId(assetFaceId: string, projectFaceAssigneeId?: string | null) {
  return projectFaceAssigneeId ? `${assetFaceId}:${projectFaceAssigneeId}` : assetFaceId;
}

function extractAssetFaceId(overlayId: string | null | undefined) {
  return String(overlayId ?? "").split(":")[0] ?? null;
}

function isManualFaceDraftSaveable(faceBoxNormalized: Record<string, number | null> | null) {
  if (!faceBoxNormalized) {
    return false;
  }

  const width = Number(faceBoxNormalized.x_max ?? 0) - Number(faceBoxNormalized.x_min ?? 0);
  const height = Number(faceBoxNormalized.y_max ?? 0) - Number(faceBoxNormalized.y_min ?? 0);
  return width >= MIN_MANUAL_FACE_BOX_SIZE && height >= MIN_MANUAL_FACE_BOX_SIZE;
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
    projectFaceAssigneeId: face.currentLink.projectFaceAssigneeId,
    identityKind: face.currentLink.identityKind,
    linkSource: face.currentLink.linkSource,
    matchConfidence: face.currentLink.matchConfidence,
    displayName: face.currentLink.displayName,
    email: face.currentLink.email,
    ownerState: face.currentLink.ownerState,
    consent:
      face.currentLink.consent && face.currentLink.consentId
        ? {
            ...face.currentLink.consent,
            consentId: face.currentLink.consentId,
          }
        : null,
    recurring: face.currentLink.recurring,
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

function getCandidateDisplayName(candidate: AssetPreviewCandidate, unknownPersonLabel: string) {
  return candidate.fullName || candidate.email || unknownPersonLabel;
}

function getWholeAssetCandidateDisplayName(
  candidate: AssetPreviewWholeAssetCandidate,
  unknownPersonLabel: string,
) {
  return candidate.fullName || candidate.email || unknownPersonLabel;
}

function getWholeAssetLinkDisplayName(link: WholeAssetLinkPreview, unknownPersonLabel: string) {
  return link.displayName || link.email || unknownPersonLabel;
}

function getCandidateIdentityLabel(
  candidate: AssetPreviewCandidate,
  consentIdentityLabel: string,
  recurringIdentityLabel: string,
) {
  return candidate.identityKind === "project_consent" ? consentIdentityLabel : recurringIdentityLabel;
}

function getCandidateBlockedReasonLabel(
  candidate: AssetPreviewCandidate,
  labels: {
    missing: string;
    pending: string;
    revoked: string;
  },
) {
  switch (candidate.assignmentBlockedReason) {
    case "project_consent_missing":
      return labels.missing;
    case "project_consent_pending":
      return labels.pending;
    case "project_consent_revoked":
      return labels.revoked;
    default:
      return null;
  }
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

function BlockFaceIcon({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="8" />
      <path d="m8.5 15.5 7-7" />
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
  unknownPersonLabel,
  unknownValueLabel,
  activeLabel,
  revokedLabel,
  consentIdentityLabel,
  recurringIdentityLabel,
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
  blockFaceLabel,
  blockFaceBusyLabel,
  isSaving,
  actionError,
  isChangePersonOpen,
  isLoadingCandidates,
  candidates,
  selectedReplacementCandidateKey,
  onRemoveLink,
  onHideFace,
  onBlockFace,
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
  unknownPersonLabel: string;
  unknownValueLabel: string;
  activeLabel: string;
  revokedLabel: string;
  consentIdentityLabel: string;
  recurringIdentityLabel: string;
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
  blockFaceLabel?: string;
  blockFaceBusyLabel?: string;
  isSaving: boolean;
  actionError: string | null;
  isChangePersonOpen: boolean;
  isLoadingCandidates: boolean;
  candidates: AssetPreviewCandidate[];
  selectedReplacementCandidateKey: string | null;
  onRemoveLink: () => void;
  onHideFace?: (() => void) | null;
  onBlockFace?: (() => void) | null;
  onToggleChangePerson: () => void;
  onSelectReplacement: (candidateKey: string) => void;
  onSaveChange: () => void;
}) {
  if (!linkedFace) {
    return (
      <div className="flex h-full min-h-[240px] items-center rounded-xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600">
        {placeholderLabel}
      </div>
    );
  }

  const displayName = linkedFace.displayName || linkedFace.email || unknownPersonLabel;
  const currentLinkedCandidateKey =
    linkedFace.identityKind === "project_consent" && linkedFace.consent?.consentId
      ? `consent:${linkedFace.consent.consentId}`
      : linkedFace.recurring?.projectProfileParticipantId
        ? `participant:${linkedFace.recurring.projectProfileParticipantId}`
        : null;
  const selectedReplacement =
    candidates.find((candidate) => candidate.candidateKey === selectedReplacementCandidateKey) ?? null;
  const movingExistingLink =
    selectedReplacement?.currentAssetLink &&
    selectedReplacement.currentAssetLink.assetFaceId !== linkedFace.assetFaceId
      ? selectedReplacement.currentAssetLink
      : null;
  const linkedFaceHeadshotThumbnailUrl =
    linkedFace.consent?.headshotThumbnailUrl ?? linkedFace.recurring?.headshotThumbnailUrl ?? null;
  const linkedFaceHeadshotPreviewUrl =
    linkedFace.consent?.headshotPreviewUrl ?? linkedFace.recurring?.headshotPreviewUrl ?? null;

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
              <p className="mt-1 truncate text-sm text-zinc-600">{linkedFace.email ?? noEmailLabel}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {linkedFace.ownerState === "revoked" ? revokedLabel : activeLabel}
                </span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {linkedFace.identityKind === "project_consent" ? consentIdentityLabel : recurringIdentityLabel}
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
                {(linkedFace.consent?.signedAt ?? linkedFace.recurring?.signedAt)
                  ? formatDate(linkedFace.consent?.signedAt ?? linkedFace.recurring?.signedAt ?? "", locale)
                  : unknownValueLabel}
              </p>
            </div>
          </div>

          {linkedFace.consent?.structuredSnapshotSummary?.length ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{consentSummaryLabel}</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-800">
                {linkedFace.consent.structuredSnapshotSummary.map((summary) => (
                  <li key={summary}>{summary}</li>
                ))}
            </ul>
          </div>
        ) : null}

          {linkedFaceHeadshotThumbnailUrl ? (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{headshotLabel}</p>
              <div className="mt-2 h-20 w-20 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                <PreviewableImage
                  src={linkedFaceHeadshotThumbnailUrl}
                  previewSrc={linkedFaceHeadshotPreviewUrl}
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
            {linkedFace.consent?.goToConsentHref ? (
              <a
                href={linkedFace.consent.goToConsentHref}
                className="inline-flex rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                {goToConsentLabel}
              </a>
            ) : null}
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
            {onBlockFace && blockFaceLabel && blockFaceBusyLabel ? (
              <button
                type="button"
                disabled={isSaving}
                onClick={onBlockFace}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {isSaving ? blockFaceBusyLabel : blockFaceLabel}
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
                      const candidateName = candidate.fullName || candidate.email || unknownPersonLabel;
                      const isCurrent = candidate.candidateKey === currentLinkedCandidateKey;
                      const isSelectedCandidate = candidate.candidateKey === selectedReplacementCandidateKey;

                      return (
                        <button
                          key={candidate.candidateKey}
                          type="button"
                          disabled={!candidate.assignable}
                          onClick={() => onSelectReplacement(candidate.candidateKey)}
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
                    selectedReplacement.candidateKey === currentLinkedCandidateKey ||
                    !selectedReplacement.assignable
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
  loadingLabel,
  unknownPersonLabel,
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
  loadingLabel: string;
  unknownPersonLabel: string;
  autoLinkLabel: string;
  manualLinkLabel: string;
}) {
  if (isLoading && linkedFaces.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-600">
        {loadingLabel}
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
    <div className="rounded-xl border border-zinc-200 bg-white p-2.5">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {linkedFaces.map((linkedFace) => {
          const displayName = linkedFace.displayName || linkedFace.email || unknownPersonLabel;
          const isHovered = hoveredLinkedFaceId === linkedFace.assetFaceId;
          const isSelected = selectedLinkedFaceId === linkedFace.assetFaceId;
          const thumbnailUrl =
            linkedFace.consent?.headshotThumbnailUrl
            ?? linkedFace.recurring?.headshotThumbnailUrl
            ?? linkedFace.faceThumbnailUrl
            ?? null;

          return (
            <button
              key={linkedFace.assetFaceId}
              type="button"
              onMouseEnter={() => onHoverChange(linkedFace.assetFaceId)}
              onMouseLeave={() => onHoverChange(null)}
              onFocus={() => onHoverChange(linkedFace.assetFaceId)}
              onBlur={() => onHoverChange(null)}
              onClick={() => onSelect(linkedFace.assetFaceId)}
              className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                isSelected || isHovered
                  ? getLinkToneClasses(linkedFace.linkSource, true)
                  : getLinkToneClasses(linkedFace.linkSource, false)
              }`}
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
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
                <span className="block truncate text-[13px] font-medium leading-5 text-zinc-900">{displayName}</span>
                <span className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-4 text-zinc-600">
                  <LinkSourceIcon
                    linkSource={linkedFace.linkSource}
                    className={`h-3 w-3 ${getLinkIconToneClass(linkedFace.linkSource)}`}
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

export function AssetPreviewWholeAssetStrip({
  wholeAssetLinks,
  selectedWholeAssetAssigneeId,
  isLoading,
  errorMessage,
  titleLabel,
  emptyLabel,
  loadingLabel,
  unknownPersonLabel,
  manualLinkLabel,
  onSelect,
}: {
  wholeAssetLinks: WholeAssetLinkPreview[];
  selectedWholeAssetAssigneeId: string | null;
  isLoading: boolean;
  errorMessage: string | null;
  titleLabel: string;
  emptyLabel: string;
  loadingLabel: string;
  unknownPersonLabel: string;
  manualLinkLabel: string;
  onSelect: (projectFaceAssigneeId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-zinc-900">{titleLabel}</p>
        {isLoading ? <span className="text-xs text-zinc-500">{loadingLabel}</span> : null}
      </div>

      {errorMessage && wholeAssetLinks.length === 0 ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {errorMessage}
        </div>
      ) : null}

      {wholeAssetLinks.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-600">{emptyLabel}</p>
      ) : (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {wholeAssetLinks.map((link) => {
            const displayName = getWholeAssetLinkDisplayName(link, unknownPersonLabel);
            const isSelected = selectedWholeAssetAssigneeId === link.projectFaceAssigneeId;
            const thumbnailUrl =
              link.consent?.headshotThumbnailUrl
              ?? link.recurring?.headshotThumbnailUrl
              ?? null;

            return (
              <button
                key={link.projectFaceAssigneeId}
                type="button"
                onClick={() => onSelect(link.projectFaceAssigneeId)}
                className={`flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  isSelected
                    ? "border-zinc-900 bg-zinc-50"
                    : "border-zinc-200 bg-white hover:border-zinc-300"
                }`}
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
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
                  <span className="block truncate text-[13px] font-medium leading-5 text-zinc-900">{displayName}</span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-zinc-600">{manualLinkLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function AssetPreviewWholeAssetPanel({
  locale,
  wholeAssetLink,
  isPickerOpen,
  isLoadingCandidates,
  candidates,
  selectedCandidateKey,
  unknownPersonLabel,
  placeholderLabel,
  pickerTitleLabel,
  pickerHelpLabel,
  pickerLoadingLabel,
  pickerEmptyLabel,
  signedLabel,
  noEmailLabel,
  unknownValueLabel,
  activeLabel,
  revokedLabel,
  consentIdentityLabel,
  recurringIdentityLabel,
  wholeAssetLabel,
  removeLinkLabel,
  removeLinkBusyLabel,
  changePersonLabel,
  changePersonCloseLabel,
  saveLabel,
  savingLabel,
  cancelLabel,
  exactFaceLinkedLabel,
  exactFaceConflictLabel,
  blockedReasonMissingLabel,
  blockedReasonPendingLabel,
  blockedReasonRevokedLabel,
  openPreviewLabel,
  actionError,
  isSaving,
  onTogglePicker,
  onSelectCandidate,
  onSave,
  onRemoveLink,
  onCancelPicker,
}: {
  locale: string;
  wholeAssetLink: WholeAssetLinkPreview | null;
  isPickerOpen: boolean;
  isLoadingCandidates: boolean;
  candidates: AssetPreviewWholeAssetCandidate[];
  selectedCandidateKey: string | null;
  unknownPersonLabel: string;
  placeholderLabel: string;
  pickerTitleLabel: string;
  pickerHelpLabel: string;
  pickerLoadingLabel: string;
  pickerEmptyLabel: string;
  signedLabel: string;
  noEmailLabel: string;
  unknownValueLabel: string;
  activeLabel: string;
  revokedLabel: string;
  consentIdentityLabel: string;
  recurringIdentityLabel: string;
  wholeAssetLabel: string;
  removeLinkLabel: string;
  removeLinkBusyLabel: string;
  changePersonLabel: string;
  changePersonCloseLabel: string;
  saveLabel: string;
  savingLabel: string;
  cancelLabel: string;
  exactFaceLinkedLabel: (face: number) => string;
  exactFaceConflictLabel: string;
  blockedReasonMissingLabel: string;
  blockedReasonPendingLabel: string;
  blockedReasonRevokedLabel: string;
  openPreviewLabel: (name: string) => string;
  actionError: string | null;
  isSaving: boolean;
  onTogglePicker: () => void;
  onSelectCandidate: (candidateKey: string) => void;
  onSave: () => void;
  onRemoveLink: () => void;
  onCancelPicker: () => void;
}) {
  const [previewCandidate, setPreviewCandidate] = useState<AssetPreviewWholeAssetCandidate | null>(null);
  const displayName = wholeAssetLink ? getWholeAssetLinkDisplayName(wholeAssetLink, unknownPersonLabel) : null;
  const thumbnailUrl =
    wholeAssetLink?.consent?.headshotThumbnailUrl
    ?? wholeAssetLink?.recurring?.headshotThumbnailUrl
    ?? null;
  const previewUrl =
    wholeAssetLink?.consent?.headshotPreviewUrl
    ?? wholeAssetLink?.recurring?.headshotPreviewUrl
    ?? null;

  return (
    <div className="h-full rounded-xl border border-zinc-200 bg-white p-4">
      {wholeAssetLink ? (
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <span className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
              {thumbnailUrl ? (
                <span
                  aria-hidden="true"
                  className="h-full w-full bg-cover bg-center"
                  style={{ backgroundImage: `url("${thumbnailUrl}")` }}
                />
              ) : (
                <span className="text-sm font-semibold text-zinc-700">
                  {getPersonInitials(displayName ?? unknownPersonLabel)}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-zinc-900">{displayName}</p>
              <p className="mt-1 truncate text-sm text-zinc-600">{wholeAssetLink.email ?? noEmailLabel}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {wholeAssetLink.ownerState === "revoked" ? revokedLabel : activeLabel}
                </span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {wholeAssetLink.identityKind === "project_consent" ? consentIdentityLabel : recurringIdentityLabel}
                </span>
                <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-zinc-700">
                  {wholeAssetLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <p className="text-xs text-zinc-500">{signedLabel}</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">
                {(wholeAssetLink.consent?.signedAt ?? wholeAssetLink.recurring?.signedAt)
                  ? formatDate(wholeAssetLink.consent?.signedAt ?? wholeAssetLink.recurring?.signedAt ?? "", locale)
                  : unknownValueLabel}
              </p>
            </div>
            {thumbnailUrl ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-xs text-zinc-500">{wholeAssetLabel}</p>
                <div className="mt-2 h-20 w-20 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                  <PreviewableImage
                    src={thumbnailUrl}
                    previewSrc={previewUrl}
                    alt={displayName ?? unknownPersonLabel}
                    className="h-full w-full"
                    imageClassName="h-full w-full object-cover"
                    previewImageClassName="object-contain"
                    lightboxChrome="floating"
                  />
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isSaving}
              onClick={onRemoveLink}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              {isSaving ? removeLinkBusyLabel : removeLinkLabel}
            </button>
            <button
              type="button"
              disabled={isSaving}
              onClick={onTogglePicker}
              className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {isPickerOpen ? changePersonCloseLabel : changePersonLabel}
            </button>
          </div>
        </div>
      ) : !isPickerOpen ? (
        <div className="flex h-full min-h-[240px] items-center rounded-xl border border-zinc-200 bg-white px-5 py-4 text-sm text-zinc-600">
          {placeholderLabel}
        </div>
      ) : null}

      {actionError ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      {isPickerOpen ? (
        <div className={`${wholeAssetLink ? "mt-4" : ""} rounded-lg border border-zinc-200 bg-zinc-50 p-3`}>
          <div className="space-y-1">
            <p className="text-sm font-semibold text-zinc-900">{pickerTitleLabel}</p>
            <p className="text-sm text-zinc-600">{pickerHelpLabel}</p>
          </div>

          <div className="mt-3 space-y-3">
            {isLoadingCandidates ? (
              <p className="text-sm text-zinc-600">{pickerLoadingLabel}</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-zinc-600">{pickerEmptyLabel}</p>
            ) : (
              <div className="max-h-80 space-y-2 overflow-y-auto">
                {candidates.map((candidate) => {
                  const candidateName = getWholeAssetCandidateDisplayName(candidate, unknownPersonLabel);
                  const isSelected = candidate.candidateKey === selectedCandidateKey;
                  const blockedReasonLabel = getCandidateBlockedReasonLabel(candidate, {
                    missing: blockedReasonMissingLabel,
                    pending: blockedReasonPendingLabel,
                    revoked: blockedReasonRevokedLabel,
                  });

                  return (
                    <div
                      key={candidate.candidateKey}
                      onClick={() => {
                        if (!candidate.assignable) {
                          return;
                        }
                        onSelectCandidate(candidate.candidateKey);
                      }}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") {
                          return;
                        }
                        event.preventDefault();
                        if (!candidate.assignable) {
                          return;
                        }
                        onSelectCandidate(candidate.candidateKey);
                      }}
                      role="button"
                      tabIndex={candidate.assignable ? 0 : -1}
                      aria-pressed={isSelected}
                      className={`w-full rounded-lg border px-2 py-2 text-left ${
                        isSelected
                          ? "border-zinc-900 bg-white"
                          : !candidate.assignable
                            ? "border-zinc-200 bg-zinc-50 text-zinc-500 opacity-70"
                            : "border-zinc-200 bg-white hover:border-zinc-300"
                      }`}
                    >
                      <span className="flex items-start gap-3">
                        {candidate.headshotThumbnailUrl ? (
                          <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                            <span
                              aria-hidden="true"
                              className="block h-full w-full bg-cover bg-center"
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
                              aria-label={openPreviewLabel(candidateName)}
                              title={openPreviewLabel(candidateName)}
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
                          <span className="block truncate text-sm font-medium text-zinc-900">{candidateName}</span>
                          <span className="mt-1 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700">
                            {getCandidateIdentityLabel(candidate, consentIdentityLabel, recurringIdentityLabel)}
                          </span>
                          {candidate.currentExactFaceLink ? (
                            <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                              {exactFaceLinkedLabel((candidate.currentExactFaceLink.faceRank ?? 0) + 1)}
                            </span>
                          ) : null}
                          {candidate.currentWholeAssetLink ? (
                            <span className="mt-2 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-700">
                              {wholeAssetLabel}
                            </span>
                          ) : null}
                          {blockedReasonLabel ? (
                            <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                              {blockedReasonLabel}
                            </span>
                          ) : null}
                          {candidate.currentExactFaceLink ? (
                            <span className="mt-2 block text-xs text-zinc-500">{exactFaceConflictLabel}</span>
                          ) : null}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isSaving || !selectedCandidateKey}
                onClick={onSave}
                className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {isSaving ? savingLabel : saveLabel}
              </button>
              <button
                type="button"
                disabled={isSaving}
                onClick={onCancelPicker}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                {cancelLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {previewCandidate?.headshotThumbnailUrl ? (
        <ImagePreviewLightbox
          open
          src={previewCandidate.headshotThumbnailUrl}
          alt={getWholeAssetCandidateDisplayName(previewCandidate, unknownPersonLabel)}
          previewImageClassName="object-contain"
          chrome="floating"
          onClose={() => setPreviewCandidate(null)}
        />
      ) : null}
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

function AssetPreviewSceneActions({
  hiddenFaceCount,
  showHiddenFaces,
  onShowHiddenFacesChange,
  isAddPersonMenuOpen,
  onToggleAddPersonMenu,
  onStartSelectFace,
  onStartLinkEntireAsset,
  isDrawMode,
  isDraftSaveable,
  isSavingManualFace,
  onCancelDraw,
  onSaveDraw,
  showHiddenLabel,
  addPersonLabel,
  selectFaceLabel,
  linkEntireAssetLabel,
  drawModeHelpLabel,
  cancelLabel,
  saveLabel,
  savingLabel,
}: {
  hiddenFaceCount: number;
  showHiddenFaces: boolean;
  onShowHiddenFacesChange: (checked: boolean) => void;
  isAddPersonMenuOpen: boolean;
  onToggleAddPersonMenu: () => void;
  onStartSelectFace: () => void;
  onStartLinkEntireAsset: () => void;
  isDrawMode: boolean;
  isDraftSaveable: boolean;
  isSavingManualFace: boolean;
  onCancelDraw: () => void;
  onSaveDraw: () => void;
  showHiddenLabel: (count: number) => string;
  addPersonLabel: string;
  selectFaceLabel: string;
  linkEntireAssetLabel: string;
  drawModeHelpLabel: string;
  cancelLabel: string;
  saveLabel: string;
  savingLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <AssetPreviewShowHiddenToggle
        hiddenFaceCount={hiddenFaceCount}
        checked={showHiddenFaces}
        onChange={onShowHiddenFacesChange}
        label={showHiddenLabel}
      />

      <div className="relative">
        <button
          type="button"
          disabled={isDrawMode}
          onClick={onToggleAddPersonMenu}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {addPersonLabel}
        </button>
        {isAddPersonMenuOpen && !isDrawMode ? (
          <div className="absolute left-0 top-full z-30 mt-2 min-w-[15rem] rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
            <button
              type="button"
              onClick={onStartSelectFace}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50"
            >
              {selectFaceLabel}
            </button>
            <button
              type="button"
              onClick={onStartLinkEntireAsset}
              className="block w-full rounded-md px-3 py-2 text-left text-sm text-zinc-900 hover:bg-zinc-50"
            >
              {linkEntireAssetLabel}
            </button>
          </div>
        ) : null}
      </div>

      {isDrawMode ? (
        <>
          <span className="text-sm text-zinc-600">{drawModeHelpLabel}</span>
          <button
            type="button"
            disabled={isSavingManualFace}
            onClick={onCancelDraw}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={!isDraftSaveable || isSavingManualFace}
            onClick={onSaveDraw}
            className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {isSavingManualFace ? savingLabel : saveLabel}
          </button>
        </>
      ) : null}
    </div>
  );
}

function AssetPreviewUnlinkedFaceTray({
  candidates,
  isLoadingCandidates,
  selectedCandidateKey,
  onSelectCandidate,
  onSave,
  onHide,
  onBlock,
  onClose,
  isSavingLink,
  isSavingHide,
  isSavingBlock,
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
  blockLabel,
  blockingLabel,
  linkedToFaceLabel,
  moveWarningLabel,
  confirmMoveLabel,
  cancelLabel,
  autoLabel,
  consentIdentityLabel,
  recurringIdentityLabel,
  unknownPersonLabel,
  blockedReasonMissingLabel,
  blockedReasonPendingLabel,
  blockedReasonRevokedLabel,
  openPreviewLabel,
}: {
  candidates: AssetPreviewCandidate[];
  isLoadingCandidates: boolean;
  selectedCandidateKey: string | null;
  onSelectCandidate: (candidateKey: string) => void;
  onSave: () => void;
  onHide: () => void;
  onBlock: () => void;
  onClose: () => void;
  isSavingLink: boolean;
  isSavingHide: boolean;
  isSavingBlock: boolean;
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
  blockLabel: string;
  blockingLabel: string;
  linkedToFaceLabel: (face: number) => string;
  moveWarningLabel: (face: number) => string;
  confirmMoveLabel: string;
  cancelLabel: string;
  autoLabel: string;
  consentIdentityLabel: string;
  recurringIdentityLabel: string;
  unknownPersonLabel: string;
  blockedReasonMissingLabel: string;
  blockedReasonPendingLabel: string;
  blockedReasonRevokedLabel: string;
  openPreviewLabel: (name: string) => string;
}) {
  const [previewCandidate, setPreviewCandidate] = useState<AssetPreviewCandidate | null>(null);
  const [confirmMoveCandidateKey, setConfirmMoveCandidateKey] = useState<string | null>(null);

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
              const candidateName = getCandidateDisplayName(candidate, unknownPersonLabel);
              const isSelected = candidate.candidateKey === selectedCandidateKey;
              const isLinkedElsewhere =
                Boolean(candidate.currentAssetLink) &&
                candidate.currentAssetLink?.assetFaceId !== null;
              const isAwaitingMoveConfirm = confirmMoveCandidateKey === candidate.candidateKey;
              const blockedReasonLabel = getCandidateBlockedReasonLabel(candidate, {
                missing: blockedReasonMissingLabel,
                pending: blockedReasonPendingLabel,
                revoked: blockedReasonRevokedLabel,
              });

              return (
                <div
                  key={candidate.candidateKey}
                  onClick={() => {
                    if (!candidate.assignable) {
                      return;
                    }
                    if (isLinkedElsewhere && !isAwaitingMoveConfirm) {
                      setConfirmMoveCandidateKey(candidate.candidateKey);
                      return;
                    }

                    setConfirmMoveCandidateKey(null);
                    onSelectCandidate(candidate.candidateKey);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      if (!candidate.assignable) {
                        return;
                      }
                      if (isLinkedElsewhere && !isAwaitingMoveConfirm) {
                        setConfirmMoveCandidateKey(candidate.candidateKey);
                        return;
                      }

                      setConfirmMoveCandidateKey(null);
                      onSelectCandidate(candidate.candidateKey);
                    }
                  }}
                  role="button"
                  tabIndex={candidate.assignable ? 0 : -1}
                  aria-pressed={isSelected}
                  className={`w-full rounded-lg border px-2 py-2 text-left ${
                    isSelected
                      ? "border-zinc-900 bg-zinc-50"
                      : !candidate.assignable
                        ? "border-zinc-200 bg-zinc-50 text-zinc-500 opacity-70"
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
                          aria-label={openPreviewLabel(candidateName)}
                          title={openPreviewLabel(candidateName)}
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
                        <span className="mt-1 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700">
                          {getCandidateIdentityLabel(candidate, consentIdentityLabel, recurringIdentityLabel)}
                        </span>
                      <span className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                        <AutoCandidateIcon className="h-3.5 w-3.5 text-zinc-700" />
                        <span>{autoLabel}</span>
                        {typeof candidate.similarityScore === "number" ? (
                          <span>{Math.round(candidate.similarityScore * 100)}%</span>
                        ) : null}
                      </span>
                      {blockedReasonLabel ? (
                        <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                          {blockedReasonLabel}
                        </span>
                      ) : null}
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
                                setConfirmMoveCandidateKey(null);
                                onSelectCandidate(candidate.candidateKey);
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
                                setConfirmMoveCandidateKey(null);
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
            disabled={isSavingLink || isSavingHide || isSavingBlock || !selectedCandidateKey}
            onClick={onSave}
            className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
          >
            {isSavingLink ? savingLabel : saveLabel}
          </button>
          {isConfirmingHide ? (
            <button
              type="button"
              disabled={isSavingLink || isSavingHide || isSavingBlock}
              onClick={onHide}
              className="rounded-lg border border-red-700 bg-red-700 px-3 py-2 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-60"
            >
              {isSavingHide ? hidingLabel : hideLabel}
            </button>
          ) : (
            <button
              type="button"
              disabled={isSavingLink || isSavingHide || isSavingBlock}
              onClick={onToggleHideConfirm}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              aria-label={hideLabel}
              title={hideLabel}
            >
              <HideFaceIcon />
            </button>
          )}
          <button
            type="button"
            disabled={isSavingLink || isSavingHide || isSavingBlock}
            onClick={onBlock}
            className="rounded-lg border border-red-300 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
          >
            {isSavingBlock ? blockingLabel : blockLabel}
          </button>
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
          alt={getCandidateDisplayName(previewCandidate, unknownPersonLabel)}
          previewImageClassName="object-contain"
          chrome="floating"
          onClose={() => setPreviewCandidate(null)}
        />
      ) : null}
    </div>
  );
}

function AssetPreviewBlockedFaceTray({
  selectedFace,
  candidates,
  isAssignPersonOpen,
  isLoadingCandidates,
  selectedCandidateKey,
  onToggleAssignPerson,
  onSelectCandidate,
  onSave,
  onClearBlock,
  isSavingLink,
  isClearingBlock,
  actionError,
  titleLabel,
  descriptionLabel,
  assignPersonLabel,
  closeAssignPersonLabel,
  pickerLoadingLabel,
  pickerEmptyLabel,
  saveLabel,
  savingLabel,
  clearBlockedLabel,
  clearingBlockedLabel,
  linkedToFaceLabel,
  moveWarningLabel,
  confirmMoveLabel,
  cancelLabel,
  autoLabel,
  consentIdentityLabel,
  recurringIdentityLabel,
  unknownPersonLabel,
  blockedReasonMissingLabel,
  blockedReasonPendingLabel,
  blockedReasonRevokedLabel,
  openPreviewLabel,
}: {
  selectedFace: AssetPreviewFace;
  candidates: AssetPreviewCandidate[];
  isAssignPersonOpen: boolean;
  isLoadingCandidates: boolean;
  selectedCandidateKey: string | null;
  onToggleAssignPerson: () => void;
  onSelectCandidate: (candidateKey: string) => void;
  onSave: () => void;
  onClearBlock: () => void;
  isSavingLink: boolean;
  isClearingBlock: boolean;
  actionError: string | null;
  titleLabel: (face: number) => string;
  descriptionLabel: string;
  assignPersonLabel: string;
  closeAssignPersonLabel: string;
  pickerLoadingLabel: string;
  pickerEmptyLabel: string;
  saveLabel: string;
  savingLabel: string;
  clearBlockedLabel: string;
  clearingBlockedLabel: string;
  linkedToFaceLabel: (face: number) => string;
  moveWarningLabel: (face: number) => string;
  confirmMoveLabel: string;
  cancelLabel: string;
  autoLabel: string;
  consentIdentityLabel: string;
  recurringIdentityLabel: string;
  unknownPersonLabel: string;
  blockedReasonMissingLabel: string;
  blockedReasonPendingLabel: string;
  blockedReasonRevokedLabel: string;
  openPreviewLabel: (name: string) => string;
}) {
  const [previewCandidate, setPreviewCandidate] = useState<AssetPreviewCandidate | null>(null);
  const [confirmMoveCandidateKey, setConfirmMoveCandidateKey] = useState<string | null>(null);
  const isSaving = isSavingLink || isClearingBlock;

  return (
    <div className="rounded-xl border border-red-200 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-zinc-900">{titleLabel(selectedFace.faceRank + 1)}</p>
          <p className="mt-1 text-sm text-zinc-600">{descriptionLabel}</p>
        </div>
        <div className="grid h-14 w-14 place-items-center overflow-hidden rounded-lg border border-red-200 bg-red-50 text-red-700">
          {selectedFace.faceThumbnailUrl ? (
            <span
              aria-hidden="true"
              className="block h-full w-full bg-cover bg-center"
              style={{ backgroundImage: `url("${selectedFace.faceThumbnailUrl}")` }}
            />
          ) : (
            <BlockFaceIcon />
          )}
        </div>
      </div>

      {actionError ? (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {actionError}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={isSaving}
          onClick={onToggleAssignPerson}
          className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
        >
          {isAssignPersonOpen ? closeAssignPersonLabel : assignPersonLabel}
        </button>
        <button
          type="button"
          disabled={isSaving}
          onClick={onClearBlock}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
        >
          {isClearingBlock ? clearingBlockedLabel : clearBlockedLabel}
        </button>
      </div>

      {isAssignPersonOpen ? (
        <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
          <div className="space-y-3">
            {isLoadingCandidates ? (
              <p className="text-sm text-zinc-600">{pickerLoadingLabel}</p>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-zinc-600">{pickerEmptyLabel}</p>
            ) : (
              <div className="max-h-72 space-y-2 overflow-y-auto">
                {candidates.map((candidate) => {
                  const candidateName = getCandidateDisplayName(candidate, unknownPersonLabel);
                  const isSelected = candidate.candidateKey === selectedCandidateKey;
                  const isLinkedElsewhere =
                    Boolean(candidate.currentAssetLink) &&
                    candidate.currentAssetLink?.assetFaceId !== selectedFace.assetFaceId;
                  const isAwaitingMoveConfirm = confirmMoveCandidateKey === candidate.candidateKey;
                  const blockedReasonLabel = getCandidateBlockedReasonLabel(candidate, {
                    missing: blockedReasonMissingLabel,
                    pending: blockedReasonPendingLabel,
                    revoked: blockedReasonRevokedLabel,
                  });

                  return (
                    <div
                      key={candidate.candidateKey}
                      onClick={() => {
                        if (!candidate.assignable) {
                          return;
                        }
                        if (isLinkedElsewhere && !isAwaitingMoveConfirm) {
                          setConfirmMoveCandidateKey(candidate.candidateKey);
                          return;
                        }

                        setConfirmMoveCandidateKey(null);
                        onSelectCandidate(candidate.candidateKey);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          if (!candidate.assignable) {
                            return;
                          }
                          if (isLinkedElsewhere && !isAwaitingMoveConfirm) {
                            setConfirmMoveCandidateKey(candidate.candidateKey);
                            return;
                          }

                          setConfirmMoveCandidateKey(null);
                          onSelectCandidate(candidate.candidateKey);
                        }
                      }}
                      role="button"
                      tabIndex={candidate.assignable ? 0 : -1}
                      aria-pressed={isSelected}
                      className={`w-full rounded-lg border px-2 py-2 text-left ${
                        isSelected
                          ? "border-zinc-900 bg-white"
                          : !candidate.assignable
                            ? "border-zinc-200 bg-zinc-50 text-zinc-500 opacity-70"
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
                              aria-label={openPreviewLabel(candidateName)}
                              title={openPreviewLabel(candidateName)}
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
                          <span className="mt-1 inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-700">
                            {getCandidateIdentityLabel(candidate, consentIdentityLabel, recurringIdentityLabel)}
                          </span>
                          <span className="mt-1 flex items-center gap-1 text-xs text-zinc-500">
                            <AutoCandidateIcon className="h-3.5 w-3.5 text-zinc-700" />
                            <span>{autoLabel}</span>
                            {typeof candidate.similarityScore === "number" ? (
                              <span>{Math.round(candidate.similarityScore * 100)}%</span>
                            ) : null}
                          </span>
                          {blockedReasonLabel ? (
                            <span className="mt-2 block rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">
                              {blockedReasonLabel}
                            </span>
                          ) : null}
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
                                    setConfirmMoveCandidateKey(null);
                                    onSelectCandidate(candidate.candidateKey);
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
                                    setConfirmMoveCandidateKey(null);
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

            <button
              type="button"
              disabled={isSaving || !selectedCandidateKey}
              onClick={onSave}
              className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {isSavingLink ? savingLabel : saveLabel}
            </button>
          </div>
        </div>
      ) : null}

      {previewCandidate?.headshotThumbnailUrl ? (
        <ImagePreviewLightbox
          open
          src={previewCandidate.headshotThumbnailUrl}
          alt={getCandidateDisplayName(previewCandidate, unknownPersonLabel)}
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

export function ProjectPhotoAssetPreviewLightbox({
  projectId,
  asset,
  metadataLabel = null,
  counterLabel = null,
  preloadSrcs = [],
  initialSelectedFaceId = null,
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
}: ProjectPhotoAssetPreviewLightboxProps) {
  const locale = useLocale();
  const t = useTranslations("projects.assetsList");
  const [previewData, setPreviewData] = useState<AssetPreviewFacesResponse | null>(null);
  const [candidateData, setCandidateData] = useState<AssetPreviewFaceCandidatesResponse | null>(null);
  const [wholeAssetCandidateData, setWholeAssetCandidateData] =
    useState<AssetPreviewWholeAssetCandidatesResponse | null>(null);
  const [isLoadingPreviewData, setIsLoadingPreviewData] = useState(false);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isLoadingWholeAssetCandidates, setIsLoadingWholeAssetCandidates] = useState(false);
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [isSavingWholeAssetLink, setIsSavingWholeAssetLink] = useState(false);
  const [isSavingHide, setIsSavingHide] = useState(false);
  const [isSavingRestore, setIsSavingRestore] = useState(false);
  const [isSavingBlock, setIsSavingBlock] = useState(false);
  const [isClearingBlock, setIsClearingBlock] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [hoveredFaceId, setHoveredFaceId] = useState<string | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [selectedWholeAssetAssigneeId, setSelectedWholeAssetAssigneeId] = useState<string | null>(null);
  const [isChangePersonOpen, setIsChangePersonOpen] = useState(false);
  const [selectedReplacementCandidateKey, setSelectedReplacementCandidateKey] = useState<string | null>(null);
  const [isWholeAssetPickerOpen, setIsWholeAssetPickerOpen] = useState(false);
  const [selectedWholeAssetCandidateKey, setSelectedWholeAssetCandidateKey] = useState<string | null>(null);
  const [showHiddenFaces, setShowHiddenFaces] = useState(false);
  const [isConfirmingHideFace, setIsConfirmingHideFace] = useState(false);
  const [isAddPersonMenuOpen, setIsAddPersonMenuOpen] = useState(false);
  const [isDrawFaceMode, setIsDrawFaceMode] = useState(false);
  const [draftManualFaceBox, setDraftManualFaceBox] = useState<Record<string, number | null> | null>(null);
  const [isSavingManualFace, setIsSavingManualFace] = useState(false);
  const unknownPersonLabel = t("previewUnknownPerson");

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
        return null;
      }

      setPreviewData(payload);
      setPreviewError(null);
      return payload;
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return null;
      }

      setPreviewError(t("previewLoadError"));
      setPreviewData(null);
      return null;
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

  const loadWholeAssetCandidateData = useCallback(async () => {
    setIsLoadingWholeAssetCandidates(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/whole-asset-candidates`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | (AssetPreviewWholeAssetCandidatesResponse & { message?: string })
        | null;

      if (!response.ok || !payload) {
        setActionError(payload?.message ?? t("previewWholeAssetCandidateLoadError"));
        setWholeAssetCandidateData(null);
        return;
      }

      setWholeAssetCandidateData(payload);
      setActionError(null);
    } catch {
      setActionError(t("previewWholeAssetCandidateLoadError"));
      setWholeAssetCandidateData(null);
    } finally {
      setIsLoadingWholeAssetCandidates(false);
    }
  }, [asset.id, projectId, t]);

  useEffect(() => {
    if (!open) {
      setHoveredFaceId(null);
      setSelectedFaceId(null);
      setSelectedWholeAssetAssigneeId(null);
      setShowHiddenFaces(false);
      setIsConfirmingHideFace(false);
      setIsAddPersonMenuOpen(false);
      setIsDrawFaceMode(false);
      setDraftManualFaceBox(null);
      setWholeAssetCandidateData(null);
      setIsWholeAssetPickerOpen(false);
      setSelectedWholeAssetCandidateKey(null);
      setIsSavingBlock(false);
      setIsClearingBlock(false);
      return;
    }

    setPreviewData(null);
    setCandidateData(null);
    setPreviewError(null);
    setActionError(null);
    setHoveredFaceId(null);
    setSelectedFaceId(initialSelectedFaceId ?? null);
    setSelectedWholeAssetAssigneeId(null);
    setIsChangePersonOpen(false);
    setSelectedReplacementCandidateKey(null);
    setWholeAssetCandidateData(null);
    setIsWholeAssetPickerOpen(false);
    setSelectedWholeAssetCandidateKey(null);
    setShowHiddenFaces(false);
    setIsConfirmingHideFace(false);
    setIsAddPersonMenuOpen(false);
    setIsDrawFaceMode(false);
    setDraftManualFaceBox(null);
    setIsSavingBlock(false);
    setIsClearingBlock(false);

    const controller = new AbortController();

    void loadPreviewData(controller.signal);

    return () => controller.abort();
  }, [asset.id, initialSelectedFaceId, loadPreviewData, open]);

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
  const wholeAssetLinks = useMemo(() => previewData?.wholeAssetLinks ?? [], [previewData]);
  const selectedFace = allFaces.find((face) => face.assetFaceId === selectedFaceId) ?? null;
  const selectedLinkedFace = toLinkedFacePreview(selectedFace);
  const selectedWholeAssetLink =
    wholeAssetLinks.find((link) => link.projectFaceAssigneeId === selectedWholeAssetAssigneeId) ?? null;
  const selectedFaceCandidates =
    selectedFace && candidateData?.assetFaceId === selectedFace.assetFaceId ? candidateData.candidates : [];
  const selectedLinkedFaceCandidates =
    selectedLinkedFace && candidateData?.assetFaceId === selectedLinkedFace.assetFaceId ? candidateData.candidates : [];
  const wholeAssetCandidates = wholeAssetCandidateData?.candidates ?? [];
  const selectedWholeAssetCandidate =
    selectedWholeAssetCandidateKey
      ? wholeAssetCandidates.find((candidate) => candidate.candidateKey === selectedWholeAssetCandidateKey) ?? null
      : null;
  const selectedFacePreviewCandidate =
    (selectedFace?.faceState === "unlinked" || selectedFace?.faceState === "blocked") &&
    selectedReplacementCandidateKey &&
    candidateData?.assetFaceId === selectedFace.assetFaceId
      ? candidateData.candidates.find((candidate) => candidate.candidateKey === selectedReplacementCandidateKey) ?? null
      : null;
  const isDraftManualFaceSaveable = isManualFaceDraftSaveable(draftManualFaceBox);

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
                ? selectedFacePreviewCandidate.candidateKey
                : face.currentLink?.projectFaceAssigneeId,
            ),
            href:
              !isSelectedUnlinkedPreview && face.currentLink?.consent?.goToConsentHref
                ? face.currentLink.consent.goToConsentHref
                : "#",
            label:
              isSelectedUnlinkedPreview
                ? selectedFacePreviewCandidate.fullName ||
                  selectedFacePreviewCandidate.email ||
                  unknownPersonLabel
                : face.currentLink?.displayName ||
                  face.currentLink?.email ||
                  (face.faceState === "blocked"
                    ? t("previewBlockedFaceLabel", { face: face.faceRank + 1 })
                    : t("previewDetectedFaceLabel", { face: face.faceRank + 1 })),
            faceBoxNormalized: face.faceBoxNormalized!,
            headshotThumbnailUrl:
              isSelectedUnlinkedPreview
                ? selectedFacePreviewCandidate.headshotThumbnailUrl ?? null
                : face.currentLink?.consent?.headshotThumbnailUrl
                  ?? face.currentLink?.recurring?.headshotThumbnailUrl
                  ?? null,
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
                  : face.faceState === "blocked"
                    ? t("previewFaceStateBlocked")
                  : face.faceState === "hidden"
                    ? t("previewFaceStateHidden")
                    : t("previewFaceStateDetected"),
            tone:
              face.faceState === "linked_manual"
                ? "manual"
                : face.faceState === "linked_auto"
                  ? "auto"
                  : face.faceState === "blocked"
                    ? "blocked"
                  : face.faceState === "hidden"
                    ? "hidden"
                    : "unlinked",
            metaLabel:
              isSelectedUnlinkedPreview && face.faceState !== "blocked"
                ? t("previewFaceStateDetected")
                : face.faceState === "linked_manual"
                  ? t("previewLinkSourceManual")
                  : face.faceState === "linked_auto"
                    ? t("previewLinkSourceAuto")
                    : face.faceState === "blocked"
                      ? t("previewFaceStateBlocked")
                    : face.faceState === "hidden"
                      ? t("previewFaceStateHidden")
                      : t("previewFaceStateDetected"),
          };
        }) satisfies PreviewFaceOverlay[];
    }

    return asset.initialPreviewFaceOverlays;
  }, [
    asset.initialPreviewFaceOverlays,
    previewData,
    selectedFace?.assetFaceId,
    selectedFacePreviewCandidate,
    t,
    unknownPersonLabel,
    visibleFaces,
  ]);

  const selectedOverlayId = useMemo(() => {
    if (isDrawFaceMode || !selectedFaceId) {
      return null;
    }

    return previewFaceOverlays.find((overlay) => extractAssetFaceId(overlay.id) === selectedFaceId)?.id ?? null;
  }, [isDrawFaceMode, previewFaceOverlays, selectedFaceId]);

  useEffect(() => {
    if (!selectedFaceId) {
      return;
    }

    if (!allFaces.some((face) => face.assetFaceId === selectedFaceId)) {
      setSelectedFaceId(null);
      setIsChangePersonOpen(false);
      setSelectedReplacementCandidateKey(null);
      setCandidateData(null);
      setIsConfirmingHideFace(false);
      setIsSavingBlock(false);
      setIsClearingBlock(false);
    }
  }, [allFaces, selectedFaceId]);

  useEffect(() => {
    if (!selectedWholeAssetAssigneeId) {
      return;
    }

    if (!wholeAssetLinks.some((link) => link.projectFaceAssigneeId === selectedWholeAssetAssigneeId)) {
      setSelectedWholeAssetAssigneeId(null);
      setIsWholeAssetPickerOpen(false);
      setSelectedWholeAssetCandidateKey(null);
    }
  }, [selectedWholeAssetAssigneeId, wholeAssetLinks]);

  useEffect(() => {
    if (!showHiddenFaces && selectedFace?.faceState === "hidden") {
      setSelectedFaceId(null);
      setCandidateData(null);
      setSelectedReplacementCandidateKey(null);
      setIsConfirmingHideFace(false);
      setIsSavingBlock(false);
      setIsClearingBlock(false);
    }
  }, [selectedFace, showHiddenFaces]);

  useEffect(() => {
    if (isDrawFaceMode) {
      setCandidateData(null);
      setSelectedReplacementCandidateKey(null);
      setIsConfirmingHideFace(false);
      return;
    }

    if (!selectedFace) {
      setCandidateData(null);
      setSelectedReplacementCandidateKey(null);
      setIsConfirmingHideFace(false);
      return;
    }

    const shouldLoadCandidates =
      selectedFace.faceState === "unlinked" ||
      (selectedFace.faceState === "blocked" && isChangePersonOpen) ||
      ((selectedFace.faceState === "linked_manual" || selectedFace.faceState === "linked_auto") && isChangePersonOpen);

    if (!shouldLoadCandidates) {
      setCandidateData(null);
      setSelectedReplacementCandidateKey(null);
      setIsConfirmingHideFace(false);
      return;
    }

    if (candidateData?.assetFaceId === selectedFace.assetFaceId) {
      return;
    }

    setCandidateData(null);
    setSelectedReplacementCandidateKey(null);
    setIsConfirmingHideFace(false);
    void loadCandidateData(selectedFace.assetFaceId);
  }, [candidateData?.assetFaceId, isChangePersonOpen, isDrawFaceMode, loadCandidateData, selectedFace]);

  useEffect(() => {
    if (!isWholeAssetPickerOpen) {
      setWholeAssetCandidateData(null);
      setSelectedWholeAssetCandidateKey(null);
      return;
    }

    if (wholeAssetCandidateData?.assetId === asset.id) {
      return;
    }

    setWholeAssetCandidateData(null);
    setSelectedWholeAssetCandidateKey(null);
    void loadWholeAssetCandidateData();
  }, [asset.id, isWholeAssetPickerOpen, loadWholeAssetCandidateData, wholeAssetCandidateData?.assetId]);

  function startDrawFaceMode() {
    setIsAddPersonMenuOpen(false);
    setIsDrawFaceMode(true);
    setDraftManualFaceBox(null);
    setHoveredFaceId(null);
    setSelectedFaceId(null);
    setSelectedWholeAssetAssigneeId(null);
    setCandidateData(null);
    setWholeAssetCandidateData(null);
    setIsChangePersonOpen(false);
    setSelectedReplacementCandidateKey(null);
    setIsWholeAssetPickerOpen(false);
    setSelectedWholeAssetCandidateKey(null);
    setIsConfirmingHideFace(false);
    setActionError(null);
    setIsSavingBlock(false);
    setIsClearingBlock(false);
  }

  function startWholeAssetLinkMode() {
    setIsAddPersonMenuOpen(false);
    setIsDrawFaceMode(false);
    setDraftManualFaceBox(null);
    setHoveredFaceId(null);
    setSelectedFaceId(null);
    setCandidateData(null);
    setIsChangePersonOpen(false);
    setSelectedReplacementCandidateKey(null);
    setSelectedWholeAssetAssigneeId(null);
    setIsWholeAssetPickerOpen(true);
    setSelectedWholeAssetCandidateKey(null);
    setActionError(null);
  }

  function cancelDrawFaceMode() {
    setIsAddPersonMenuOpen(false);
    setIsDrawFaceMode(false);
    setDraftManualFaceBox(null);
    setActionError(null);
  }

  function resolveWholeAssetAssigneeIdFromCandidateKey(
    nextPreviewData: AssetPreviewFacesResponse | null,
    candidateKey: string | null,
  ) {
    if (!nextPreviewData || !candidateKey) {
      return null;
    }

    for (const link of nextPreviewData.wholeAssetLinks) {
      if (candidateKey.startsWith("consent:") && link.consent?.consentId && candidateKey === `consent:${link.consent.consentId}`) {
        return link.projectFaceAssigneeId;
      }

      if (
        candidateKey.startsWith("participant:") &&
        link.recurring?.projectProfileParticipantId &&
        candidateKey === `participant:${link.recurring.projectProfileParticipantId}`
      ) {
        return link.projectFaceAssigneeId;
      }
    }

    return null;
  }

  async function refreshAfterWrite(
    nextSelectedFaceId: string | null,
    nextWholeAssetCandidateKey: string | null = null,
  ) {
    const nextPreviewData = await loadPreviewData();
    await onRefreshAssetData?.();
    setSelectedFaceId(nextSelectedFaceId);
    setSelectedWholeAssetAssigneeId(
      resolveWholeAssetAssigneeIdFromCandidateKey(nextPreviewData, nextWholeAssetCandidateKey),
    );
    setCandidateData(null);
    setWholeAssetCandidateData(null);
    setIsChangePersonOpen(false);
    setSelectedReplacementCandidateKey(null);
    setIsWholeAssetPickerOpen(false);
    setSelectedWholeAssetCandidateKey(null);
    setIsConfirmingHideFace(false);
    setIsAddPersonMenuOpen(false);
    setIsDrawFaceMode(false);
    setDraftManualFaceBox(null);
    setIsSavingBlock(false);
    setIsClearingBlock(false);
  }

  async function handleCreateManualFace() {
    if (!isManualFaceDraftSaveable(draftManualFaceBox)) {
      return;
    }

    setIsSavingManualFace(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/manual-faces`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            faceBoxNormalized: draftManualFaceBox,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as ManualAssetFaceCreateResponse | null;

      if (!response.ok || !payload?.assetFaceId) {
        setActionError(payload?.message ?? t("previewManualFaceCreateError"));
        return;
      }

      await refreshAfterWrite(payload.assetFaceId);
    } catch {
      setActionError(t("previewManualFaceCreateError"));
    } finally {
      setIsSavingManualFace(false);
    }
  }

  async function handleRemoveLink() {
    if (!selectedLinkedFace) {
      return;
    }

    setIsSavingLink(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/faces/${selectedLinkedFace.assetFaceId}/assignment`,
        {
          method: "DELETE",
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

  async function handleRemoveWholeAssetLink() {
    if (!selectedWholeAssetLink) {
      return;
    }

    setIsSavingWholeAssetLink(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/whole-asset-links`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            identityKind:
              selectedWholeAssetLink.identityKind === "project_consent"
                ? "project_consent"
                : "recurring_profile_match",
            consentId: selectedWholeAssetLink.consent?.consentId ?? null,
            projectProfileParticipantId: selectedWholeAssetLink.recurring?.projectProfileParticipantId ?? null,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        setActionError(payload?.message ?? t("previewWholeAssetRemoveError"));
        return;
      }

      await refreshAfterWrite(null);
    } catch {
      setActionError(t("previewWholeAssetRemoveError"));
    } finally {
      setIsSavingWholeAssetLink(false);
    }
  }

  async function submitSelectedFaceLink() {
    if (!selectedFace || !selectedReplacementCandidateKey) {
      return;
    }

    const selectedCandidate =
      candidateData?.assetFaceId === selectedFace.assetFaceId
        ? candidateData.candidates.find((candidate) => candidate.candidateKey === selectedReplacementCandidateKey) ?? null
        : null;
    if (!selectedCandidate || !selectedCandidate.assignable) {
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
          `/api/projects/${projectId}/assets/${asset.id}/faces/${selectedFace.assetFaceId}/assignment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              identityKind: selectedCandidate.identityKind,
              consentId: selectedCandidate.consentId,
              projectProfileParticipantId: selectedCandidate.projectProfileParticipantId,
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

  async function submitSelectedWholeAssetLink() {
    if (!selectedWholeAssetCandidate || !selectedWholeAssetCandidate.assignable) {
      return;
    }

    setIsSavingWholeAssetLink(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/whole-asset-links`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            identityKind: selectedWholeAssetCandidate.identityKind,
            consentId: selectedWholeAssetCandidate.consentId,
            projectProfileParticipantId: selectedWholeAssetCandidate.projectProfileParticipantId,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string; error?: string } | null;

      if (!response.ok) {
        setActionError(
          payload?.message ??
            (payload?.error === "asset_assignee_exact_face_exists"
              ? t("previewWholeAssetExactFaceConflict")
              : t("previewWholeAssetSaveError")),
        );
        return;
      }

      await refreshAfterWrite(null, selectedWholeAssetCandidate.candidateKey);
    } catch {
      setActionError(t("previewWholeAssetSaveError"));
    } finally {
      setIsSavingWholeAssetLink(false);
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

  async function handleBlockFace() {
    if (!selectedFace || selectedFace.faceState === "hidden" || selectedFace.faceState === "blocked") {
      return;
    }

    setIsSavingBlock(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/blocked-faces/${selectedFace.assetFaceId}`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setActionError(payload?.message ?? t("previewBlockFaceError"));
        return;
      }

      await refreshAfterWrite(selectedFace.assetFaceId);
    } catch {
      setActionError(t("previewBlockFaceError"));
    } finally {
      setIsSavingBlock(false);
    }
  }

  async function handleClearBlockedFace() {
    if (!selectedFace || selectedFace.faceState !== "blocked") {
      return;
    }

    setIsClearingBlock(true);
    setActionError(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/blocked-faces/${selectedFace.assetFaceId}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setActionError(payload?.message ?? t("previewClearBlockedFaceError"));
        return;
      }

      await refreshAfterWrite(selectedFace.assetFaceId);
    } catch {
      setActionError(t("previewClearBlockedFaceError"));
    } finally {
      setIsClearingBlock(false);
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
        if (isDrawFaceMode) {
          return;
        }

        const nextFaceId = extractAssetFaceId(overlay.id);
        setSelectedFaceId(nextFaceId);
        setSelectedWholeAssetAssigneeId(null);
        setIsWholeAssetPickerOpen(false);
        setSelectedWholeAssetCandidateKey(null);
        setIsChangePersonOpen(false);
        setSelectedReplacementCandidateKey(null);
        setCandidateData(null);
        setIsConfirmingHideFace(false);
        setActionError(null);
      }}
      selectedOverlayDetail={
        !isDrawFaceMode && selectedFace?.faceState === "unlinked" ? (
          <AssetPreviewUnlinkedFaceTray
            candidates={selectedFaceCandidates}
            isLoadingCandidates={isLoadingCandidates}
            selectedCandidateKey={selectedReplacementCandidateKey}
            onSelectCandidate={(consentId) => {
              setSelectedReplacementCandidateKey(consentId);
              setActionError(null);
            }}
            onSave={() => {
              void submitSelectedFaceLink();
            }}
            onHide={() => {
              void handleHideFace();
            }}
            onBlock={() => {
              void handleBlockFace();
            }}
            onClose={() => {
              setSelectedFaceId(null);
              setSelectedReplacementCandidateKey(null);
              setCandidateData(null);
              setIsConfirmingHideFace(false);
              setActionError(null);
            }}
            isSavingLink={isSavingLink}
            isSavingHide={isSavingHide}
            isSavingBlock={isSavingBlock}
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
            blockLabel={t("previewBlockFace")}
            blockingLabel={t("previewBlockingFace")}
            linkedToFaceLabel={(face) => t("previewLinkedToFace", { face })}
            moveWarningLabel={(face) => t("previewMoveLinkedPersonWarning", { face })}
            confirmMoveLabel={t("previewSelectPerson")}
            cancelLabel={t("previewCancel")}
            autoLabel={t("previewLinkSourceAuto")}
            consentIdentityLabel={t("previewIdentityProjectConsent")}
            recurringIdentityLabel={t("previewIdentityRecurringProfile")}
            unknownPersonLabel={unknownPersonLabel}
            blockedReasonMissingLabel={t("previewRecurringBlockedMissing")}
            blockedReasonPendingLabel={t("previewRecurringBlockedPending")}
            blockedReasonRevokedLabel={t("previewRecurringBlockedRevoked")}
            openPreviewLabel={(name) => t("previewOpenCandidateImage", { name })}
          />
        ) : null
      }
      belowScene={
        <div className="space-y-2.5">
          <AssetPreviewSceneActions
            hiddenFaceCount={previewData?.hiddenFaceCount ?? 0}
            showHiddenFaces={showHiddenFaces}
            onShowHiddenFacesChange={(checked) => setShowHiddenFaces(checked)}
            isAddPersonMenuOpen={isAddPersonMenuOpen}
            onToggleAddPersonMenu={() => setIsAddPersonMenuOpen((current) => !current)}
            onStartSelectFace={startDrawFaceMode}
            onStartLinkEntireAsset={startWholeAssetLinkMode}
            isDrawMode={isDrawFaceMode}
            isDraftSaveable={isDraftManualFaceSaveable}
            isSavingManualFace={isSavingManualFace}
            onCancelDraw={cancelDrawFaceMode}
            onSaveDraw={() => {
              void handleCreateManualFace();
            }}
            showHiddenLabel={(count) => t("previewShowHiddenFaces", { count })}
            addPersonLabel={t("previewAddPerson")}
            selectFaceLabel={t("previewAddPersonSelectFace")}
            linkEntireAssetLabel={t("previewAddPersonLinkEntireAsset")}
            drawModeHelpLabel={t("previewAddPersonDrawHelp")}
            cancelLabel={t("previewCancel")}
            saveLabel={t("previewAddPersonSaveFace")}
            savingLabel={t("previewAddPersonSavingFace")}
          />
          <AssetPreviewLinkedPeopleStrip
            linkedFaces={linkedFaces}
            hoveredLinkedFaceId={hoveredFaceId}
            selectedLinkedFaceId={selectedLinkedFace?.assetFaceId ?? null}
            isLoading={isLoadingPreviewData}
            errorMessage={previewError}
            emptyLabel={t("previewLinkedPeopleEmpty")}
            loadingLabel={t("previewLinkedPeopleLoading")}
            unknownPersonLabel={unknownPersonLabel}
            autoLinkLabel={t("previewLinkSourceAuto")}
            manualLinkLabel={t("previewLinkSourceManual")}
            onHoverChange={setHoveredFaceId}
            onSelect={(assetFaceId) => {
              setSelectedFaceId(assetFaceId);
              setSelectedWholeAssetAssigneeId(null);
              setIsWholeAssetPickerOpen(false);
              setSelectedWholeAssetCandidateKey(null);
            }}
          />
          <AssetPreviewWholeAssetStrip
            wholeAssetLinks={wholeAssetLinks}
            selectedWholeAssetAssigneeId={selectedWholeAssetLink?.projectFaceAssigneeId ?? null}
            isLoading={isLoadingPreviewData}
            errorMessage={previewError}
            titleLabel={t("previewWholeAssetStripTitle")}
            emptyLabel={t("previewWholeAssetStripEmpty")}
            loadingLabel={t("previewWholeAssetStripLoading")}
            unknownPersonLabel={unknownPersonLabel}
            manualLinkLabel={t("previewWholeAssetBadge")}
            onSelect={(projectFaceAssigneeId) => {
              setSelectedFaceId(null);
              setCandidateData(null);
              setIsChangePersonOpen(false);
              setSelectedReplacementCandidateKey(null);
              setSelectedWholeAssetAssigneeId(projectFaceAssigneeId);
              setIsWholeAssetPickerOpen(false);
              setSelectedWholeAssetCandidateKey(null);
              setActionError(null);
            }}
          />
          {selectedFace?.faceState === "blocked" ? (
            <AssetPreviewBlockedFaceTray
              selectedFace={selectedFace}
              candidates={selectedFaceCandidates}
              isAssignPersonOpen={isChangePersonOpen}
              isLoadingCandidates={isLoadingCandidates}
              selectedCandidateKey={selectedReplacementCandidateKey}
              onToggleAssignPerson={() => {
                setActionError(null);
                setCandidateData(null);
                setSelectedReplacementCandidateKey(null);
                setIsChangePersonOpen((current) => !current);
              }}
              onSelectCandidate={(consentId) => {
                setSelectedReplacementCandidateKey(consentId);
                setActionError(null);
              }}
              onSave={() => {
                void submitSelectedFaceLink();
              }}
              onClearBlock={() => {
                void handleClearBlockedFace();
              }}
              isSavingLink={isSavingLink}
              isClearingBlock={isClearingBlock}
              actionError={actionError}
              titleLabel={(face) => t("previewBlockedFaceTitle", { face })}
              descriptionLabel={t("previewBlockedFaceHelp")}
              assignPersonLabel={t("previewAssignBlockedFace")}
              closeAssignPersonLabel={t("previewCloseChangePerson")}
              pickerLoadingLabel={t("previewPickerLoading")}
              pickerEmptyLabel={t("previewPickerEmpty")}
              saveLabel={t("previewSaveFaceLink")}
              savingLabel={t("previewSavingFaceLink")}
              clearBlockedLabel={t("previewClearBlockedFace")}
              clearingBlockedLabel={t("previewClearingBlockedFace")}
              linkedToFaceLabel={(face) => t("previewLinkedToFace", { face })}
              moveWarningLabel={(face) => t("previewMoveLinkedPersonWarning", { face })}
              confirmMoveLabel={t("previewSelectPerson")}
              cancelLabel={t("previewCancel")}
              autoLabel={t("previewLinkSourceAuto")}
              consentIdentityLabel={t("previewIdentityProjectConsent")}
              recurringIdentityLabel={t("previewIdentityRecurringProfile")}
              unknownPersonLabel={unknownPersonLabel}
              blockedReasonMissingLabel={t("previewRecurringBlockedMissing")}
              blockedReasonPendingLabel={t("previewRecurringBlockedPending")}
              blockedReasonRevokedLabel={t("previewRecurringBlockedRevoked")}
              openPreviewLabel={(name) => t("previewOpenCandidateImage", { name })}
            />
          ) : null}
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
        selectedWholeAssetLink || isWholeAssetPickerOpen ? (
          <AssetPreviewWholeAssetPanel
            locale={locale}
            wholeAssetLink={selectedWholeAssetLink}
            isPickerOpen={isWholeAssetPickerOpen}
            isLoadingCandidates={isLoadingWholeAssetCandidates}
            candidates={wholeAssetCandidates}
            selectedCandidateKey={selectedWholeAssetCandidateKey}
            unknownPersonLabel={unknownPersonLabel}
            placeholderLabel={t("previewWholeAssetPanelPlaceholder")}
            pickerTitleLabel={t("previewWholeAssetPickerTitle")}
            pickerHelpLabel={t("previewWholeAssetPickerHelp")}
            pickerLoadingLabel={t("previewPickerLoading")}
            pickerEmptyLabel={t("previewWholeAssetPickerEmpty")}
            signedLabel={t("previewSignedLabel")}
            noEmailLabel={t("previewNoEmail")}
            unknownValueLabel={t("previewUnknownValue")}
            activeLabel={t("previewStatusActive")}
            revokedLabel={t("previewStatusRevoked")}
            consentIdentityLabel={t("previewIdentityProjectConsent")}
            recurringIdentityLabel={t("previewIdentityRecurringProfile")}
            wholeAssetLabel={t("previewWholeAssetBadge")}
            removeLinkLabel={t("previewWholeAssetRemove")}
            removeLinkBusyLabel={t("previewWholeAssetRemoving")}
            changePersonLabel={t("previewChangePerson")}
            changePersonCloseLabel={t("previewCloseChangePerson")}
            saveLabel={t("previewWholeAssetSave")}
            savingLabel={t("previewWholeAssetSaving")}
            cancelLabel={t("previewCancel")}
            exactFaceLinkedLabel={(face) => t("previewLinkedToFace", { face })}
            exactFaceConflictLabel={t("previewWholeAssetExactFaceConflict")}
            blockedReasonMissingLabel={t("previewRecurringBlockedMissing")}
            blockedReasonPendingLabel={t("previewRecurringBlockedPending")}
            blockedReasonRevokedLabel={t("previewRecurringBlockedRevoked")}
            openPreviewLabel={(name) => t("previewOpenCandidateImage", { name })}
            actionError={actionError}
            isSaving={isSavingWholeAssetLink}
            onTogglePicker={() => {
              setActionError(null);
              setSelectedWholeAssetCandidateKey(null);
              setIsWholeAssetPickerOpen((current) => !current);
            }}
            onSelectCandidate={(candidateKey) => {
              setSelectedWholeAssetCandidateKey(candidateKey);
              setActionError(null);
            }}
            onSave={() => {
              void submitSelectedWholeAssetLink();
            }}
            onRemoveLink={() => {
              void handleRemoveWholeAssetLink();
            }}
            onCancelPicker={() => {
              setIsWholeAssetPickerOpen(false);
              setSelectedWholeAssetCandidateKey(null);
              setActionError(null);
            }}
          />
        ) : (
          <AssetPreviewConsentPanel
            linkedFace={selectedLinkedFace}
            locale={locale}
            placeholderLabel={t("previewConsentPanelPlaceholder")}
            goToConsentLabel={t("previewGoToConsent")}
            signedLabel={t("previewSignedLabel")}
            consentSummaryLabel={t("previewConsentSummaryLabel")}
            headshotLabel={t("previewHeadshotLabel")}
            noEmailLabel={t("previewNoEmail")}
            unknownPersonLabel={unknownPersonLabel}
            unknownValueLabel={t("previewUnknownValue")}
            activeLabel={t("previewStatusActive")}
            revokedLabel={t("previewStatusRevoked")}
            consentIdentityLabel={t("previewIdentityProjectConsent")}
            recurringIdentityLabel={t("previewIdentityRecurringProfile")}
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
            blockFaceLabel={t("previewBlockFace")}
            blockFaceBusyLabel={t("previewBlockingFace")}
            isSaving={isSavingLink || isSavingHide || isSavingBlock}
            actionError={actionError}
            isChangePersonOpen={isChangePersonOpen}
            isLoadingCandidates={isLoadingCandidates}
            candidates={selectedLinkedFaceCandidates}
            selectedReplacementCandidateKey={selectedReplacementCandidateKey}
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
            onBlockFace={
              selectedLinkedFace
                ? () => {
                    void handleBlockFace();
                  }
                : null
            }
            onToggleChangePerson={() => {
              setActionError(null);
              setCandidateData(null);
              setSelectedReplacementCandidateKey(null);
              setIsChangePersonOpen((current) => !current);
            }}
            onSelectReplacement={(consentId) => {
              setSelectedReplacementCandidateKey(consentId);
              setActionError(null);
            }}
            onSaveChange={() => {
              void submitSelectedFaceLink();
            }}
          />
        )
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
      isDrawFaceMode={isDrawFaceMode}
      draftFaceBoxNormalized={draftManualFaceBox}
      onDraftFaceBoxChange={setDraftManualFaceBox}
    />
  );
}
