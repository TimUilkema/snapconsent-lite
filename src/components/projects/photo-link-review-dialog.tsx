"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getFaceOverlayStyle, type MeasuredSize } from "@/lib/client/face-overlay";
import { getInitialSelectedFaceId } from "@/lib/client/face-review-selection";

type ReviewAsset = {
  id: string;
  originalFilename: string;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  preferredAssetFaceId?: string | null;
  preferredFaceRank?: number | null;
};

type FaceStatus = "current" | "occupied_manual" | "occupied_auto" | "suppressed" | "available";

type ManualLinkFace = {
  assetFaceId: string;
  faceRank: number;
  faceBox: Record<string, number | null>;
  faceBoxNormalized: Record<string, number | null> | null;
  matchConfidence: number | null;
  cropUrl: string | null;
  status: FaceStatus;
  currentAssignee: {
    consentId: string;
    fullName: string | null;
    email: string | null;
    linkSource: "manual" | "auto";
  } | null;
  isSuppressedForConsent: boolean;
  isCurrentConsentFace: boolean;
};

type ManualLinkState = {
  materializationStatus: "ready" | "queued" | "processing";
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  faces: ManualLinkFace[];
  fallbackAllowed: boolean;
  currentConsentLink:
    | {
        mode: "face";
        linkSource: "manual" | "auto";
        assetFaceId: string;
        faceRank: number | null;
      }
    | {
        mode: "asset_fallback";
        linkSource: "manual";
      }
    | null;
};

type SessionItem = {
  id: string;
  assetId: string;
  position: number;
  status: "pending_materialization" | "ready_for_face_selection" | "completed" | "blocked";
  completionKind: "linked_face" | "linked_fallback" | "suppressed_face" | null;
  blockCode: "consent_revoked" | "manual_conflict" | "asset_unavailable" | "materialization_failed" | null;
  preparedMaterializationId: string | null;
  detectedFaceCount: number | null;
  wasRematerialized: boolean;
  asset: {
    originalFilename: string;
    thumbnailUrl: string | null;
    previewUrl: string | null;
  };
  faces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    matchConfidence: number | null;
    cropUrl: string | null;
    status: FaceStatus;
    currentAssignee: {
      consentId: string;
      fullName: string | null;
      email: string | null;
      linkSource: "manual" | "auto";
    } | null;
    isCurrentConsentFace: boolean;
    isSuppressedForConsent: boolean;
  }>;
};

type SessionState = {
  session: {
    id: string;
    status: "open" | "completed" | "cancelled" | "expired";
    selectedAssetCount: number;
    completedCount: number;
    pendingMaterializationCount: number;
    readyForFaceSelectionCount: number;
    blockedCount: number;
    currentQueueIndex: number | null;
    nextReviewItemId: string | null;
  };
  items: SessionItem[];
};

type Props = {
  projectId: string;
  consentId: string;
  asset?: ReviewAsset | null;
  sessionId?: string | null;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
};

function describeAssignee(face: { currentAssignee: ManualLinkFace["currentAssignee"] }) {
  if (!face.currentAssignee) {
    return "Unassigned";
  }

  const label = face.currentAssignee.fullName || face.currentAssignee.email || "Assigned";
  return `${label} (${face.currentAssignee.linkSource === "manual" ? "manual" : "auto"})`;
}

function getFaceStatusLabel(status: FaceStatus) {
  switch (status) {
    case "current":
      return "Current";
    case "occupied_manual":
      return "Occupied manual";
    case "occupied_auto":
      return "Occupied auto";
    case "suppressed":
      return "Suppressed";
    default:
      return "Available";
  }
}

function getFaceStatusClasses(status: FaceStatus, selected: boolean) {
  if (selected) {
    return "border-teal-800 bg-teal-50 text-zinc-950 shadow-sm ring-2 ring-teal-700 ring-offset-2";
  }

  if (status === "current") {
    return "border-emerald-400 bg-emerald-50 text-emerald-950";
  }

  if (status === "occupied_manual") {
    return "border-rose-300 bg-rose-50 text-rose-950";
  }

  if (status === "occupied_auto") {
    return "border-indigo-300 bg-indigo-50 text-indigo-950";
  }

  if (status === "suppressed") {
    return "border-violet-300 bg-violet-50 text-violet-950";
  }

  return "border-zinc-300 bg-white text-zinc-900";
}

function getPreviewFaceOutlineClasses(status: FaceStatus, selected: boolean) {
  if (selected) {
    return "border-teal-800 bg-teal-500/12 shadow-[0_0_0_2px_rgba(15,118,110,0.98),0_0_0_6px_rgba(255,255,255,0.98),0_14px_28px_rgba(15,118,110,0.24)]";
  }

  if (status === "current") {
    return "border-emerald-600 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.92),0_10px_22px_rgba(5,150,105,0.16)]";
  }

  if (status === "occupied_manual") {
    return "border-rose-600 bg-rose-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.92),0_10px_22px_rgba(225,29,72,0.16)]";
  }

  if (status === "occupied_auto") {
    return "border-indigo-600 bg-indigo-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.92),0_10px_22px_rgba(79,70,229,0.16)]";
  }

  if (status === "suppressed") {
    return "border-violet-600 bg-violet-500/10 shadow-[0_0_0_1px_rgba(255,255,255,0.92),0_10px_22px_rgba(124,58,237,0.16)]";
  }

  return "border-zinc-500/90 bg-zinc-500/8 shadow-[0_0_0_1px_rgba(255,255,255,0.92),0_8px_18px_rgba(63,63,70,0.12)]";
}

function getConfidenceBadgeClasses(status: FaceStatus) {
  switch (status) {
    case "current":
      return "bg-emerald-700 text-white";
    case "occupied_manual":
      return "bg-rose-700 text-white";
    case "occupied_auto":
      return "bg-indigo-700 text-white";
    case "suppressed":
      return "bg-violet-700 text-white";
    default:
      return "bg-teal-700 text-white";
  }
}

function getBlockMessage(blockCode: SessionItem["blockCode"]) {
  switch (blockCode) {
    case "consent_revoked":
      return "Consent was revoked while this review queue was open.";
    case "manual_conflict":
      return "Another consent already owns this face manually.";
    case "asset_unavailable":
      return "This asset is no longer available for review.";
    case "materialization_failed":
      return "Face materialization could not be prepared yet.";
    default:
      return "This queue item is blocked.";
  }
}

function readMessage(payload: unknown, fallback: string) {
  return typeof payload === "object" && payload && "message" in payload && typeof payload.message === "string"
    ? payload.message
    : fallback;
}

function formatConfidencePercentage(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }

  return `${(value * 100).toFixed(value >= 0.995 ? 0 : 1)}%`;
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

export function PhotoLinkReviewDialog({ projectId, consentId, asset, sessionId, onClose, onSaved }: Props) {
  const isSessionMode = Boolean(sessionId);
  const previewFrameRef = useRef<HTMLDivElement | null>(null);
  const previewFrameSize = useMeasuredSize(previewFrameRef);
  const [imageSize, setImageSize] = useState<MeasuredSize | null>(null);
  const [manualState, setManualState] = useState<ManualLinkState | null>(null);
  const [sessionState, setSessionState] = useState<SessionState | null>(null);
  const [activeQueueItemId, setActiveQueueItemId] = useState<string | null>(null);
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    canForceReplace: boolean;
    currentAssignee: ManualLinkFace["currentAssignee"];
  } | null>(null);

  const queueItems = useMemo(
    () => sessionState?.items.filter((item) => item.status === "ready_for_face_selection") ?? [],
    [sessionState],
  );
  const activeQueueItem = useMemo(
    () =>
      queueItems.find((item) => item.id === activeQueueItemId) ??
      queueItems.find((item) => item.id === sessionState?.session.nextReviewItemId) ??
      queueItems[0] ??
      null,
    [activeQueueItemId, queueItems, sessionState],
  );
  const sessionBlockedItems = useMemo(
    () => sessionState?.items.filter((item) => item.status === "blocked") ?? [],
    [sessionState],
  );

  const currentFaces = useMemo(
    () => (isSessionMode ? activeQueueItem?.faces ?? [] : manualState?.faces ?? []),
    [activeQueueItem, isSessionMode, manualState],
  );
  const currentAsset = useMemo(
    () =>
      isSessionMode
        ? activeQueueItem
          ? {
              id: activeQueueItem.assetId,
              originalFilename: activeQueueItem.asset.originalFilename,
              thumbnailUrl: activeQueueItem.asset.thumbnailUrl,
              previewUrl: activeQueueItem.asset.previewUrl,
            }
          : null
        : asset ?? null,
    [activeQueueItem, asset, isSessionMode],
  );
  const currentFace = useMemo(
    () => currentFaces.find((face) => face.assetFaceId === selectedFaceId) ?? null,
    [currentFaces, selectedFaceId],
  );

  useEffect(() => {
    if (!isSessionMode || !sessionState) {
      return;
    }

    const nextItemId = sessionState.session.nextReviewItemId ?? queueItems[0]?.id ?? null;
    setActiveQueueItemId((current) => (current && queueItems.some((item) => item.id === current) ? current : nextItemId));
  }, [isSessionMode, queueItems, sessionState]);

  useEffect(() => {
    setSelectedFaceId(
      getInitialSelectedFaceId(currentFaces, {
        preferredAssetFaceId: isSessionMode ? null : currentAsset?.preferredAssetFaceId ?? null,
        preferredFaceRank: isSessionMode ? null : currentAsset?.preferredFaceRank ?? null,
      }),
    );
  }, [currentAsset?.id, currentAsset?.preferredAssetFaceId, currentAsset?.preferredFaceRank, currentFaces, isSessionMode]);

  useEffect(() => {
    setImageSize(null);
  }, [currentAsset?.id]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }

      if (currentFaces.length === 0 || isSaving) {
        return;
      }

      const currentIndex = currentFaces.findIndex((face) => face.assetFaceId === selectedFaceId);
      if (event.key === "ArrowRight" || event.key === "ArrowDown") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.min(currentFaces.length - 1, currentIndex + 1) : 0;
        setSelectedFaceId(currentFaces[nextIndex]?.assetFaceId ?? null);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
        event.preventDefault();
        const nextIndex = currentIndex >= 0 ? Math.max(0, currentIndex - 1) : 0;
        setSelectedFaceId(currentFaces[nextIndex]?.assetFaceId ?? null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [currentFaces, isSaving, onClose, selectedFaceId]);

  const loadState = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      if (isSessionMode && sessionId) {
        const response = await fetch(
          `/api/projects/${projectId}/consents/${consentId}/review-sessions/${sessionId}`,
          { method: "GET", cache: "no-store" },
        );
        const payload = (await response.json().catch(() => null)) as (SessionState & { message?: string }) | null;
        if (!response.ok || !payload) {
          setError(readMessage(payload, "Unable to load the face review queue."));
          setSessionState(null);
          return;
        }

        setSessionState(payload);
        setManualState(null);
        return;
      }

      if (!asset) {
        setError("Review asset is unavailable.");
        return;
      }

      const response = await fetch(
        `/api/projects/${projectId}/consents/${consentId}/assets/${asset.id}/manual-link-state`,
        { method: "GET", cache: "no-store" },
      );
      const payload = (await response.json().catch(() => null)) as (ManualLinkState & { message?: string }) | null;
      if (!response.ok || !payload) {
        setError(readMessage(payload, "Unable to load face review state."));
        setManualState(null);
        return;
      }

      setManualState(payload);
      setSessionState(null);
    } catch {
      setError(isSessionMode ? "Unable to load the face review queue." : "Unable to load face review state.");
    } finally {
      setIsLoading(false);
    }
  }, [asset, consentId, isSessionMode, projectId, sessionId]);

  useEffect(() => {
    void loadState();
  }, [asset?.id, consentId, isSessionMode, loadState, projectId, sessionId]);

  useEffect(() => {
    const shouldPoll =
      (isSessionMode &&
        sessionState?.session.status === "open" &&
        (sessionState.session.pendingMaterializationCount ?? 0) > 0) ||
      (!isSessionMode && manualState?.materializationStatus !== undefined && manualState.materializationStatus !== "ready");

    if (!shouldPoll) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadState();
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [isSessionMode, loadState, manualState, sessionState]);

  async function handleSaved(closeIfIdle = false) {
    await onSaved();
    if (closeIfIdle) {
      onClose();
    }
  }

  async function submitSingleLink(forceReplace = false) {
    if (!manualState || !currentAsset) {
      return;
    }

    if (manualState.detectedFaceCount > 1 && !selectedFaceId) {
      setError("Select one specific detected face before saving.");
      return;
    }

    setIsSaving(true);
    setError(null);
    setConflict(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/assets/links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          manualState.detectedFaceCount === 0
            ? { assetId: currentAsset.id, mode: "asset_fallback" }
            : { assetId: currentAsset.id, mode: "face", assetFaceId: selectedFaceId, forceReplace },
        ),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            canForceReplace?: boolean;
            currentAssignee?: ManualLinkFace["currentAssignee"];
          }
        | null;

      if (response.status === 409 && payload?.canForceReplace) {
        setConflict({
          canForceReplace: true,
          currentAssignee: payload.currentAssignee ?? null,
        });
        setError(readMessage(payload, "This face is already manually assigned."));
        return;
      }

      if (!response.ok) {
        setError(readMessage(payload, "Unable to link this photo."));
        return;
      }

      await handleSaved(true);
    } catch {
      setError("Unable to link this photo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitSingleUnlink() {
    if (!manualState?.currentConsentLink || !currentAsset) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setConflict(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/assets/links`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetId: currentAsset.id,
          mode: manualState.currentConsentLink.mode,
          assetFaceId:
            manualState.currentConsentLink.mode === "face" ? manualState.currentConsentLink.assetFaceId : undefined,
        }),
      });
      const payload = (await response.json().catch(() => null)) as { message?: string } | null;
      if (!response.ok) {
        setError(readMessage(payload, "Unable to unlink this photo."));
        return;
      }

      await handleSaved(true);
    } catch {
      setError("Unable to unlink this photo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitSessionAction(action: "link_face" | "suppress_face", forceReplace = false) {
    if (!sessionId || !activeQueueItem || !selectedFaceId) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setConflict(null);
    try {
      const response = await fetch(
        `/api/projects/${projectId}/consents/${consentId}/review-sessions/${sessionId}/items/${activeQueueItem.id}/actions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action,
            assetFaceId: selectedFaceId,
            forceReplace,
          }),
        },
      );
      const payload = (await response.json().catch(() => null)) as
        | {
            message?: string;
            canForceReplace?: boolean;
            currentAssignee?: ManualLinkFace["currentAssignee"];
            session?: {
              nextReviewItemId: string | null;
              completedCount: number;
              readyForFaceSelectionCount: number;
              pendingMaterializationCount: number;
            };
          }
        | null;

      if (response.status === 409 && payload?.canForceReplace) {
        setConflict({
          canForceReplace: true,
          currentAssignee: payload.currentAssignee ?? null,
        });
        setError(readMessage(payload, "This face is already manually assigned."));
        return;
      }

      if (!response.ok) {
        setError(readMessage(payload, "Unable to update the review queue item."));
        return;
      }

      await loadState();
      await handleSaved(
        Boolean(
          payload?.session &&
            payload.session.pendingMaterializationCount === 0 &&
            payload.session.readyForFaceSelectionCount === 0 &&
            !payload.session.nextReviewItemId,
        ),
      );
    } catch {
      setError("Unable to update the review queue item.");
    } finally {
      setIsSaving(false);
    }
  }

  const primaryDisabled =
    isSaving ||
    isLoading ||
    !currentAsset ||
    (!isSessionMode &&
      (!manualState ||
        manualState.materializationStatus !== "ready" ||
        (manualState.detectedFaceCount > 1 && !selectedFaceId))) ||
    (isSessionMode && !activeQueueItem) ||
    (isSessionMode && !selectedFaceId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="max-h-[92vh] w-full max-w-6xl overflow-hidden rounded-lg border border-zinc-300 bg-white" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900">{isSessionMode ? "Review face queue" : "Review photo face link"}</p>
            <p className="text-xs text-zinc-600">
              {currentAsset?.originalFilename ??
                (sessionState ? `${sessionState.session.completedCount} of ${sessionState.session.selectedAssetCount} processed` : "Loading")}
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800">
            Close
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.95fr)]">
          <section className="space-y-3">
            <div ref={previewFrameRef} className="relative h-[48vh] overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
              {currentAsset?.previewUrl || currentAsset?.thumbnailUrl ? (
                <>
                  <img
                    src={currentAsset.previewUrl ?? currentAsset.thumbnailUrl ?? ""}
                    alt={currentAsset.originalFilename}
                    className="h-full w-full object-contain"
                    onLoad={(event) =>
                      setImageSize({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                  {currentFaces.map((face) => {
                    const overlayStyle = getFaceOverlayStyle(face.faceBoxNormalized, previewFrameSize, imageSize);
                    if (!overlayStyle) {
                      return null;
                    }

                    const selected = selectedFaceId === face.assetFaceId;
                    return (
                      <button
                        key={face.assetFaceId}
                        type="button"
                        onClick={() => setSelectedFaceId(face.assetFaceId)}
                        className={`absolute rounded-[10px] border-[4px] transition-shadow ${getPreviewFaceOutlineClasses(face.status, selected)}`}
                        style={overlayStyle}
                      >
                        {selected ? (
                          <span className="pointer-events-none absolute left-1/2 top-full z-10 -translate-x-1/2 translate-y-2 rounded-md bg-teal-800 px-2 py-1 text-[10px] font-semibold text-white shadow-sm">
                            Selected
                          </span>
                        ) : null}
                        {formatConfidencePercentage(face.matchConfidence) ? (
                          <span className={`pointer-events-none absolute bottom-1.5 right-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${getConfidenceBadgeClasses(face.status)}`}>
                            {formatConfidencePercentage(face.matchConfidence)}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </>
              ) : (
                <div className="grid h-full place-items-center text-sm text-zinc-500">Preview unavailable.</div>
              )}
            </div>

            {currentFaces.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {currentFaces.map((face) => {
                  const selected = face.assetFaceId === selectedFaceId;
                  return (
                    <button key={face.assetFaceId} type="button" onClick={() => setSelectedFaceId(face.assetFaceId)} className={`rounded-lg border p-2 text-left ${getFaceStatusClasses(face.status, selected)}`}>
                      <div className="flex gap-3">
                        <div className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-md border border-zinc-200 bg-zinc-100">
                          {face.cropUrl ? <img src={face.cropUrl} alt={`Face ${face.faceRank + 1}`} className="h-full w-full object-cover" /> : <span className="text-[10px] text-zinc-500">No crop</span>}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold">Face {face.faceRank + 1}</span>
                            <span className="rounded border border-current px-1.5 py-0.5 text-[10px] font-medium">{getFaceStatusLabel(face.status)}</span>
                          </div>
                          <p className="mt-1 text-xs">{describeAssignee(face)}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </section>

          <section className="space-y-3">
            {isSessionMode && sessionState ? (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-xs font-semibold text-zinc-900">Queue progress</p>
                <p className="mt-2 text-xs text-zinc-600">
                  {sessionState.session.completedCount} completed, {sessionState.session.readyForFaceSelectionCount} ready, {sessionState.session.pendingMaterializationCount} pending, {sessionState.session.blockedCount} blocked.
                </p>
                {queueItems.length > 0 ? (
                  <div className="mt-3 flex gap-2">
                    <button type="button" disabled={isSaving || queueItems.findIndex((item) => item.id === activeQueueItem?.id) <= 0} onClick={() => setActiveQueueItemId(queueItems[Math.max(0, queueItems.findIndex((item) => item.id === activeQueueItem?.id) - 1)]?.id ?? null)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 disabled:opacity-60">
                      Previous
                    </button>
                    <button type="button" disabled={isSaving || queueItems.findIndex((item) => item.id === activeQueueItem?.id) >= queueItems.length - 1} onClick={() => setActiveQueueItemId(queueItems[Math.min(queueItems.length - 1, queueItems.findIndex((item) => item.id === activeQueueItem?.id) + 1)]?.id ?? null)} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 disabled:opacity-60">
                      Next
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
              <p className="text-xs font-semibold text-zinc-900">Current state</p>
              {isLoading ? <p className="mt-2 text-sm text-zinc-600">Loading review state...</p> : null}
              {!isLoading && isSessionMode && sessionState && !activeQueueItem ? (
                <div className="mt-2 space-y-2 text-sm text-zinc-900">
                  <p>{sessionState.session.pendingMaterializationCount > 0 ? "Waiting for face materialization to finish for the remaining photos." : "No queued multi-face items remain."}</p>
                  {sessionBlockedItems.length > 0 ? <p className="text-xs text-amber-800">{getBlockMessage(sessionBlockedItems[0]?.blockCode ?? null)}</p> : null}
                </div>
              ) : null}
              {!isLoading && !isSessionMode && manualState?.materializationStatus !== "ready" ? (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-zinc-900">Face materialization is still running for this photo.</p>
                  <p className="text-xs text-zinc-600">This dialog will refresh automatically when face detection is ready.</p>
                </div>
              ) : null}
              {!isLoading && !isSessionMode && manualState?.materializationStatus === "ready" && manualState.detectedFaceCount === 0 ? (
                <div className="mt-2 space-y-2">
                  <p className="text-sm text-zinc-900">No detected faces were found for this photo.</p>
                  <p className="text-xs text-zinc-600">Only the explicit zero-face fallback is available here.</p>
                </div>
              ) : null}
              {!isLoading && currentFace ? (
                <div className="mt-3 rounded-lg border border-zinc-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-zinc-900">Selected face</span>
                    <span className="rounded border border-zinc-300 px-2 py-0.5 text-[10px] font-medium text-zinc-700">{getFaceStatusLabel(currentFace.status)}</span>
                  </div>
                  <p className="mt-2 text-xs text-zinc-600">{describeAssignee(currentFace)}</p>
                  {isSessionMode && activeQueueItem?.wasRematerialized ? <p className="mt-2 text-xs text-amber-800">This asset was rematerialized after the queue was prepared. Reconfirm the correct face.</p> : null}
                </div>
              ) : null}
            </div>

            {conflict ? <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">Manual conflict with {conflict.currentAssignee?.fullName || conflict.currentAssignee?.email || "another consent"}.</div> : null}
            {error ? <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</div> : null}

            <div className="rounded-lg border border-zinc-200 bg-white p-4">
              <div className="flex flex-wrap gap-2">
                {isSessionMode ? (
                  <>
                    <button type="button" disabled={primaryDisabled} onClick={() => void submitSessionAction("link_face")} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
                      {isSaving ? "Saving..." : "Link selected face"}
                    </button>
                    <button type="button" disabled={primaryDisabled} onClick={() => void submitSessionAction("suppress_face")} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 disabled:opacity-60">
                      Suppress for this consent
                    </button>
                    {conflict?.canForceReplace ? <button type="button" disabled={primaryDisabled} onClick={() => void submitSessionAction("link_face", true)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-60">Replace current manual assignee</button> : null}
                  </>
                ) : (
                  <>
                    <button type="button" disabled={primaryDisabled} onClick={() => void submitSingleLink()} className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:opacity-60">
                      {isSaving ? "Saving..." : manualState?.detectedFaceCount === 0 ? "Link whole photo" : "Link selected face"}
                    </button>
                    {conflict?.canForceReplace ? <button type="button" disabled={primaryDisabled} onClick={() => void submitSingleLink(true)} className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-medium text-amber-800 disabled:opacity-60">Replace current manual assignee</button> : null}
                    {manualState?.currentConsentLink ? <button type="button" disabled={isSaving || isLoading} onClick={() => void submitSingleUnlink()} className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 disabled:opacity-60">{manualState.currentConsentLink.mode === "asset_fallback" ? "Remove fallback" : "Unlink current face"}</button> : null}
                  </>
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
