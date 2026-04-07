"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

type PublicConsentFormProps = {
  token: string;
  consentText: string | null;
  consentVersion: string | null;
};

type CreateHeadshotResponse =
  | {
      skipUpload: true;
      duplicate: true;
    }
  | {
      assetId: string;
      signedUrl: string;
      storageBucket: string;
      storagePath: string;
    };

const MOBILE_HEADSHOT_ACCEPT = "image/*";

function isMobileDevice() {
  if (typeof window === "undefined") {
    return false;
  }

  const ua = window.navigator.userAgent;
  const coarsePointer = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || coarsePointer;
}

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

export function PublicConsentForm({ token, consentText, consentVersion }: PublicConsentFormProps) {
  const t = useTranslations("publicInvite.form");
  const tErrors = useTranslations("errors");
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [faceMatchOptIn, setFaceMatchOptIn] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [headshotAssetId, setHeadshotAssetId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleSelectedFile(nextFile: File | null) {
    setShowSourcePicker(false);
    setSelectedFile(nextFile);
    setHeadshotAssetId(null);
    setError(null);
    setSuccess(null);
    setProgressPercent(0);
    if (nextFile) {
      void uploadSelectedHeadshot(nextFile);
    }
  }

  function openHeadshotPicker() {
    if (isMobileDevice()) {
      setShowSourcePicker(true);
      return;
    }

    if (fileInputRef.current) {
      setShowSourcePicker(false);
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }
  async function uploadSelectedHeadshot(file: File) {
    if (!faceMatchOptIn) {
      setError(t("errors.enableFaceMatchBeforeUpload"));
      return;
    }

    setError(null);
    setSuccess(null);
    setIsUploading(true);
    setProgressPercent(0);

    try {
      const createResponse = await fetch(`/api/public/invites/${token}/headshot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          originalFilename: file.name,
          contentType: file.type,
          fileSizeBytes: file.size,
          assetType: "headshot",
          duplicatePolicy: "upload_anyway",
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | (CreateHeadshotResponse & { error?: string; message?: string })
        | null;

      if (!createResponse.ok || !createPayload) {
        setError(resolveLocalizedApiError(tErrors, createPayload, "generic"));
        return;
      }

      if ("skipUpload" in createPayload && createPayload.skipUpload) {
        setError(t("errors.skipUpload"));
        return;
      }

      if (!("signedUrl" in createPayload) || !("assetId" in createPayload)) {
        setError(t("errors.prepareUpload"));
        return;
      }

      await uploadWithProgress(file, createPayload.signedUrl, (loaded) => {
        const percent = file.size > 0 ? Math.round((loaded / file.size) * 100) : 0;
        setProgressPercent(percent);
      });

      const finalizeResponse = await fetch(
        `/api/public/invites/${token}/headshot/${createPayload.assetId}/finalize`,
        {
          method: "POST",
        },
      );

      if (!finalizeResponse.ok) {
        const finalizePayload = (await finalizeResponse.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        setError(resolveLocalizedApiError(tErrors, finalizePayload, "generic"));
        return;
      }

      setHeadshotAssetId(createPayload.assetId);
      setSuccess(t("success.headshotUploaded"));
      setProgressPercent(100);
    } catch {
      setError(t("errors.uploadNow"));
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <form
      action={`/i/${token}/consent`}
      method="post"
      className="content-card space-y-5 rounded-2xl p-4 sm:p-5"
      onSubmit={(event) => {
        if (faceMatchOptIn && !headshotAssetId) {
          event.preventDefault();
          setError(t("errors.headshotRequiredBeforeSubmit"));
        }
      }}
    >
      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("fullNameLabel")}</span>
        <input
          name="full_name"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
          minLength={2}
          maxLength={160}
          required
        />
      </label>
      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("emailLabel")}</span>
        <input
          name="email"
          type="email"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
          required
        />
      </label>

      <label className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
        <input
          type="checkbox"
          checked={faceMatchOptIn}
          onChange={(event) => {
            const enabled = event.target.checked;
            setFaceMatchOptIn(enabled);
            setError(null);
            setSuccess(null);
            if (!enabled) {
              setHeadshotAssetId(null);
              setSelectedFile(null);
              setShowSourcePicker(false);
              setProgressPercent(0);
              if (cameraInputRef.current) {
                cameraInputRef.current.value = "";
              }
              if (fileInputRef.current) {
                fileInputRef.current.value = "";
              }
            }
          }}
        />
        <span>{t("faceMatchOptIn")}</span>
      </label>

      {faceMatchOptIn ? (
        <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-800">
          <p className="font-medium">{t("headshotRequiredTitle")}</p>
          <p className="text-xs text-zinc-700">
            {t("headshotRequiredBody")}
          </p>
          <input
            ref={cameraInputRef}
            type="file"
            accept={MOBILE_HEADSHOT_ACCEPT}
            capture="user"
            disabled={isUploading}
            onChange={(event) => handleSelectedFile(event.target.files?.[0] ?? null)}
            className="hidden"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept={MOBILE_HEADSHOT_ACCEPT}
            disabled={isUploading}
            onChange={(event) => handleSelectedFile(event.target.files?.[0] ?? null)}
            className="hidden"
          />
          <button
            type="button"
            disabled={isUploading}
            onClick={openHeadshotPicker}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {isUploading ? t("uploadingHeadshot") : t("uploadHeadshot")}
          </button>
          {showSourcePicker ? (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isUploading}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800"
                onClick={() => {
                  setShowSourcePicker(false);
                  if (cameraInputRef.current) {
                    cameraInputRef.current.value = "";
                    cameraInputRef.current.click();
                  }
                }}
              >
                {t("takePicture")}
              </button>
              <button
                type="button"
                disabled={isUploading}
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800"
                onClick={() => {
                  setShowSourcePicker(false);
                  if (fileInputRef.current) {
                    fileInputRef.current.value = "";
                    fileInputRef.current.click();
                  }
                }}
              >
                {t("selectFile")}
              </button>
            </div>
          ) : null}
          {selectedFile ? (
            <p className="text-xs text-zinc-700">{t("selectedFile", { filename: selectedFile.name })}</p>
          ) : null}
          {headshotAssetId ? (
            <p className="text-xs text-emerald-700">{t("headshotReady")}</p>
          ) : null}
          {isUploading ? (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
                <div className="h-full bg-zinc-900 transition-[width]" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="text-xs text-zinc-600">{progressPercent}%</p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
        <p className="font-medium">{t("consentTextTitle", { version: consentVersion ?? t("unknownVersion") })}</p>
        <p className="mt-2">{consentText ?? t("consentTextUnavailable")}</p>
      </div>

      <input type="hidden" name="face_match_opt_in" value={faceMatchOptIn ? "1" : "0"} />
      <input type="hidden" name="headshot_asset_id" value={faceMatchOptIn ? (headshotAssetId ?? "") : ""} />

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

      <button
        type="submit"
        disabled={isUploading}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {t("submit")}
      </button>
    </form>
  );
}
