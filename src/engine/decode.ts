/**
 * Top-level decoding.
 *
 * One small interface:
 *   decode(inputPath, outputPath, options) → result
 *
 * The function checks for a multipart.json manifest. If present, it dispatches
 * to the multi-part decoder; otherwise the single-part pipeline handles it.
 */

import { existsSync } from "fs";
import { join } from "path";
import { decodePipeline } from "../pipeline/decodePipeline.ts";
import { decodeMultiPart } from "./multiPart.ts";
import type { DecodeOptions, EngineResult } from "../types/index.ts";

export async function decode(
  inputPath: string,
  outputPath: string,
  options: Partial<DecodeOptions> = {}
): Promise<EngineResult> {
  const manifestPath = join(inputPath, "multipart.json");
  if (existsSync(manifestPath)) {
    return await decodeMultiPart({
      inputPath,
      outputPath,
      options,
      showProgress: options.showProgress,
    });
  }

  return await decodePipeline({
    inputPath,
    outputPath,
    extract: options.extract,
    paletteSize: options.paletteSize ?? 0,
    blockSize: options.blockSize ?? 1,
    showProgress: options.showProgress ?? true,
    keepCompressed: options.keepCompressed ?? false,
  });
}
