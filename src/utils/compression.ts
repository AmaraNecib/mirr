/**
 * Compression utilities.
 *
 * Brotli is the only algorithm we use (lossless + good ratio on most data).
 * `compressSync` and `decompressSync` work on in-memory buffers; the streaming
 * variants `compressFileToFile` / `decompressFileToFile` are used by the
 * pipeline for large inputs to avoid round-tripping through memory.
 */

import { brotliCompressSync, brotliDecompressSync, createBrotliCompress, createBrotliDecompress } from "zlib";
import { pipeline } from "stream/promises";
import { createReadStream, createWriteStream } from "fs";

/** Compress a buffer with Brotli (synchronous, in-memory). */
export function compress(data: Uint8Array): Uint8Array {
  return brotliCompressSync(data);
}

/** Decompress a Brotli buffer (synchronous, in-memory). */
export function decompress(data: Uint8Array): Uint8Array {
  return brotliDecompressSync(data);
}

/** Stream a file through Brotli compressor → output file. */
export async function compressFileToFile(inputPath: string, outputPath: string): Promise<void> {
  await pipeline(
    createReadStream(inputPath),
    createBrotliCompress(),
    createWriteStream(outputPath)
  );
}

/** Stream a file through Brotli decompressor → output file. */
export async function decompressFileToFile(inputPath: string, outputPath: string): Promise<void> {
  await pipeline(
    createReadStream(inputPath),
    createBrotliDecompress(),
    createWriteStream(outputPath)
  );
}

/** Calculate compression ratio (saved %) for reporting. */
export function getCompressionRatio(original: number, compressed: number): number {
  if (original === 0) return 0;
  return (1 - compressed / original) * 100;
}