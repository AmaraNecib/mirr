/**
 * Multi-part encoding and decoding.
 *
 * Splits a large input file into N chunks of ~1.5GB each, encodes each chunk
 * to its own video, and writes a manifest (multipart.json). On decode, the
 * manifest is read, each part is decoded in parallel, the chunks are joined
 * back into the original file, and (if the original was a directory) the
 * archive is extracted.
 *
 * This is a pure in-process implementation: no subprocess spawning, no
 * duplicated arg parsing. The existing single-part pipeline is called N times
 * with a slice of the input.
 *
 * Per-part encryption: if the engine passed an EncryptionService, each part
 * is encrypted independently with its own AES key + IV. The cipher format
 * is the same as single-part: `[wrappedKeyLen(4)][wrappedKey][iv(12)][encData]`.
 */

import { statSync, mkdirSync, rmSync, existsSync, createReadStream, createWriteStream, readdirSync } from "fs";
import { join, basename } from "path";
import { cpus } from "os";
import { encodePipeline } from "../pipeline/encodePipeline.ts";
import { decodePipeline } from "../pipeline/decodePipeline.ts";
import { extractArchiveFromFile } from "../utils/archive.ts";
import { DEFAULT_CONFIG } from "../config/settings.ts";
import type { EncodeOptions, DecodeOptions, EngineResult } from "../types/index.ts";
import type { EncryptionService } from "../core/encryption.ts";

const CHUNK_SIZE = 1.5 * 1024 * 1024 * 1024; // 1.5GB
const DEFAULT_CONCURRENCY = Math.min(cpus().length, 3);
const ARCHIVE_MIME = "application/x-mirr-archive";

export interface MultiPartEncodeInput {
  inputFile: string;
  outputPath: string;
  options: Partial<EncodeOptions>;
  encryptionService?: EncryptionService | null;
  chunkSize?: number;
  concurrency?: number;
  showProgress?: boolean;
}

export interface MultiPartDecodeInput {
  inputPath: string;
  outputPath: string;
  options: Partial<DecodeOptions>;
  concurrency?: number;
  showProgress?: boolean;
}

/** Encode a large file as multiple video parts. */
export async function encodeMultiPart(input: MultiPartEncodeInput): Promise<EngineResult> {
  const chunkSize = input.chunkSize ?? CHUNK_SIZE;
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  const showProgress = input.showProgress ?? true;
  const file = Bun.file(input.inputFile);
  const fileStats = statSync(input.inputFile);
  const totalParts = Math.ceil(fileStats.size / chunkSize);
  const fileName = basename(input.inputFile);

  if (showProgress) {
    console.log(
      `\n⚠️  Large file (${(fileStats.size / 1024 / 1024 / 1024).toFixed(2)}GB) — multi-part encoding (${totalParts} parts)\n`
    );
  }

  mkdirSync(input.outputPath, { recursive: true });

  // Temp dir for chunks lives INSIDE the output dir so it cleans up with it
  const tempDir = join(input.outputPath, ".mirr-chunks");
  mkdirSync(tempDir, { recursive: true });

  const partStates: { status: string; progress: string }[] = Array.from(
    { length: totalParts },
    () => ({ status: "Pending", progress: "0%" })
  );

  if (showProgress && process.stdout.isTTY) {
    for (let i = 0; i < totalParts; i++) {
      console.log(`Part ${i.toString().padStart(3, "0")}: Pending`);
    }
  }

  const activeTasks = new Set<Promise<void>>();
  const failedIndices: number[] = [];

  try {
    for (let i = 0; i < totalParts; i++) {
      if (activeTasks.size >= concurrency) {
        await Promise.race(activeTasks);
      }

      const task = encodeOnePart(i, input, chunkSize, file, fileStats, partStates, showProgress, tempDir)
        .catch(() => { failedIndices.push(i); });

      activeTasks.add(task);
      task.finally(() => { activeTasks.delete(task); });
    }

    await Promise.all(activeTasks);
  } finally {
    if (existsSync(tempDir)) {
      try { rmSync(tempDir, { recursive: true, force: true }); } catch (e) { console.warn(`[Cleanup] ${e}`); }
    }
  }

  if (failedIndices.length > 0) {
    return {
      success: false,
      error: `Encoding failed for parts: ${failedIndices.join(", ")}`,
    };
  }

  // Write manifest so the decoder can reassemble
  await Bun.write(
    join(input.outputPath, "multipart.json"),
    JSON.stringify({
      originalFile: fileName,
      totalParts,
      chunkSize,
      totalSize: fileStats.size,
      isArchive: input.options.mimeType === ARCHIVE_MIME,
    }, null, 2)
  );

  if (showProgress) {
    console.log(`\n✓ Multi-part encoding complete: ${input.outputPath}`);
  }

  return { success: true, data: input.outputPath };
}

async function encodeOnePart(
  partIndex: number,
  input: MultiPartEncodeInput,
  chunkSize: number,
  file: ReturnType<typeof Bun.file>,
  fileStats: { size: number },
  partStates: { status: string; progress: string }[],
  showProgress: boolean,
  tempDir: string
): Promise<void> {
  const partName = `part${partIndex.toString().padStart(3, "0")}`;
  const offset = partIndex * chunkSize;
  const partSize = Math.min(chunkSize, fileStats.size - offset);
  const chunkPath = join(tempDir, `${partName}.bin`);
  const partOutDir = join(input.outputPath, partName);

  try {
    partStates[partIndex].status = "Splitting";
    if (showProgress) printPartTable(partStates);

    // Extract chunk to a temp file the pipeline can read
    const chunkData = await file.slice(offset, offset + partSize).arrayBuffer();
    await Bun.write(chunkPath, chunkData);

    partStates[partIndex].status = "Encoding";
    if (showProgress) printPartTable(partStates);

    const result = await encodePipeline({
      inputFile: chunkPath,
      outputPath: partOutDir,
      compress: input.options.compress ?? false,
      outputFormat: "video",
      fps: input.options.fps ?? DEFAULT_CONFIG.FPS,
      frameWidth: input.options.frameWidth ?? DEFAULT_CONFIG.FRAME_WIDTH,
      frameHeight: input.options.frameHeight ?? DEFAULT_CONFIG.FRAME_HEIGHT,
      showProgress: false, // per-part progress is in the table above
      keepFrames: false,
      mimeType: input.options.mimeType,
      codec: input.options.codec ?? "ffv1",
      encrypt: input.encryptionService != null,
      encryptionService: input.encryptionService ?? null,
    });

    if (!result.success) {
      throw new Error(result.error ?? "unknown error");
    }

    partStates[partIndex].status = "Done";
    partStates[partIndex].progress = "100%";
  } finally {
    try { if (existsSync(chunkPath)) rmSync(chunkPath, { force: true }); } catch (e) { console.warn(`[Cleanup] ${e}`); }
    if (showProgress) printPartTable(partStates);
  }
}

/** Decode multiple video parts and reassemble into the original file/directory. */
export async function decodeMultiPart(input: MultiPartDecodeInput): Promise<EngineResult> {
  const concurrency = input.concurrency ?? DEFAULT_CONCURRENCY;
  const showProgress = input.showProgress ?? true;

  const metadataPath = join(input.inputPath, "multipart.json");
  if (!existsSync(metadataPath)) {
    return { success: false, error: `Not a multi-part output: missing ${metadataPath}` };
  }

  const metadata = await Bun.file(metadataPath).json();
  const totalParts = metadata.totalParts as number;
  const isArchive = Boolean(metadata.isArchive);
  const originalFile = String(metadata.originalFile);

  if (showProgress) {
    console.log(`\n⚠️  Multi-part video detected (${totalParts} parts)\n`);
  }

  const chunksDir = join(input.outputPath, ".mirr-chunks");
  mkdirSync(chunksDir, { recursive: true });

  try {
    const activeTasks = new Set<Promise<void>>();
    const failedIndices: number[] = [];

    for (let i = 0; i < totalParts; i++) {
      if (activeTasks.size >= concurrency) {
        await Promise.race(activeTasks);
      }

      const partIndex = i;
      const partName = `part${partIndex.toString().padStart(3, "0")}`;
      const partDir = join(input.inputPath, partName);
      const chunkOut = join(chunksDir, `chunk.${partName}`);

      const task = decodePipeline({
        inputPath: partDir,
        outputPath: chunkOut,
        // Multi-part owns the extract decision; per-part decode writes raw bytes.
        extract: false,
        paletteSize: input.options.paletteSize ?? 0,
        blockSize: input.options.blockSize ?? 1,
        showProgress: false,
      }).then((result) => {
        if (!result.success) throw new Error(result.error ?? "unknown error");
      }).catch(() => { failedIndices.push(partIndex); });

      activeTasks.add(task);
      task.finally(() => { activeTasks.delete(task); });
    }

    await Promise.all(activeTasks);

    if (failedIndices.length > 0) {
      return {
        success: false,
        error: `Decoding failed for parts: ${failedIndices.join(", ")}`,
      };
    }

    if (showProgress) console.log(`Joining ${totalParts} chunks...`);
    const finalPath = join(input.outputPath, originalFile);
    await joinChunks(chunksDir, finalPath);

    if (isArchive && input.options.extract !== false) {
      if (showProgress) console.log(`Extracting archive...`);
      await extractArchiveFromFile(finalPath, input.outputPath, showProgress);
      try { rmSync(finalPath, { force: true }); } catch (e) { console.warn(`[Cleanup] ${e}`); }
    }

    if (showProgress) {
      console.log(`\n✓ Multi-part decoding complete: ${input.outputPath}`);
    }

    return { success: true, data: input.outputPath };
  } finally {
    if (existsSync(chunksDir)) {
      try { rmSync(chunksDir, { recursive: true, force: true }); } catch (e) { console.warn(`[Cleanup] ${e}`); }
    }
  }
}

async function joinChunks(chunksDir: string, outputFile: string): Promise<void> {
  const files = readdirSync(chunksDir)
    .filter(f => f.startsWith("chunk.part"))
    .sort();

  if (files.length === 0) {
    throw new Error(`No chunks found in ${chunksDir}`);
  }

  const writeStream = createWriteStream(outputFile);
  for (const file of files) {
    await new Promise<void>((resolve, reject) => {
      const readStream = createReadStream(join(chunksDir, file));
      readStream.on("error", reject);
      readStream.on("end", resolve);
      readStream.pipe(writeStream, { end: false });
    });
  }
  await new Promise<void>(resolve => writeStream.end(resolve));
}

function printPartTable(states: { status: string; progress: string }[]): void {
  if (!process.stdout.isTTY) return;
  const lines = states.map((s, i) =>
    `Part ${i.toString().padStart(3, "0")}: [${s.status.padEnd(10)}] ${s.progress}`
  );
  process.stdout.write("\x1b[?25l"); // hide cursor
  process.stdout.write(`\x1b[${lines.length}A`); // move up N lines
  for (const line of lines) {
    process.stdout.write(`\r\x1b[K${line}\n`); // clear line, write
  }
  process.stdout.write("\x1b[?25h"); // show cursor
}