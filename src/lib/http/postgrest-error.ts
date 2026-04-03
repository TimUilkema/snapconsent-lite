type PostgrestErrorLike = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
  statusCode?: number | null;
};

export type NormalizedPostgrestError = {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
  httpStatus: number | null;
};

function inferRequestUriTooLarge(message: string, details: string | null) {
  const haystack = `${message}\n${details ?? ""}`;
  return /(?:^|\b)414(?:\b|$)|request-uri too large|uri too long/i.test(haystack);
}

export function normalizePostgrestError(
  error: unknown,
  fallbackCode = "postgrest_error",
): NormalizedPostgrestError {
  if (error instanceof Error) {
    const candidateWithCode = error as Error & { code?: string | null; details?: string | null; hint?: string | null };
    const message = String(candidateWithCode.message ?? "Unknown PostgREST error.").trim() || "Unknown PostgREST error.";
    const details = typeof candidateWithCode.details === "string" && candidateWithCode.details.trim().length > 0
      ? candidateWithCode.details.trim()
      : null;
    const hint = typeof candidateWithCode.hint === "string" && candidateWithCode.hint.trim().length > 0
      ? candidateWithCode.hint.trim()
      : null;
    const rawCode = typeof candidateWithCode.code === "string" && candidateWithCode.code.trim().length > 0
      ? candidateWithCode.code.trim()
      : null;

    if (inferRequestUriTooLarge(message, details)) {
      return {
        code: "request_uri_too_large",
        message,
        details,
        hint,
        httpStatus: 414,
      };
    }

    return {
      code: rawCode ?? fallbackCode,
      message,
      details,
      hint,
      httpStatus: null,
    };
  }

  const candidate = (error ?? {}) as PostgrestErrorLike;
  const message = String(candidate.message ?? "Unknown PostgREST error.").trim() || "Unknown PostgREST error.";
  const details = typeof candidate.details === "string" && candidate.details.trim().length > 0
    ? candidate.details.trim()
    : null;
  const hint = typeof candidate.hint === "string" && candidate.hint.trim().length > 0
    ? candidate.hint.trim()
    : null;
  const rawCode = typeof candidate.code === "string" && candidate.code.trim().length > 0
    ? candidate.code.trim()
    : null;
  const statusValue =
    typeof candidate.status === "number" && Number.isFinite(candidate.status)
      ? candidate.status
      : typeof candidate.statusCode === "number" && Number.isFinite(candidate.statusCode)
        ? candidate.statusCode
        : null;

  if (inferRequestUriTooLarge(message, details)) {
    return {
      code: "request_uri_too_large",
      message,
      details,
      hint,
      httpStatus: 414,
    };
  }

  return {
    code: rawCode ?? fallbackCode,
    message,
    details,
    hint,
    httpStatus: statusValue,
  };
}
