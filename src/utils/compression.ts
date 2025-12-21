import { gzipSync, gunzipSync } from "bun";

/** Compress data using gzip */
export function compress(data: Uint8Array): Uint8Array {
  return gzipSync(new Uint8Array(data.buffer as ArrayBuffer));
}

/** Decompress data using gzip */
export function decompress(data: Uint8Array): Uint8Array {
  return gunzipSync(new Uint8Array(data.buffer as ArrayBuffer));
}

/** Calculate compression ratio */
export function getCompressionRatio(original: number, compressed: number): number {
  return ((1 - compressed / original) * 100);
}
