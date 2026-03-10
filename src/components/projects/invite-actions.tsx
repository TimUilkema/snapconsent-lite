"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";

type InviteSharePanelProps = {
  invitePath: string;
  defaultShowQr?: boolean;
  defaultShowUrl?: boolean;
};

function resolveBrowserInviteUrl(invitePath: string) {
  if (invitePath.startsWith("http://") || invitePath.startsWith("https://")) {
    return invitePath;
  }

  if (typeof window === "undefined") {
    return invitePath;
  }

  return new URL(invitePath, window.location.origin).toString();
}

export function InviteSharePanel({
  invitePath,
  defaultShowQr = false,
  defaultShowUrl = false,
}: InviteSharePanelProps) {
  const [showUrl, setShowUrl] = useState(defaultShowUrl);
  const [showQr, setShowQr] = useState(defaultShowQr);
  const [shareUrl, setShareUrl] = useState(invitePath);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  useEffect(() => {
    setShareUrl(resolveBrowserInviteUrl(invitePath));
  }, [invitePath]);

  function handleToggleQr() {
    setShowQr((prev) => !prev);
  }

  useEffect(() => {
    let isActive = true;

    async function buildQr() {
      if (!showQr) {
        return;
      }
      try {
        const dataUrl = await QRCode.toDataURL(shareUrl, { margin: 1, width: 220 });
        if (isActive) {
          setQrDataUrl(dataUrl);
          setQrError(null);
        }
      } catch {
        if (isActive) {
          setQrError("Unable to generate QR code.");
        }
      }
    }

    void buildQr();

    return () => {
      isActive = false;
    };
  }, [shareUrl, showQr]);

  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          onClick={() => setShowUrl((prev) => !prev)}
        >
          {showUrl ? "Hide URL" : "Show URL"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          onClick={handleToggleQr}
        >
          {showQr ? "Hide QR" : "Show QR"}
        </button>
        <a
          className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-50"
          href={shareUrl}
          target="_blank"
          rel="noreferrer"
        >
          Fill in form here
        </a>
      </div>
      {showUrl ? (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-500">Invite URL</span>
          <input
            readOnly
            value={shareUrl}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2"
          />
        </label>
      ) : null}
      {showQr ? (
        <div className="rounded-lg border border-zinc-200 bg-white p-3">
          {qrDataUrl ? (
            <Image src={qrDataUrl} alt="Invite QR code" width={220} height={220} unoptimized />
          ) : null}
          {qrError ? <p className="mt-2 text-sm text-red-700">{qrError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type InviteActionsProps = {
  inviteId: string;
  projectId: string;
  invitePath: string | null;
  isShareable: boolean;
  isRevokable: boolean;
};

export function InviteActions({
  inviteId,
  projectId,
  invitePath,
  isShareable,
  isRevokable,
}: InviteActionsProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedInvitePath = useMemo(() => {
    if (!invitePath) {
      return null;
    }

    if (invitePath.startsWith("http://") || invitePath.startsWith("https://")) {
      try {
        const parsed = new URL(invitePath);
        return `${parsed.pathname}${parsed.search}`;
      } catch {
        return null;
      }
    }

    return invitePath.startsWith("/") ? invitePath : null;
  }, [invitePath]);

  async function handleRevoke() {
    if (!isRevokable) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/invites/${inviteId}/revoke`, {
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        setError(payload?.message ?? "Unable to revoke invite.");
        return;
      }

      router.refresh();
    } catch {
      setError("Unable to revoke invite.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-2">
      {normalizedInvitePath && isShareable ? (
        <InviteSharePanel invitePath={normalizedInvitePath} />
      ) : null}
      {isRevokable ? (
        <button
          type="button"
          onClick={handleRevoke}
          disabled={isSubmitting}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {isSubmitting ? "Revoking..." : "Remove invite link"}
        </button>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
