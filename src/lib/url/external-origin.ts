import { HttpError } from "@/lib/http/errors";

function normalizeOrigin(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(500, "invalid_app_origin", "APP_ORIGIN is not configured.");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new HttpError(500, "invalid_app_origin", "APP_ORIGIN is invalid.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new HttpError(500, "invalid_app_origin", "APP_ORIGIN protocol is invalid.");
  }

  return parsed.origin;
}

export function getExternalOrigin() {
  return normalizeOrigin(process.env.APP_ORIGIN ?? "");
}

export function buildExternalUrl(path: string) {
  if (!path.startsWith("/")) {
    throw new HttpError(500, "invalid_external_path", "External path must start with '/'.");
  }

  return `${getExternalOrigin()}${path}`;
}
