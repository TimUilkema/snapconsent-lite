"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
import type { RecurringProfileDetailData } from "@/lib/profiles/profile-directory-service";

type HeadshotMatchingData = RecurringProfileDetailData["headshotMatching"];

type ProfileHeadshotPanelProps = {
  profileId: string;
  headshotMatching: HeadshotMatchingData;
  router: {
    refresh: () => void;
  };
  onMutated: (notice?: { tone: "success"; message: string }) => void;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
} | null;

type CreateHeadshotUploadPayload = {
  headshotId: string;
  signedUrl: string;
};

type FinalizeHeadshotPayload = {
  materializationDeferred?: boolean;
} | ApiErrorPayload;

function uploadWithProgress(file: File, signedUrl: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", resolveSignedUploadUrlForBrowser(signedUrl));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error("upload_failed"));
      }
    };
    xhr.onerror = () => reject(new Error("upload_failed"));
    xhr.send(file);
  });
}

function readinessBadgeClass(state: HeadshotMatchingData["readiness"]["state"]) {
  if (state === "ready") {
    return "inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700";
  }

  if (state === "materializing" || state === "needs_face_selection") {
    return "inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800";
  }

  if (state === "blocked_no_opt_in" || state === "missing_headshot") {
    return "inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700";
  }

  return "inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700";
}

function resolveFaceBoxStyle(
  face: HeadshotMatchingData["candidateFaces"][number],
  materialization: HeadshotMatchingData["currentMaterialization"],
) {
  if (face.normalizedFaceBox) {
    return {
      left: `${face.normalizedFaceBox.xMin * 100}%`,
      top: `${face.normalizedFaceBox.yMin * 100}%`,
      width: `${(face.normalizedFaceBox.xMax - face.normalizedFaceBox.xMin) * 100}%`,
      height: `${(face.normalizedFaceBox.yMax - face.normalizedFaceBox.yMin) * 100}%`,
    };
  }

  if (!materialization?.source_image_width || !materialization?.source_image_height) {
    return null;
  }

  return {
    left: `${(face.faceBox.xMin / materialization.source_image_width) * 100}%`,
    top: `${(face.faceBox.yMin / materialization.source_image_height) * 100}%`,
    width: `${((face.faceBox.xMax - face.faceBox.xMin) / materialization.source_image_width) * 100}%`,
    height: `${((face.faceBox.yMax - face.faceBox.yMin) / materialization.source_image_height) * 100}%`,
  };
}

function MatchingReadinessBadge({ state }: { state: HeadshotMatchingData["readiness"]["state"] }) {
  const t = useTranslations("profiles.matching.state");

  return <span className={readinessBadgeClass(state)}>{t(state)}</span>;
}

function HeadshotMetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-sm text-zinc-800">{value}</p>
    </div>
  );
}

export function ProfileHeadshotPanel({
  profileId,
  headshotMatching,
  router,
  onMutated,
}: ProfileHeadshotPanelProps) {
  const t = useTranslations("profiles.headshot");
  const tMatching = useTranslations("profiles.matching");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isSelectingFace, setIsSelectingFace] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const currentHeadshot = headshotMatching.currentHeadshot;
  const currentMaterialization = headshotMatching.currentMaterialization;
  const showFaceChooser =
    headshotMatching.actions.canSelectFace
    && Boolean(currentHeadshot)
    && headshotMatching.candidateFaces.length > 0;

  async function handleSelectedFile(file: File | null) {
    if (!file) {
      return;
    }

    setError(null);
    setIsUploading(true);
    setUploadProgress(0);

    try {
      const createResponse = await fetch(`/api/profiles/${profileId}/headshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          originalFilename: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | (CreateHeadshotUploadPayload & ApiErrorPayload)
        | null;

      if (!createResponse.ok || !createPayload?.headshotId || !createPayload?.signedUrl) {
        setError(resolveLocalizedApiError(tErrors, createPayload, "generic"));
        return;
      }

      await uploadWithProgress(file, createPayload.signedUrl, (loaded) => {
        const percent = file.size > 0 ? Math.round((loaded / file.size) * 100) : 0;
        setUploadProgress(percent);
      });

      const finalizeResponse = await fetch(
        `/api/profiles/${profileId}/headshot/${createPayload.headshotId}/finalize`,
        {
          method: "POST",
        },
      );
      const finalizePayload = (await finalizeResponse.json().catch(() => null)) as FinalizeHeadshotPayload;

      if (!finalizeResponse.ok) {
        setError(resolveLocalizedApiError(tErrors, finalizePayload, "generic"));
        return;
      }

      router.refresh();
      onMutated({
        tone: "success",
        message: finalizePayload?.materializationDeferred
          ? t("success.repairQueued")
          : currentHeadshot
            ? t("success.replaced")
            : t("success.uploaded"),
      });
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleSelectFace(faceId: string) {
    setError(null);
    setIsSelectingFace(faceId);

    try {
      const response = await fetch(
        `/api/profiles/${profileId}/headshot/${headshotMatching.readiness.currentHeadshotId}/select-face`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            faceId,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
      onMutated({
        tone: "success",
        message: t("success.faceSelected"),
      });
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSelectingFace(null);
    }
  }

  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h3 className="text-base font-semibold text-zinc-900">{t("title")}</h3>
          <div className="flex flex-wrap items-center gap-2">
            <MatchingReadinessBadge state={headshotMatching.readiness.state} />
            {currentHeadshot?.selection_status === "manual_selected" ? (
              <span className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                {t("selection.manual")}
              </span>
            ) : null}
            {currentHeadshot?.selection_status === "auto_selected" ? (
              <span className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                {t("selection.auto")}
              </span>
            ) : null}
          </div>
          <p className="max-w-3xl text-sm text-zinc-700">
            {tMatching(`description.${headshotMatching.readiness.state}`)}
          </p>
          {!headshotMatching.readiness.authorized && headshotMatching.actions.canManage ? (
            <p className="text-sm text-zinc-700">{t("authorizationRequired")}</p>
          ) : null}
        </div>

        {headshotMatching.actions.canManage ? (
          <div className="w-full max-w-xs space-y-3 lg:w-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              disabled={!headshotMatching.actions.canUpload || isUploading}
              onChange={(event) => {
                void handleSelectedFile(event.target.files?.[0] ?? null);
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!headshotMatching.actions.canUpload || isUploading}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
            >
              {isUploading
                ? t("uploading")
                : currentHeadshot
                  ? t("replace")
                  : t("upload")}
            </button>
            {isUploading ? (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
                  <div className="h-full bg-zinc-900" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-xs text-zinc-600">{uploadProgress}%</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {error ? <p className="mt-4 text-sm text-red-700">{error}</p> : null}

      {currentHeadshot ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <HeadshotMetaField label={t("meta.fileName")} value={currentHeadshot.original_filename} />
          <HeadshotMetaField
            label={t("meta.uploadedAt")}
            value={
              currentHeadshot.uploaded_at
                ? formatDateTime(currentHeadshot.uploaded_at, locale)
                : t("meta.notAvailable")
            }
          />
          <HeadshotMetaField
            label={t("meta.faceCount")}
            value={String(currentMaterialization?.face_count ?? 0)}
          />
          <HeadshotMetaField
            label={t("meta.materializedAt")}
            value={
              currentMaterialization?.materialized_at
                ? formatDateTime(currentMaterialization.materialized_at, locale)
                : t("meta.notAvailable")
            }
          />
        </div>
      ) : null}

      {headshotMatching.previewUrl ? (
        <div className="mt-4 space-y-3">
          <div className="relative mx-auto max-w-sm overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
            {/* Signed storage previews are rendered directly to avoid next/image host config churn for this bounded flow. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={headshotMatching.previewUrl}
              alt={t("previewAlt")}
              className="block h-auto w-full"
            />
            {headshotMatching.candidateFaces.map((face) => {
              const style = resolveFaceBoxStyle(face, currentMaterialization);
              if (!style) {
                return null;
              }

              return (
                <div
                  key={face.id}
                  className={`absolute border-2 ${
                    face.isSelected
                      ? "border-emerald-500 shadow-[0_0_0_1px_rgba(16,185,129,0.35)]"
                      : "border-amber-400"
                  }`}
                  style={style}
                >
                  <span className="absolute left-0 top-0 -translate-y-full rounded-sm bg-zinc-900 px-1.5 py-0.5 text-[11px] font-medium text-white">
                    {t("faceSelection.faceLabel", { index: face.faceRank })}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="text-xs text-zinc-600">{t("previewHelp")}</p>
        </div>
      ) : null}

      {showFaceChooser ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-900">{t("faceSelection.title")}</p>
          <p className="mt-1 text-sm text-amber-900">{t("faceSelection.help")}</p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {headshotMatching.candidateFaces.map((face) => (
              <button
                key={face.id}
                type="button"
                disabled={isSelectingFace !== null}
                onClick={() => {
                  void handleSelectFace(face.id);
                }}
                className={`rounded-lg border px-3 py-3 text-left text-sm ${
                  face.isSelected
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-amber-200 bg-white text-zinc-900 hover:bg-amber-100"
                } disabled:opacity-60`}
              >
                <p className="font-medium">{t("faceSelection.faceLabel", { index: face.faceRank })}</p>
                <p className="mt-1 text-xs text-zinc-600">
                  {t("faceSelection.metrics", {
                    area: Math.round(face.areaRatio * 100),
                    confidence: Math.round(face.detectionProbability * 100),
                  })}
                </p>
                <p className="mt-2 text-xs font-medium text-zinc-700">
                  {face.isSelected
                    ? t("faceSelection.selected")
                    : isSelectingFace === face.id
                      ? t("faceSelection.selecting")
                      : t("faceSelection.select")}
                </p>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
