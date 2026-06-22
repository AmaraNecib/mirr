/**
 * Encoding pipeline — single-part only.
 *
 * Reads a file (or archived directory), optionally compresses with Brotli,
 * optionally encrypts with the provided EncryptionService, then writes the
 * resulting payload to a lossless video via FFmpeg.
 *
 * Multi-part handling lives in engine/multiPart.ts. This module only knows
 * about one input → one output video.
 */

import type { EncodeOptions, PipelineResult } from "../types/index.ts";
import { DEFAULT_CONFIG, createEncodingConfig, validateConfig } from "../config/settings.ts";
import { createArchive } from "../utils/archive.ts";
import { compress, compressFileToFile } from "../utils/compression.ts";
import { encodeToPixels, calculateRequiredFrames24Bit } from "../core/encoder.ts";
import { buildGlobalHeader, serializeHeader } from "../core/protocol.ts";
import { VideoOutputStream } from "../core/ffmpegStream.ts";
import { EncryptionService } from "../core/encryption.ts";
import { rmSync, mkdirSync, existsSync, statSync, type Stats } from "fs";
import { basename } from "path";

const IN_MEMORY_LIMIT = 50 * 1024 * 1024; // 50MB
const VIDEO_FILENAME = "output.mkv";

/** Encode a single part. Returns the path to the produced video. */
export async function encodePipeline(
  options: EncodeOptions
): Promise<PipelineResult<string>> {
  try {
    const stats = statSync(options.inputFile);

    if (stats.isDirectory() || stats.size > IN_MEMORY_LIMIT) {
      return await encodeFromFile(options, stats);
    }

    return await encodeInMemory(options, stats);
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ─── in-memory path (small files) ──────────────────────────────────────────
async function encodeInMemory(
  options: EncodeOptions,
  stats: Stats
): Promise<PipelineResult<string>> {
  const fileData = new Uint8Array(await Bun.file(options.inputFile).arrayBuffer());
  const metadata: FileMeta = {
    name: options.originalName ?? basename(options.inputFile),
    size: options.originalSize ?? stats.size,
    mimeType: options.mimeType || "application/octet-stream",
    checksum: "N/A",
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };

  const { payload, compressed, encrypted } = await transformPayload(
    fileData,
    options.compress,
    options.encryptionService ?? null
  );

  return writeVideo(payload, metadata, options, compressed, encrypted);
}

// ─── streaming path (large files, directories) ──────────────────────────────
async function encodeFromFile(
  options: EncodeOptions,
  stats: Stats
): Promise<PipelineResult<string>> {
  const isDirectory = stats.isDirectory();
  let inputToEncode = options.inputFile;
  const tempPaths: string[] = [];

  try {
    // 1. Archive directories so the header can name the resulting blob.
    if (isDirectory) {
      const result = await createArchive(options.inputFile);
      if (result.type === "file") {
        inputToEncode = result.path;
        tempPaths.push(result.path);
      } else {
        const tempArchive = `${options.inputFile}.mirr-archive-${Date.now()}.bin`;
        await Bun.write(tempArchive, result.data);
        inputToEncode = tempArchive;
        tempPaths.push(tempArchive);
      }
    }

    // 2. Compress (Brotli) → temp file. Only if the user asked for it AND it
    //    actually shrinks the data.
    let compressed = false;
    if (options.compress === true) {
      const compressedPath = `${inputToEncode}.br`;
      await compressFileToFile(inputToEncode, compressedPath);
      const compressedSize = statSync(compressedPath).size;
      if (compressedSize < statSync(inputToEncode).size) {
        tempPaths.push(inputToEncode); // delete the uncompressed original
        inputToEncode = compressedPath;
        tempPaths.push(compressedPath);
        compressed = true;
      } else {
        // Compression didn't help — discard the .br and keep the raw file.
        tempPaths.push(compressedPath);
      }
    }

    // 3. Read final payload into memory (bounded by multi-part chunk size).
    const payload = new Uint8Array(await Bun.file(inputToEncode).arrayBuffer());

    // 4. Encrypt if requested (produces a new payload).
    let encrypted = false;
    let finalPayload = payload;
    if (options.encryptionService) {
      finalPayload = new Uint8Array(await options.encryptionService.encrypt(payload));
      encrypted = true;
    }

    const finalStats = statSync(options.inputFile);
    const metadata: FileMeta = {
      name: options.originalName ?? (isDirectory ? "archive.bin" : basename(options.inputFile)),
      size: options.originalSize ?? Number(finalStats.size),
      mimeType: options.mimeType || (isDirectory ? "application/x-mirr-archive" : "application/octet-stream"),
      checksum: "N/A",
      createdAt: finalStats.birthtime,
      modifiedAt: finalStats.mtime,
    };

    return writeVideo(finalPayload, metadata, options, compressed, encrypted);
  } finally {
    for (const p of tempPaths) {
      try {
        if (existsSync(p)) rmSync(p, { force: true });
      } catch (e) { console.warn(`[Cleanup] ${p}: ${e}`); }
    }
  }
}

// ─── pure helpers ──────────────────────────────────────────────────────────

interface FileMeta {
  name: string;
  size: number;
  mimeType: string;
  checksum: string;
  createdAt: Date;
  modifiedAt: Date;
}

/** Compress and/or encrypt a buffer. */
async function transformPayload(
  data: Uint8Array,
  compressFlag: boolean,
  encryptionService: EncryptionService | null
): Promise<{ payload: Uint8Array; compressed: boolean; encrypted: boolean }> {
  let payload = data;
  let compressed = false;
  let encrypted = false;

  if (compressFlag) {
    const out = compress(payload);
    // If Brotli grew the data (e.g. already-compressed input), keep the original.
    if (out.length < payload.length) {
      payload = new Uint8Array(out);
      compressed = true;
    }
  }

  if (encryptionService) {
    payload = await encryptionService.encrypt(payload);
    encrypted = true;
  }

  return { payload, compressed, encrypted };
}

/** Write header + payload to a lossless video. */
async function writeVideo(
  payload: Uint8Array,
  metadata: FileMeta,
  options: EncodeOptions,
  compressed: boolean,
  encrypted: boolean
): Promise<PipelineResult<string>> {
  const frameWidth = options.frameWidth;
  const frameHeight = options.frameHeight;

  const config = createEncodingConfig(0, 1, encrypted, compressed, frameWidth, frameHeight);
  validateConfig(config);

  const header = buildGlobalHeader(config, metadata, payload.length);
  const headerBytes = serializeHeader(header);

  // Concatenate: [header][payload]
  const fullData = new Uint8Array(headerBytes.length + payload.length);
  fullData.set(headerBytes, 0);
  fullData.set(payload, headerBytes.length);

  const pixelsPerFrame = frameWidth * frameHeight;
  const bytesPerFrame = pixelsPerFrame * 3;
  const totalFramesNeeded = calculateRequiredFrames24Bit(fullData.length, pixelsPerFrame);

  mkdirSync(options.outputPath, { recursive: true });
  const videoPath = `${options.outputPath}/${VIDEO_FILENAME}`;
  const videoStream = new VideoOutputStream({
    width: frameWidth,
    height: frameHeight,
    fps: options.fps || 30,
    outputPath: videoPath,
    codec: options.codec,
  });

  try {
    let offset = 0;
    let frameIndex = 0;
    while (offset < fullData.length) {
      const chunk = fullData.slice(offset, offset + bytesPerFrame);
      const pixelBuffer = encodeToPixels(chunk, frameWidth, frameHeight);
      await videoStream.writeFrame(pixelBuffer);
      offset += bytesPerFrame;
      frameIndex++;
      if (options.showProgress && frameIndex % 30 === 0) {
        const percent = Math.min(100, (offset / fullData.length * 100)).toFixed(1);
        process.stdout.write(`\rEncoded frame ${frameIndex}/${totalFramesNeeded} (${percent}%)`);
      }
    }
    await videoStream.close();
    return { success: true, data: videoPath };
  } catch (err) {
    // Best-effort: close the stream so FFmpeg flushes what it has.
    try { await videoStream.close(); } catch { /* already failed */ }
    throw err;
  }
}