export function normalizeRelativePath(value: FormDataEntryValue | string | null | undefined, fallback: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return fallback;
  }

  if (!normalized.startsWith("/") || normalized.startsWith("//")) {
    return fallback;
  }

  return normalized;
}

export function appendQueryToRelativePath(path: string, params: Record<string, string | null | undefined>) {
  const [pathname, queryString] = path.split("?", 2);
  const searchParams = new URLSearchParams(queryString ?? "");

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string" && value.length > 0) {
      searchParams.set(key, value);
    }
  });

  const suffix = searchParams.toString();
  return suffix.length > 0 ? `${pathname}?${suffix}` : pathname;
}
