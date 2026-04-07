"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

type Props = {
  projectId: string;
  consentId: string;
};

type CreateAssetResponse =
  | {
      skipUpload: true;
      duplicate: true;
    }
  | {
      assetId: string;
      signedUrl: string;
    };

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

export function ConsentHeadshotReplaceControl({ projectId, consentId }: Props) {
  const t = useTranslations("projects.headshotReplace");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function replaceHeadshot(file: File) {
    setIsReplacing(true);
    setProgressPercent(0);
    setError(null);
    setSuccess(null);

    try {
      const createResponse = await fetch(`/api/projects/${projectId}/assets`, {
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
          consentIds: [],
          duplicatePolicy: "upload_anyway",
        }),
      });

      const createPayload = (await createResponse.json().catch(() => null)) as
        | (CreateAssetResponse & { error?: string; message?: string })
        | null;

      if (!createResponse.ok || !createPayload) {
        setError(resolveLocalizedApiError(tErrors, createPayload, "generic"));
        return;
      }

      if ("skipUpload" in createPayload && createPayload.skipUpload) {
        setError(t("errors.invalidHeadshot"));
        return;
      }

      if (!("signedUrl" in createPayload) || !("assetId" in createPayload)) {
        setError(t("errors.createUpload"));
        return;
      }

      await uploadWithProgress(file, createPayload.signedUrl, (loaded) => {
        const percent = file.size > 0 ? Math.round((loaded / file.size) * 100) : 0;
        setProgressPercent(percent);
      });

      const finalizeResponse = await fetch(
        `/api/projects/${projectId}/assets/${createPayload.assetId}/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ consentIds: [] }),
        },
      );

      if (!finalizeResponse.ok) {
        const finalizePayload = (await finalizeResponse.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        setError(resolveLocalizedApiError(tErrors, finalizePayload, "generic"));
        return;
      }

      const replaceResponse = await fetch(`/api/projects/${projectId}/consents/${consentId}/headshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assetId: createPayload.assetId }),
      });

      const replacePayload = (await replaceResponse.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;

      if (!replaceResponse.ok) {
        setError(resolveLocalizedApiError(tErrors, replacePayload, "generic"));
        return;
      }

      setProgressPercent(100);
      setSuccess(t("success"));
      router.refresh();
    } catch {
      setError(t("errors.fallback"));
    } finally {
      setIsReplacing(false);
    }
  }

  function handleSelectedFile(nextFile: File | null) {
    if (!nextFile) {
      return;
    }
    setShowSourcePicker(false);
    void replaceHeadshot(nextFile);
  }

  return (
    <div className="mt-3 space-y-2 rounded-xl border border-zinc-200 bg-white p-3">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="user"
        className="hidden"
        disabled={isReplacing}
        onChange={(event) => {
          handleSelectedFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        disabled={isReplacing}
        onChange={(event) => {
          handleSelectedFile(event.target.files?.[0] ?? null);
          event.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={isReplacing}
        onClick={() => {
          if (isMobileDevice()) {
            setShowSourcePicker(true);
            return;
          }
          fileRef.current?.click();
        }}
        className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {isReplacing ? t("replacing") : t("replace")}
      </button>
      {showSourcePicker ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={isReplacing}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800"
            onClick={() => {
              setShowSourcePicker(false);
              if (cameraRef.current) {
                cameraRef.current.value = "";
                cameraRef.current.click();
              }
            }}
          >
            {t("takePicture")}
          </button>
          <button
            type="button"
            disabled={isReplacing}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800"
            onClick={() => {
              setShowSourcePicker(false);
              if (fileRef.current) {
                fileRef.current.value = "";
                fileRef.current.click();
              }
            }}
          >
            {t("selectFile")}
          </button>
        </div>
      ) : null}
      {isReplacing ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
            <div className="h-full bg-zinc-900 transition-[width]" style={{ width: `${progressPercent}%` }} />
          </div>
          <p className="text-xs text-zinc-600">{progressPercent}%</p>
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
    </div>
  );
}
