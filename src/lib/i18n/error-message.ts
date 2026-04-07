type TranslationFunction = {
  (key: string): string;
  has?: (key: string) => boolean;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
} | null;

export function resolveLocalizedApiError(
  t: TranslationFunction,
  payload: ApiErrorPayload,
  fallbackKey: string,
) {
  const code = payload?.error;
  if (code) {
    const codeKey = `codes.${code}`;
    if (typeof t.has === "function" && t.has(codeKey)) {
      return t(codeKey);
    }
  }

  return t(fallbackKey);
}
