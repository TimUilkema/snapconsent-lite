export function createIdempotencyKey(): string {
  if (typeof globalThis !== "undefined" && globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  if (typeof globalThis !== "undefined" && globalThis.crypto?.getRandomValues) {
    const bytes = new Uint8Array(16);
    globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  const now = Date.now().toString(36);
  const randA = Math.random().toString(36).slice(2, 12);
  const randB = Math.random().toString(36).slice(2, 12);
  return `${now}-${randA}-${randB}`;
}
