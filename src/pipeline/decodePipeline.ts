import type { DecodeOptions, PipelineResult, GlobalHeader } from "../types/index.ts";
import { decodeFromPixels } from "../core/encoder.ts";
import { streamRawFramesFromVideo } from "../utils/imageWriter.ts";
import { parseHeader } from "../core/protocol.ts";
import { extractArchiveFromStream } from "../utils/archive.ts";
import { ProgressBar } from "../utils/progressBar.ts";
import { decompress } from "../utils/compression.ts";
import { Readable } from "stream";
import { createBrotliDecompress } from "zlib";

/**
 * Main decoding pipeline
 * 1. Stream frames from video
 * 2. Decode pixels to bytes
 * 3. Parse header to detect data type (file vs archive)
 * 4. Stream data to either file or archive extractor
 */
export async function decodePipeline(
  options: DecodeOptions
): Promise<PipelineResult<string>> {
  try {
    console.log("Starting decoding pipeline...");
    console.log("Mode: True Color (Streaming)");

    const videoPath = options.inputPath.endsWith('.mkv') ? options.inputPath : `${options.inputPath}/output.mkv`;
    const frameStream = streamRawFramesFromVideo(videoPath);

    let headerData = new Uint8Array(0);
    let header: GlobalHeader | undefined;
    let progressBar: ProgressBar | null = null;
    let bytesRead = 0;

    // We'll manually consume some frames to find the header
    const iterator = frameStream[Symbol.asyncIterator]();
    let firstPayloadChunk: Uint8Array | undefined;

    // Phase 1: Header Discovery
    while (true) {
      const { value: frame, done } = await iterator.next();
      if (done) throw new Error("Video ended before header could be parsed");

      const decoded = decodeFromPixels(frame, frame.length);
      const newHeaderData = new Uint8Array(headerData.length + decoded.length);
      newHeaderData.set(headerData);
      newHeaderData.set(decoded, headerData.length);
      headerData = newHeaderData;

      try {
        header = await parseHeader(headerData);
        firstPayloadChunk = headerData.slice(header.headerSize);
        break; // Successfully parsed header!
      } catch (e) {
        // Continue collecting bytes from more frames
      }
    }

    if (!header) throw new Error("Critical error: Header not found");

    console.log(`Detected video file: ${videoPath}`);
    console.log(`Original file: ${header.metadata.name}`);
    console.log(`File size: ${header.dataLength.toLocaleString()} bytes`);
    console.log(`Type: ${header.metadata.mimeType}`);

    // Phase 2: Action Selection
    const isArchive = header.metadata.mimeType === "application/x-cftff-archive";
    // Auto-extract if it's an archive, unless extract was explicitly false (which it isn't in options right now)
    const shouldExtract = options.extract !== false && (options.extract || isArchive);

    progressBar = new ProgressBar(header.dataLength, shouldExtract ? "Extracting" : "Decoding");

    // Phase 3: Payload Streaming
    const payloadStream = (async function* () {
      // First, yield the remainder of the frame that contained the header
      if (firstPayloadChunk && firstPayloadChunk.length > 0) {
        const toYield = firstPayloadChunk.slice(0, Math.min(firstPayloadChunk.length, header!.dataLength));
        yield toYield;
        bytesRead += toYield.length;
        if (progressBar) progressBar.update(bytesRead);
      }

      // Then stream the remaining frames
      while (bytesRead < header!.dataLength) {
        const { value: frame, done } = await iterator.next();
        if (done) break;

        const decoded = decodeFromPixels(frame, frame.length);
        const remaining = header!.dataLength - bytesRead;
        const toYield = decoded.slice(0, Math.min(decoded.length, remaining));

        yield toYield;
        bytesRead += toYield.length;
        if (progressBar) progressBar.update(bytesRead);

        if (bytesRead % (10 * 1024 * 1024) === 0) {
          global.gc?.();
        }
      }
    })();

    // Phase 3.5: Decompression if needed
    let finalPayloadStream: AsyncIterable<Uint8Array> = payloadStream;
    if (header.config.compressed) {
      console.log("Decompressing payload stream (Brotli)...");
      // Use Node's zlib via Readable.from
      const decompressor = createBrotliDecompress();
      const readable = Readable.from(payloadStream);
      readable.pipe(decompressor);

      finalPayloadStream = (async function* () {
        for await (const chunk of decompressor) {
          yield new Uint8Array(chunk);
        }
      })();
    }

    // Phase 4: Output Generation
    if (shouldExtract) {
      const { mkdirSync } = await import("fs");
      try { mkdirSync(options.outputPath, { recursive: true }); } catch { }
      await extractArchiveFromStream(finalPayloadStream, options.outputPath, options.showProgress);
    } else {
      const fs = await import("fs");
      const writer = fs.createWriteStream(options.outputPath);
      for await (const chunk of finalPayloadStream) {
        await new Promise<void>((resolve, reject) => {
          if (!writer.write(chunk)) {
            writer.once('drain', resolve);
          } else {
            resolve();
          }
        });
      }
      writer.end();
      await new Promise(r => writer.on('finish', r));
    }

    if (progressBar) (progressBar as any).finish();

    console.log(`\n✓ ${shouldExtract ? "Extraction" : "Decoding"} complete: ${options.outputPath}`);
    return { success: true, data: options.outputPath };

  } catch (error) {
    return { success: false, error: String(error) };
  }
}
