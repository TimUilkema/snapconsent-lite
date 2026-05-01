"use client";

import Link from "next/link";

export function shouldContinueMediaLibraryDownload(input: {
  requiresConfirmation: boolean;
  confirmationMessage: string;
  confirmImpl?: (message: string) => boolean;
}) {
  if (!input.requiresConfirmation) {
    return true;
  }

  return (input.confirmImpl ?? window.confirm)(input.confirmationMessage);
}

export function MediaLibraryDownloadButton({
  href,
  label,
  className,
  requiresConfirmation,
  confirmationMessage,
}: {
  href: string;
  label: string;
  className: string;
  requiresConfirmation: boolean;
  confirmationMessage: string;
}) {
  return (
    <Link
      href={href}
      className={className}
      onClick={(event) => {
        if (
          !shouldContinueMediaLibraryDownload({
            requiresConfirmation,
            confirmationMessage,
          })
        ) {
          event.preventDefault();
        }
      }}
    >
      {label}
    </Link>
  );
}
