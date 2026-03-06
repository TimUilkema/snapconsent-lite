const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopbackHost(hostname: string) {
  return LOOPBACK_HOSTS.has(hostname);
}

function parseHostHeaderHostname(hostHeader: string | null | undefined) {
  if (!hostHeader) {
    return null;
  }

  const firstHost = hostHeader.split(",")[0]?.trim();
  if (!firstHost) {
    return null;
  }

  try {
    return new URL(`http://${firstHost}`).hostname;
  } catch {
    return null;
  }
}

export function resolveLoopbackStorageUrlForHostname(
  signedUrl: string,
  currentHostname: string | null | undefined,
) {
  let parsed: URL;
  try {
    parsed = new URL(signedUrl);
  } catch {
    return signedUrl;
  }

  if (!isLoopbackHost(parsed.hostname)) {
    return signedUrl;
  }

  if (!currentHostname || isLoopbackHost(currentHostname)) {
    return signedUrl;
  }

  parsed.hostname = currentHostname;
  return parsed.toString();
}

export function resolveLoopbackStorageUrlForHostHeader(
  signedUrl: string,
  hostHeader: string | null | undefined,
) {
  return resolveLoopbackStorageUrlForHostname(signedUrl, parseHostHeaderHostname(hostHeader));
}
