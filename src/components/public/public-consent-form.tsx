"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

import { ConsentFormLayoutRenderer } from "@/components/consent/consent-form-layout-renderer";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import type { PublicConsentInitialValues } from "@/lib/consent/public-consent-prefill";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import type { ConsentFormLayoutDefinition } from "@/lib/templates/form-layout";
import type { StructuredFieldsDefinition } from "@/lib/templates/structured-fields";

type PublicConsentFormProps = {
  token: string;
  consentText: string | null;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  formLayoutDefinition: ConsentFormLayoutDefinition;
  initialValues?: PublicConsentInitialValues | null;
  upgradeMode?: boolean;
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

export function PublicConsentForm({
  token,
  consentText,
  structuredFieldsDefinition,
  formLayoutDefinition,
  initialValues,
}: PublicConsentFormProps) {
  const t = useTranslations("publicInvite.form");
  const tErrors = useTranslations("errors");
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [subjectName, setSubjectName] = useState(initialValues?.subjectName ?? "");
  const [subjectEmail, setSubjectEmail] = useState(initialValues?.subjectEmail ?? "");
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [structuredFieldValues, setStructuredFieldValues] = useState<
    Record<string, string | string[] | null | undefined>
  >(() => ({ ...(initialValues?.structuredFieldValues ?? {}) }));
  const [faceMatchOptIn, setFaceMatchOptIn] = useState(initialValues?.faceMatchOptIn ?? false);
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
        if (!consentAcknowledged) {
          event.preventDefault();
          setError(t("errors.consentAcknowledgementRequired"));
          return;
        }

        if (faceMatchOptIn && !headshotAssetId) {
          event.preventDefault();
          setError(t("errors.headshotRequiredBeforeSubmit"));
        }
      }}
    >
      <ConsentFormLayoutRenderer
        consentText={consentText}
        formLayoutDefinition={formLayoutDefinition}
        structuredFieldsDefinition={structuredFieldsDefinition}
        strings={{
          fullNameLabel: t("fullNameLabel"),
          emailLabel: t("emailLabel"),
          scopeLabel: t("scopeLabel"),
          durationLabel: t("durationLabel"),
          requiredField: t("requiredField"),
          selectPlaceholder: t("selectPlaceholder"),
          emptySelectionOption: t("emptySelectionOption"),
          emptyCheckboxOptionLabel: t("emptyCheckboxOptionLabel"),
          faceMatchOptIn: t("faceMatchOptIn"),
          headshotRequiredTitle: t("headshotRequiredTitle"),
          headshotRequiredBody: t("headshotRequiredBody"),
          consentTextHeading: t("consentTextTitle"),
          consentTextUnavailable: t("consentTextUnavailable"),
          consentAcknowledgementLabel: t("consentAcknowledgementLabel"),
        }}
        values={{
          subjectName,
          subjectEmail,
          consentAcknowledged,
          faceMatchOptIn,
          structuredFieldValues,
        }}
        onSubjectNameChange={(value) => {
          setSubjectName(value);
          setError(null);
        }}
        onSubjectEmailChange={(value) => {
          setSubjectEmail(value);
          setError(null);
        }}
        onConsentAcknowledgedChange={(value) => {
          setConsentAcknowledged(value);
          setError(null);
        }}
        onStructuredFieldChange={(fieldKey, value) => {
          setStructuredFieldValues((current) => ({
            ...current,
            [fieldKey]: value,
          }));
          setError(null);
        }}
        onFaceMatchOptInChange={(enabled) => {
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
        faceMatchDetails={
          <>
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
            {headshotAssetId ? <p className="text-xs text-emerald-700">{t("headshotReady")}</p> : null}
            {isUploading ? (
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
                  <div className="h-full bg-zinc-900 transition-[width]" style={{ width: `${progressPercent}%` }} />
                </div>
                <p className="text-xs text-zinc-600">{progressPercent}%</p>
              </div>
            ) : null}
          </>
        }
      />

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
