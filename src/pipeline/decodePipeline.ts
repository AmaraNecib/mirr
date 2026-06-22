/**
 * Decoding pipeline — single-part only.
 *
 *   1. Stream raw frames from the lossless video into one buffer.
 *   2. Parse the header to learn metadata, compression, encryption flags.
 *   3. If encrypted: decrypt with private key (hybrid RSA + AES-GCM).
 *   4. If compressed: decompress with Brotli.
 *   5. Write the raw bytes to a file, or extract a directory archive.
 *
 * Encryption cannot stream — AES-GCM is authenticated and needs the
 * ciphertext end before decryption can complete. So the payload is buffered
 * first. For files ≤ the multi-part chunk size (1.5GB), this is fine.
 *
 * Multi-part handling lives in engine/multiPart.ts. This module only knows
 * about one input directory containing one video → one output.
 */

import type { DecodeOptions, PipelineResult } from "../types/index.ts";
import { decodeFromPixels } from "../core/encoder.ts";
import { streamRawFramesFromVideo } from "../utils/imageWriter.ts";
import { parseHeader } from "../core/protocol.ts";
import { extractArchive } from "../utils/archive.ts";
import { decompress } from "../utils/compression.ts";
import { EncryptionService } from "../core/encryption.ts";
import { requirePrivateKey } from "../engine/keys.ts";
import { mkdirSync } from "fs";
import { dirname } from "path";

const ARCHIVE_MIME = "application/x-mirr-archive";

export async function decodePipeline(
  options: DecodeOptions
): Promise<PipelineResult<string>> {
  try {
    const videoPath = options.inputPath.endsWith(".mkv")
      ? options.inputPath
      : `${options.inputPath}/output.mkv`;

    // ── Phase 1: Read all frames into one buffer ───────────────────────────
    let totalBytes = 0;
    let frameCount = 0;
    const frames: Uint8Array[] = [];
    for await (const frame of streamRawFramesFromVideo(videoPath)) {
      frames.push(frame);
      totalBytes += frame.length;
      frameCount++;
      if (options.showProgress && frameCount % 30 === 0) {
        process.stdout.write(`\rDecoded ${frameCount} frames (${(totalBytes / 1024 / 1024).toFixed(1)} MB)`);
      }
    }
    if (options.showProgress) console.log();

    // ── Phase 2: Concatenate, parse header ─────────────────────────────────
    const allBytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const frame of frames) {
      allBytes.set(frame, offset);
      offset += frame.length;
    }
    frames.length = 0; // free frame memory

    const header = parseHeader(allBytes);
    // CRITICAL: only read `dataLength` bytes, not the whole frame. The frame
    // is padded with zeros to fill the 1920x1080 video; the encrypted payload
    // ends after exactly `dataLength` bytes.
    const payloadEnd = header.headerSize + header.dataLength;
    let payload = allBytes.slice(header.headerSize, payloadEnd);
    allBytes.fill(0); // free full-buffer memory

    // ── Phase 3: Decrypt if needed (must be BEFORE decompress) ─────────────
    if (header.config.encrypted) {
      if (options.showProgress) console.log("Decrypting payload...");
      const svc = new EncryptionService();
      await svc.loadKeys({ privateKey: requirePrivateKey() });
      try {
        payload = new Uint8Array(await svc.decrypt(payload));
      } catch (e) {
        // Translate the opaque Web Crypto error into a useful hint.
        throw new Error(
          "Decryption failed — the private key does not match the public key " +
          "used to encode this file. Make sure MIRR_PRIVATE_KEY is the matching " +
          "half of the MIRR_PUBLIC_KEY that was used during `mirr encode --encrypt`."
        );
      }
    }

    // ── Phase 3b: Optionally stop here, before decompression ───────────────
    if (options.keepCompressed) {
      const parent = dirname(options.outputPath);
      if (parent && parent !== "." && parent !== "") {
        mkdirSync(parent, { recursive: true });
      }
      await Bun.write(options.outputPath, payload);
      if (options.showProgress) {
        console.log(`\n✓ Wrote compressed payload (${payload.length.toLocaleString()} bytes) to ${options.outputPath}`);
        console.log(`  Decrypt only — call Brotli decompress on this file to recover the original.`);
      }
      return { success: true, data: options.outputPath };
    }

    // ── Phase 4: Decompress if needed ──────────────────────────────────────
    if (header.config.compressed) {
      if (options.showProgress) console.log("Decompressing payload (Brotli)...");
      payload = new Uint8Array(decompress(payload));
    }

    // ── Phase 5: Write output ──────────────────────────────────────────────
    const isArchive = header.metadata.mimeType === ARCHIVE_MIME;
    const shouldExtract = options.extract !== false && (options.extract === true || isArchive);

    // Ensure parent directory exists, but skip if it's the current directory
    // (mkdirSync(".") throws ENOENT on Windows).
    const parent = dirname(options.outputPath);
    if (parent && parent !== "." && parent !== "") {
      mkdirSync(parent, { recursive: true });
    }

    if (shouldExtract) {
      mkdirSync(options.outputPath, { recursive: true });
      await extractArchive(payload, options.outputPath);
    } else {
      await Bun.write(options.outputPath, payload);
    }

    if (options.showProgress) {
      console.log(`\n✓ ${shouldExtract ? "Extraction" : "Decoding"} complete: ${options.outputPath}`);
      console.log(
        `  ${header.metadata.name} (${header.metadata.size.toLocaleString()} bytes)` +
        (header.config.compressed ? " · brotli" : "") +
        (header.config.encrypted ? " · encrypted" : "")
      );
    }

    return { success: true, data: options.outputPath };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}