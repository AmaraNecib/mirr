import type { EncodeOptions, PipelineResult } from "../types/index.ts";
import { DEFAULT_CONFIG, createEncodingConfig, validateConfig } from "../config/settings.ts";
import { createArchive } from "../utils/archive.ts";
import { compress } from "../utils/compression.ts";
import {
  encodeToPixels,
  calculateRequiredFrames24Bit
} from "../core/encoder.ts";
import { buildGlobalHeader, serializeHeader } from "../core/protocol.ts";
import { VideoOutputStream } from "../core/ffmpegStream.ts";

/**
 * Main encoding pipeline (24-bit True Color only)
 */
export async function encodePipeline(
  options: EncodeOptions
): Promise<PipelineResult<string[]>> {
  try {
    console.log("Starting encoding pipeline...");

    const fs = await import("fs");
    const stats = fs.statSync(options.inputFile);

    // switch to stream mode for large files/folders
    if (stats.isDirectory() || stats.size > 50 * 1024 * 1024) {
      return await encodeFromFile(
        options.inputFile,
        options,
        stats.isDirectory()
      );
    }

    // Small file memory mode
    const fileData = await Bun.file(options.inputFile).arrayBuffer().then(b => new Uint8Array(b));
    const metadata = {
      name: options.inputFile.split(/[/\\]/).pop() || "data",
      size: stats.size,
      mimeType: options.mimeType || "application/octet-stream",
      checksum: "TODO",
      createdAt: stats.birthtime,
      modifiedAt: stats.mtime,
    };


    console.log(`Read input: ${options.inputFile} (${fileData.length} bytes)`);

    // Compression
    let dataToProcess = fileData;
    let isCompressed = false;
    if (options.compress !== false) {
      const compressed = compress(fileData);
      if (options.compress === true || compressed.length < fileData.length) {
        dataToProcess = new Uint8Array(compressed.buffer as ArrayBuffer);
        isCompressed = true;
      }
    }

    const frameWidth = options.frameWidth || DEFAULT_CONFIG.FRAME_WIDTH;
    const frameHeight = options.frameHeight || DEFAULT_CONFIG.FRAME_HEIGHT;

    // Always use paletteSize 0 (True Color)
    const config = createEncodingConfig(0, 1, false, isCompressed, frameWidth, frameHeight);
    validateConfig(config);

    const header = await buildGlobalHeader(config, metadata, dataToProcess.length, "NONE", false);
    const headerBytes = await serializeHeader(header);

    const fullData = new Uint8Array(headerBytes.length + dataToProcess.length);
    fullData.set(headerBytes, 0);
    fullData.set(dataToProcess, headerBytes.length);

    const pixelsPerFrame = frameWidth * frameHeight;
    const totalFramesNeeded = calculateRequiredFrames24Bit(fullData.length, pixelsPerFrame);

    console.log(`Mode: True Color (24-bit) | Frames: ${totalFramesNeeded}`);

    await fs.mkdirSync(options.outputPath, { recursive: true });
    const videoPath = `${options.outputPath}/output.mkv`;
    const videoStream = new VideoOutputStream({
      width: frameWidth,
      height: frameHeight,
      fps: options.fps || 30,
      outputPath: videoPath
    });

    let offset = 0;
    let frameIndex = 0;
    const bytesPerFrame = pixelsPerFrame * 3;

    while (offset < fullData.length) {
      const chunk = fullData.slice(offset, offset + bytesPerFrame);
      const pixelBuffer = encodeToPixels(chunk, frameWidth, frameHeight);
      await videoStream.writeFrame(pixelBuffer);
      offset += bytesPerFrame;
      frameIndex++;
      if (options.showProgress) {
        process.stdout.write(`\rEncoded frame ${frameIndex}/${totalFramesNeeded}`);
      }
    }

    await videoStream.close();
    console.log(`\n✓ Created video: ${videoPath}`);
    return { success: true, data: [videoPath] };

  } catch (error) {
    return { success: false, error: String(error) };
  }
}

async function encodeFromFile(
  filePath: string,
  options: EncodeOptions,
  isDirectory: boolean
): Promise<PipelineResult<string[]>> {

  const fs = await import("fs");
  let inputToEncode = filePath;
  let tempArchive = "";

  if (isDirectory) {
    console.log(`Input is a directory - creating archive...`);
    const result = await createArchive(filePath);
    if (result.type === 'file') {
      inputToEncode = result.path;
      tempArchive = result.path;
    } else {
      tempArchive = "temp_archive_mem.bin";
      await Bun.write(tempArchive, result.data);
      inputToEncode = tempArchive;
    }
  }

  const file = Bun.file(inputToEncode);
  const fileSize = file.size;
  const frameWidth = options.frameWidth || DEFAULT_CONFIG.FRAME_WIDTH;
  const frameHeight = options.frameHeight || DEFAULT_CONFIG.FRAME_HEIGHT;

  const config = createEncodingConfig(0, 1, false, false, frameWidth, frameHeight);
  const metadata = {
    name: "streamed_data",
    size: fileSize,
    mimeType: options.mimeType || (isDirectory ? "application/x-cftff-archive" : "application/octet-stream"),
    checksum: "N/A",
    createdAt: new Date(),
    modifiedAt: new Date()
  };

  const header = await buildGlobalHeader(config, metadata, fileSize, "NONE", false);
  const headerBytes = await serializeHeader(header);

  await fs.mkdirSync(options.outputPath, { recursive: true });
  const videoPath = `${options.outputPath}/output.mkv`;
  const videoStream = new VideoOutputStream({
    width: frameWidth,
    height: frameHeight,
    fps: options.fps || 30,
    outputPath: videoPath
  });

  const bytesPerFrame = frameWidth * frameHeight * 3;
  let buffer: Uint8Array = headerBytes;
  const stream = file.stream();
  const reader = stream.getReader();
  let frameIndex = 0;
  let totalRead = 0;

  console.log("Streaming encoding...");

  while (true) {
    const { done, value } = await reader.read();
    const chunkToAdd = value || new Uint8Array(0);
    totalRead += chunkToAdd.length;

    const newBuffer = new Uint8Array(buffer.length + chunkToAdd.length);
    newBuffer.set(buffer);
    newBuffer.set(chunkToAdd, buffer.length);
    buffer = newBuffer;

    while (buffer.length >= bytesPerFrame) {
      const frameData = buffer.slice(0, bytesPerFrame);
      buffer = buffer.slice(bytesPerFrame);
      const pixels = encodeToPixels(frameData, frameWidth, frameHeight);
      await videoStream.writeFrame(pixels);
      frameIndex++;

      if (options.showProgress && frameIndex % 30 === 0) {
        const memory = process.memoryUsage();
        const percent = Math.min(100, (totalRead / fileSize * 100)).toFixed(1);
        console.log(`Frame ${frameIndex} (${percent}%) | RSS: ${(memory.rss / 1024 / 1024).toFixed(0)}MB`);
      }
    }
    if (done) break;
  }

  if (buffer.length > 0) {
    const pixels = encodeToPixels(buffer, frameWidth, frameHeight);
    await videoStream.writeFrame(pixels);
    frameIndex++;
  }

  await videoStream.close();
  if (tempArchive) { try { fs.unlinkSync(tempArchive); } catch { } }

  return { success: true, data: [videoPath] };
}