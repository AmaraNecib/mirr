/**
 * Top-level encoding.
 *
 * One small interface that the CLI (and library callers) use:
 *   encode(inputPath, outputPath, options) → result
 *
 * The function decides whether to do a single-part or multi-part encode based
 * on the size of the input. Directories are archived first so the size
 * check is meaningful. The single-part path is delegated to the pipeline;
 * the multi-part path is delegated to the multiPart module.
 *
 * The engine is the single owner of:
 *   - Environment access (encryption keys)
 *   - Service instantiation (EncryptionService)
 *   - Temp-file lifecycle around directories
 *
 * The pipeline receives a fully-built service as a dependency; it never
 * reads env vars or constructs keys itself.
 */

import { statSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { encodePipeline } from "../pipeline/encodePipeline.ts";
import { encodeMultiPart } from "./multiPart.ts";
import { createArchive } from "../utils/archive.ts";
import { DEFAULT_CONFIG } from "../config/settings.ts";
import { requirePublicKey } from "./keys.ts";
import { EncryptionService } from "../core/encryption.ts";
import type { EncodeOptions, EngineResult } from "../types/index.ts";

const MULTIPART_THRESHOLD = 1.5 * 1024 * 1024 * 1024; // 1.5GB
const ARCHIVE_MIME = "application/x-mirr-archive";

export async function encode(
  inputPath: string,
  outputPath: string,
  options: Partial<EncodeOptions> = {}
): Promise<EngineResult> {
  const stats = statSync(inputPath);
  let actualInput: string = inputPath;
  let isArchive = false;
  let tempArchive: string | null = null;
  let originalSize: number | undefined;
  let originalName: string | undefined;

  // Build the encryption service once, here, if requested. The pipeline
  // and multiPart both receive it as a dependency — they never read env.
  let encryptionService: EncryptionService | null = null;
  if (options.encrypt) {
    const publicKey = requirePublicKey();
    encryptionService = new EncryptionService();
    await encryptionService.loadKeys({ publicKey });
  }

  try {
    // Directories get archived first so we can measure and so the decoder
    // knows to extract on the way back out.
    if (stats.isDirectory()) {
      isArchive = true;
      originalSize = await directorySize(inputPath);
      originalName = inputPath.split(/[\\/]/).filter(Boolean).pop();
      const archResult = await createArchive(inputPath);
      if (archResult.type === "file") {
        actualInput = archResult.path;
        tempArchive = archResult.path;
      } else {
        tempArchive = join(tmpdir(), `mirr-archive-${Date.now()}.bin`);
        await Bun.write(tempArchive, archResult.data);
        actualInput = tempArchive;
      }
    }

    const finalStats = statSync(actualInput);

    if (finalStats.size > MULTIPART_THRESHOLD) {
      return await encodeMultiPart({
        inputFile: actualInput,
        outputPath,
        options: { ...options, mimeType: isArchive ? ARCHIVE_MIME : options.mimeType },
        encryptionService,
      });
    }

    return await encodePipeline(buildOptions(actualInput, outputPath, options, isArchive, encryptionService, originalSize, originalName));
  } finally {
    if (tempArchive && existsSync(tempArchive)) {
      try { rmSync(tempArchive, { force: true }); } catch (e) { console.warn(`[Cleanup] ${e}`); }
    }
  }
}

/** Sum of all file sizes in a directory (recursive). */
async function directorySize(dir: string): Promise<number> {
  const { readdirSync, statSync } = await import("fs");
  const { join } = await import("path");
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) total += await directorySize(full);
    else total += s.size;
  }
  return total;
}

function buildOptions(
  inputFile: string,
  outputPath: string,
  options: Partial<EncodeOptions>,
  isArchive: boolean,
  encryptionService: EncryptionService | null,
  originalSize?: number,
  originalName?: string
): EncodeOptions {
  return {
    inputFile,
    outputPath,
    compress: options.compress ?? false,
    outputFormat: "video",
    fps: options.fps ?? DEFAULT_CONFIG.FPS,
    frameWidth: options.frameWidth ?? DEFAULT_CONFIG.FRAME_WIDTH,
    frameHeight: options.frameHeight ?? DEFAULT_CONFIG.FRAME_HEIGHT,
    showProgress: options.showProgress ?? true,
    keepFrames: false,
    mimeType: isArchive ? ARCHIVE_MIME : options.mimeType,
    codec: options.codec ?? "ffv1",
    encrypt: options.encrypt ?? false,
    encryptionService,
    originalSize,
    originalName,
  };
}