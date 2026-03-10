"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";

type HeadshotConsentOption = {
  id: string;
  label: string;
};

type HeadshotReplacementFormProps = {
  projectId: string;
  consents: HeadshotConsentOption[];
};

type CreateAssetResponse =
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

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

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

export function HeadshotReplacementForm({ projectId, consents }: HeadshotReplacementFormProps) {
  const router = useRouter();
  const [selectedConsentId, setSelectedConsentId] = useState(consents[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressPercent, setProgressPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const acceptValue = useMemo(() => ACCEPTED_TYPES.join(","), []);

  async function handleReplace() {
    if (!selectedConsentId) {
      setError("Select a consent before replacing a headshot.");
      return;
    }

    if (!file) {
      setError("Select a new headshot image first.");
      return;
    }

    setError(null);
    setSuccess(null);
    setProgressPercent(0);
    setIsSubmitting(true);

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
        | (CreateAssetResponse & { message?: string })
        | null;

      if (!createResponse.ok || !createPayload) {
        setError(createPayload?.message ?? "Unable to create replacement headshot upload.");
        return;
      }

      if ("skipUpload" in createPayload && createPayload.skipUpload) {
        setError("Unable to replace headshot with this image.");
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
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ consentIds: [] }),
        },
      );

      if (!finalizeResponse.ok) {
        const finalizePayload = (await finalizeResponse.json().catch(() => null)) as
          | { message?: string }
          | null;
        setError(finalizePayload?.message ?? "Unable to finalize replacement headshot upload.");
        return;
      }

      const replaceResponse = await fetch(
        `/api/projects/${projectId}/consents/${selectedConsentId}/headshot`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ assetId: createPayload.assetId }),
        },
      );

      const replacePayload = (await replaceResponse.json().catch(() => null)) as
        | { message?: string }
        | null;

      if (!replaceResponse.ok) {
        setError(replacePayload?.message ?? "Unable to replace headshot.");
        return;
      }

      setProgressPercent(100);
      setSuccess("Headshot replaced successfully.");
      setFile(null);
      router.refresh();
    } catch {
      setError("Unable to replace headshot right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="content-card space-y-4 rounded-2xl p-4">
      <h3 className="text-lg font-semibold text-zinc-900">Replace consent headshot</h3>
      {consents.length > 0 ? (
        <>
          <label className="block text-sm text-zinc-800">
            <span className="mb-1 block font-medium">Consent</span>
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
              value={selectedConsentId}
              disabled={isSubmitting}
              onChange={(event) => setSelectedConsentId(event.target.value)}
            >
              {consents.map((consent) => (
                <option key={consent.id} value={consent.id}>
                  {consent.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm text-zinc-800">
            <span className="mb-1 block font-medium">New headshot</span>
            <input
              type="file"
              accept={acceptValue}
              disabled={isSubmitting}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setError(null);
                setSuccess(null);
                setProgressPercent(0);
              }}
              className="block w-full text-sm"
            />
          </label>
          <button
            type="button"
            onClick={handleReplace}
            disabled={isSubmitting || !file || !selectedConsentId}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {isSubmitting ? "Replacing..." : "Replace headshot"}
          </button>
          {isSubmitting ? (
            <div className="space-y-1">
              <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
                <div className="h-full bg-zinc-900 transition-[width]" style={{ width: `${progressPercent}%` }} />
              </div>
              <p className="text-xs text-zinc-600">{progressPercent}%</p>
            </div>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-zinc-600">
          No consents currently qualify for replacement. A linked headshot and facial matching opt-in are required.
        </p>
      )}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
    </section>
  );
}
