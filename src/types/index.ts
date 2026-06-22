/**
 * mirr public types.
 *
 * Only the types that callers and tests actually use. Internal implementation
 * types (palettes, blocks, etc.) are not exported — the project is True Color
 * only and never touches that path.
 */

import type { EncryptionService } from "../core/encryption.ts";

/** RSA public + private key pair as PEM strings. */
export interface EncryptionKeys {
  publicKey?: string;
  privateKey?: string;
}

/** Encoding configuration recorded in the video header. */
export interface EncodingConfig {
  /** Always 0 — True Color, no quantization. */
  paletteSize: number;
  /** Always 1 — one byte per pixel channel. */
  blockSize: number;
  frameWidth: number;
  frameHeight: number;
  /** When true, the payload was encrypted with hybrid RSA + AES-GCM. */
  encrypted: boolean;
  compressed: boolean;
  version: number;
}

/** File metadata recorded in the video header. */
export interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
  checksum: string;
  createdAt: Date;
  modifiedAt: Date;
}

/** Top-level video header. */
export interface GlobalHeader {
  magic: Uint8Array;
  version: number;
  config: EncodingConfig;
  metadata: FileMetadata;
  dataLength: number;
  headerSize: number;
}

/** Codec accepted by the FFmpeg writer. */
export type VideoCodec = "libx264rgb" | "libx265" | "ffv1";

/** Options for the encode engine. */
export interface EncodeOptions {
  inputFile: string;
  outputPath: string;
  compress: boolean;
  outputFormat: "video";
  fps: number;
  frameWidth: number;
  frameHeight: number;
  showProgress: boolean;
  keepFrames: boolean;
  mimeType?: string;
  codec: VideoCodec;
  /** When true, encrypt the payload with hybrid RSA + AES-GCM before encoding. */
  encrypt: boolean;
  /** Injected by the engine so the pipeline doesn't create its own. */
  encryptionService?: EncryptionService | null;
  /**
   * Original size in bytes BEFORE the engine's archive step (directories only).
   * When set, this is used in the metadata instead of the archive file size.
   */
  originalSize?: number;
  /** Display name for the original (pre-archive) input, e.g. the directory name. */
  originalName?: string;
}

/** Options for the decode engine. */
export interface DecodeOptions {
  inputPath: string;
  outputPath: string;
  /** undefined → auto-extract for archives; false → always write raw; true → always extract. */
  extract: boolean | undefined;
  paletteSize: number;
  blockSize: number;
  showProgress: boolean;
  /**
   * If true, stop after decryption; do not decompress.
   * Output = the raw compressed bytes (decrypted, but still Brotli-compressed).
   * Use this to inspect the compressed form or to re-archive without re-compressing.
   */
  keepCompressed?: boolean;
}

/** Result returned by the encode/decode engine. */
export interface EngineResult {
  success: boolean;
  /** Path to the produced output (file or directory; array for multi-part). */
  data?: string | string[];
  error?: string;
}

/** Legacy result type used by the pipeline internally. */
export interface PipelineResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
