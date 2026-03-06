import { resolveLoopbackStorageUrlForHostname } from "@/lib/url/resolve-loopback-storage-url";

export function resolveSignedUploadUrlForBrowser(signedUrl: string) {
  if (typeof window === "undefined") {
    return signedUrl;
  }

  return resolveLoopbackStorageUrlForHostname(signedUrl, window.location.hostname);
}
