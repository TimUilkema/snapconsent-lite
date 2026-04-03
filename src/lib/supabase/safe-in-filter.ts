export const SAFE_IN_FILTER_CHUNK_SIZE = 40;

export function uniqueValues<T>(values: T[]) {
  return Array.from(new Set(values));
}

export function chunkValues<T>(values: T[], chunkSize = SAFE_IN_FILTER_CHUNK_SIZE) {
  const unique = uniqueValues(values);
  if (unique.length === 0) {
    return [] as T[][];
  }

  const normalizedChunkSize = Number.isFinite(chunkSize) && chunkSize > 0
    ? Math.floor(chunkSize)
    : SAFE_IN_FILTER_CHUNK_SIZE;
  const chunks: T[][] = [];

  for (let index = 0; index < unique.length; index += normalizedChunkSize) {
    chunks.push(unique.slice(index, index + normalizedChunkSize));
  }

  return chunks;
}

export async function runChunkedRead<TValue, TResult>(
  values: TValue[],
  execute: (chunk: TValue[]) => Promise<TResult[]>,
  chunkSize = SAFE_IN_FILTER_CHUNK_SIZE,
) {
  const results: TResult[] = [];

  for (const chunk of chunkValues(values, chunkSize)) {
    const chunkResults = await execute(chunk);
    results.push(...chunkResults);
  }

  return results;
}

export async function runChunkedMutation<TValue>(
  values: TValue[],
  execute: (chunk: TValue[]) => Promise<void>,
  chunkSize = SAFE_IN_FILTER_CHUNK_SIZE,
) {
  for (const chunk of chunkValues(values, chunkSize)) {
    await execute(chunk);
  }
}
