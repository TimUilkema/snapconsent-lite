"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";

import type { ProjectAssetPreviewLightboxProps } from "@/components/projects/project-asset-preview-lightbox";
import {
  AssetPreviewWholeAssetPanel,
  AssetPreviewWholeAssetStrip,
} from "@/components/projects/project-photo-asset-preview-lightbox";

type ProjectVideoAssetPreviewLightboxProps = Omit<ProjectAssetPreviewLightboxProps, "asset"> & {
  asset: Extract<ProjectAssetPreviewLightboxProps["asset"], { assetType: "video" }>;
};

type PreviewScopeState = {
  scopeOptionKey: string;
  scopeLabel: string;
  effectiveStatus: "granted" | "not_granted" | "revoked" | "not_collected";
  governingTemplateVersion: string;
  governingSignedAt: string | null;
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
    scopeStates: PreviewScopeState[];
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
    scopeStates: PreviewScopeState[];
  };
};

type AssetPreviewWholeAssetLinksResponse = {
  assetId: string;
  wholeAssetLinkCount: number;
  wholeAssetLinks: WholeAssetLinkPreview[];
  message?: string;
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
  message?: string;
};

export function ProjectVideoAssetPreviewLightbox({
  projectId,
  asset,
  metadataLabel,
  counterLabel,
  open,
  onClose,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  previousLabel,
  nextLabel,
  closeLabel,
  onRefreshAssetData,
}: ProjectVideoAssetPreviewLightboxProps) {
  const t = useTranslations("projects.assetsList");
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(() => Boolean(asset.playbackUrl));
  const [hasPlaybackError, setHasPlaybackError] = useState(() => !asset.playbackUrl);
  const [wholeAssetLinkData, setWholeAssetLinkData] = useState<AssetPreviewWholeAssetLinksResponse | null>(null);
  const [wholeAssetCandidateData, setWholeAssetCandidateData] =
    useState<AssetPreviewWholeAssetCandidatesResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isLoadingLinks, setIsLoadingLinks] = useState(false);
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isSavingWholeAssetLink, setIsSavingWholeAssetLink] = useState(false);
  const [selectedWholeAssetAssigneeId, setSelectedWholeAssetAssigneeId] = useState<string | null>(null);
  const [isWholeAssetPickerOpen, setIsWholeAssetPickerOpen] = useState(false);
  const [selectedWholeAssetCandidateKey, setSelectedWholeAssetCandidateKey] = useState<string | null>(null);
  const unknownPersonLabel = t("previewUnknownPerson");

  const loadWholeAssetLinkData = useCallback(
    async (signal?: AbortSignal) => {
      setIsLoadingLinks(true);
      try {
        const response = await fetch(
          `/api/projects/${projectId}/assets/${asset.id}/whole-asset-links`,
          {
            method: "GET",
            cache: "no-store",
            signal,
          },
        );
        const payload = (await response.json().catch(() => null)) as AssetPreviewWholeAssetLinksResponse | null;
        if (!response.ok || !payload) {
          if (!signal?.aborted) {
            setPreviewError(payload?.message ?? t("previewWholeAssetLoadError"));
            setWholeAssetLinkData(null);
          }
          return null;
        }

        if (!signal?.aborted) {
          setWholeAssetLinkData(payload);
          setPreviewError(null);
        }
        return payload;
      } catch {
        if (!signal?.aborted) {
          setPreviewError(t("previewWholeAssetLoadError"));
          setWholeAssetLinkData(null);
        }
        return null;
      } finally {
        if (!signal?.aborted) {
          setIsLoadingLinks(false);
        }
      }
    },
    [asset.id, projectId, t],
  );

  const loadWholeAssetCandidateData = useCallback(async () => {
    setIsLoadingCandidates(true);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/assets/${asset.id}/whole-asset-candidates`,
        {
          method: "GET",
          cache: "no-store",
        },
      );
      const payload = (await response.json().catch(() => null)) as AssetPreviewWholeAssetCandidatesResponse | null;

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
      setIsLoadingCandidates(false);
    }
  }, [asset.id, projectId, t]);

  const resolveWholeAssetAssigneeIdFromCandidateKey = useCallback(
    (nextWholeAssetData: AssetPreviewWholeAssetLinksResponse | null, candidateKey: string | null) => {
      if (!nextWholeAssetData || !candidateKey) {
        return null;
      }

      for (const link of nextWholeAssetData.wholeAssetLinks) {
        if (
          candidateKey.startsWith("consent:") &&
          link.consent?.consentId &&
          candidateKey === `consent:${link.consent.consentId}`
        ) {
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
    },
    [],
  );

  const refreshAfterWrite = useCallback(
    async (nextWholeAssetCandidateKey: string | null = null) => {
      const nextWholeAssetData = await loadWholeAssetLinkData();
      await onRefreshAssetData?.();
      setSelectedWholeAssetAssigneeId(
        resolveWholeAssetAssigneeIdFromCandidateKey(nextWholeAssetData, nextWholeAssetCandidateKey),
      );
      setWholeAssetCandidateData(null);
      setIsWholeAssetPickerOpen(false);
      setSelectedWholeAssetCandidateKey(null);
    },
    [loadWholeAssetLinkData, onRefreshAssetData, resolveWholeAssetAssigneeIdFromCandidateKey],
  );

  useEffect(() => {
    setIsLoading(Boolean(asset.playbackUrl));
    setHasPlaybackError(!asset.playbackUrl);
  }, [asset.id, asset.playbackUrl]);

  useEffect(() => {
    if (!open) {
      setWholeAssetLinkData(null);
      setWholeAssetCandidateData(null);
      setPreviewError(null);
      setActionError(null);
      setSelectedWholeAssetAssigneeId(null);
      setIsWholeAssetPickerOpen(false);
      setSelectedWholeAssetCandidateKey(null);
      return;
    }

    setWholeAssetLinkData(null);
    setWholeAssetCandidateData(null);
    setPreviewError(null);
    setActionError(null);
    setSelectedWholeAssetAssigneeId(null);
    setIsWholeAssetPickerOpen(false);
    setSelectedWholeAssetCandidateKey(null);

    const controller = new AbortController();
    void loadWholeAssetLinkData(controller.signal);
    return () => controller.abort();
  }, [asset.id, loadWholeAssetLinkData, open]);

  useEffect(() => {
    if (!isWholeAssetPickerOpen) {
      setWholeAssetCandidateData(null);
      setSelectedWholeAssetCandidateKey(null);
      return;
    }

    void loadWholeAssetCandidateData();
  }, [isWholeAssetPickerOpen, loadWholeAssetCandidateData]);

  const wholeAssetLinks = useMemo(() => wholeAssetLinkData?.wholeAssetLinks ?? [], [wholeAssetLinkData]);
  const selectedWholeAssetLink =
    wholeAssetLinks.find((link) => link.projectFaceAssigneeId === selectedWholeAssetAssigneeId) ?? null;
  const wholeAssetCandidates = wholeAssetCandidateData?.candidates ?? [];
  const selectedWholeAssetCandidate =
    selectedWholeAssetCandidateKey
      ? wholeAssetCandidates.find((candidate) => candidate.candidateKey === selectedWholeAssetCandidateKey) ?? null
      : null;

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

  function startWholeAssetLinkMode() {
    setActionError(null);
    setSelectedWholeAssetAssigneeId(null);
    setIsWholeAssetPickerOpen(true);
    setSelectedWholeAssetCandidateKey(null);
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

      await refreshAfterWrite(selectedWholeAssetCandidate.candidateKey);
    } catch {
      setActionError(t("previewWholeAssetSaveError"));
    } finally {
      setIsSavingWholeAssetLink(false);
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/55 p-3 backdrop-blur-[2px] sm:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative max-h-[96vh] w-[min(96vw,1520px)] overflow-y-auto rounded-[28px] border border-white/85 bg-white/94 p-3 shadow-[0_36px_120px_rgba(15,23,42,0.34),0_12px_32px_rgba(15,23,42,0.18)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-zinc-200/90 bg-white/92 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-zinc-900">
              {asset.originalFilename || t("previewFallbackTitle")}
            </p>
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

        <div className="mt-3 xl:grid xl:grid-cols-[minmax(0,1fr)_23rem] xl:items-start xl:gap-3">
          <div className="space-y-3">
            <div className="relative h-[clamp(19rem,56vh,48rem)] overflow-hidden rounded-[22px] border border-zinc-200/90 bg-zinc-950 p-3 lg:h-[clamp(21rem,58vh,50rem)]">
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

              <div className="relative flex h-full w-full items-center justify-center rounded-[18px] bg-zinc-950">
                {asset.playbackUrl ? (
                  <video
                    key={asset.id}
                    src={asset.playbackUrl}
                    poster={asset.previewUrl ?? asset.thumbnailUrl ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full rounded-[18px] bg-zinc-950 object-contain"
                    onLoadedMetadata={() => {
                      setIsLoading(false);
                      setHasPlaybackError(false);
                    }}
                    onError={() => {
                      setIsLoading(false);
                      setHasPlaybackError(true);
                    }}
                  />
                ) : null}

                {isLoading ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-zinc-950/60 px-4 text-center text-sm text-zinc-100">
                    {t("videoPreviewLoading")}
                  </div>
                ) : null}

                {hasPlaybackError ? (
                  <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-zinc-100">
                    {t("videoPreviewUnavailable")}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-white p-3">
              <div>
                <p className="text-sm font-medium text-zinc-900">{t("previewWholeAssetStripTitle")}</p>
                <p className="mt-1 text-sm text-zinc-600">{t("previewWholeAssetPickerHelp")}</p>
              </div>
              <button
                type="button"
                disabled={isSavingWholeAssetLink}
                onClick={startWholeAssetLinkMode}
                className="rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {t("previewAddPersonLinkEntireAsset")}
              </button>
            </div>

            <AssetPreviewWholeAssetStrip
              wholeAssetLinks={wholeAssetLinks}
              selectedWholeAssetAssigneeId={selectedWholeAssetLink?.projectFaceAssigneeId ?? null}
              isLoading={isLoadingLinks}
              errorMessage={previewError}
              titleLabel={t("previewWholeAssetStripTitle")}
              emptyLabel={t("previewWholeAssetStripEmpty")}
              loadingLabel={t("previewWholeAssetStripLoading")}
              unknownPersonLabel={unknownPersonLabel}
              manualLinkLabel={t("previewWholeAssetBadge")}
              onSelect={(projectFaceAssigneeId) => {
                setSelectedWholeAssetAssigneeId(projectFaceAssigneeId);
                setIsWholeAssetPickerOpen(false);
                setSelectedWholeAssetCandidateKey(null);
                setActionError(null);
              }}
            />
          </div>

          <div className="mt-3 xl:mt-0">
            <AssetPreviewWholeAssetPanel
              locale={locale}
              wholeAssetLink={selectedWholeAssetLink}
              isPickerOpen={isWholeAssetPickerOpen}
              isLoadingCandidates={isLoadingCandidates}
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
              scopeStatusLabel={t("previewScopeStatusLabel")}
              scopeStatusGrantedLabel={t("previewScopeStatusGranted")}
              scopeStatusNotGrantedLabel={t("previewScopeStatusNotGranted")}
              scopeStatusRevokedLabel={t("previewScopeStatusRevoked")}
              scopeStatusNotCollectedLabel={t("previewScopeStatusNotCollected")}
              scopeProvenanceWithDateLabel={(version, date) =>
                t("previewScopeProvenanceWithDate", { version, date })
              }
              scopeProvenanceWithoutDateLabel={(version) =>
                t("previewScopeProvenanceWithoutDate", { version })
              }
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
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
