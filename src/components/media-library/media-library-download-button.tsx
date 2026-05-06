"use client";

import Link from "next/link";
import type { ReactNode } from "react";

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
  children,
}: {
  href: string;
  label: string;
  className: string;
  requiresConfirmation: boolean;
  confirmationMessage: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={className}
      aria-label={children ? label : undefined}
      title={label}
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
      {children ?? label}
    </Link>
  );
}
