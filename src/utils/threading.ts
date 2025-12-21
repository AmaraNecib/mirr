import { cpus } from "os";

/** Get optimal thread count */
export function getOptimalThreadCount(userSpecified?: number): number {
  if (userSpecified && userSpecified > 0) {
    return Math.min(userSpecified, cpus().length);
  }
  // Use 75% of available cores for optimal performance
  return Math.max(1, Math.floor(cpus().length * 0.75));
}

/** Process array in parallel batches */
export async function parallelMap<T, R>(
  items: T[],
  processor: (item: T, index: number) => Promise<R>,
  threadCount: number
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const batchSize = Math.ceil(items.length / threadCount);
  const batches: Promise<void>[] = [];
  
  for (let i = 0; i < threadCount; i++) {
    const start = i * batchSize;
    const end = Math.min(start + batchSize, items.length);
    
    if (start >= items.length) break;
    
    batches.push(
      (async () => {
        for (let j = start; j < end; j++) {
          results[j] = await processor(items[j], j);
        }
      })()
    );
  }
  
  await Promise.all(batches);
  return results;
}

/** Split work into chunks for parallel processing */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
