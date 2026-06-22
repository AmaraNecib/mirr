#!/usr/bin/env bun
/**
 * mirr CLI — single entry point.
 *
 *   mirr encode <input> <output> [options]
 *   mirr decode <input> <output> [options]
 *
 * Dispatches to the engine layer; the engine decides single-part vs multi-part
 * and owns all the size-based and archive logic. This file only parses argv.
 */

import { encode } from "./engine/encode.ts";
import { decode } from "./engine/decode.ts";
import type { EncodeOptions, DecodeOptions } from "./types/index.ts";

const USAGE = `
mirr — project any file into a lossless video

Encode any file or directory as a lossless 24-bit RGB video.
Large inputs (>1.5GB) are automatically split into multi-part videos.

Usage:
  mirr encode <input> <output> [options]
  mirr decode <input> <output> [options]

Encode options:
  --compress            Compress payload with Brotli before encoding
  --encrypt             Encrypt payload with hybrid RSA + AES-GCM
  --frame <WxH>         Frame dimensions (default: 1920x1080)
  --fps <n>             Frames per second (default: 30)
  --codec <name>        Video codec: ffv1, libx264rgb, libx265 (default: ffv1)
  --mime <type>         Override the input MIME type
  --no-progress         Hide progress indicators

Decode options:
  --no-extract          Do not auto-extract directory archives
  --keep-compressed     Stop after decryption; do not decompress (output = compressed bytes)
  --no-progress         Hide progress indicators

Examples:
  mirr encode test.txt output
  mirr encode my-folder output
  mirr encode data.bin output --compress
  mirr encode secrets.bin safe --encrypt
  mirr encode input.txt output --fps 60 --frame 3840x2160
  mirr decode output result.txt
  mirr decode output recovered-folder
  mirr decode output compressed.bin --keep-compressed
`;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }

  const command = args[0];
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      // If the next token exists and is not another flag, treat it as the value.
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, flags };
}

function parseFrame(s: string): { width: number; height: number } | null {
  const match = s.match(/^(\d+)x(\d+)$/);
  if (!match) return null;
  return { width: parseInt(match[1]), height: parseInt(match[2]) };
}

function asInt(v: string | boolean | undefined, fallback: number): number {
  if (typeof v !== "string") return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);

  if (command === "encode") {
    if (positional.length < 2) {
      console.error("Error: encode requires <input> and <output>");
      console.log(USAGE);
      process.exit(1);
    }
    const [inputFile, outputPath] = positional;

    const options: Partial<EncodeOptions> = {
      compress: Boolean(flags.compress),
      encrypt: Boolean(flags.encrypt),
      fps: asInt(flags.fps, 0) || undefined,
      mimeType: typeof flags.mime === "string" ? flags.mime : undefined,
      codec: (typeof flags.codec === "string" ? flags.codec : "ffv1") as EncodeOptions["codec"],
      showProgress: !flags["no-progress"],
    };

    if (typeof flags.frame === "string") {
      const dims = parseFrame(flags.frame);
      if (!dims) {
        console.error(`Invalid --frame value: ${flags.frame}. Expected WxH (e.g. 1920x1080).`);
        process.exit(1);
      }
      options.frameWidth = dims.width;
      options.frameHeight = dims.height;
    }

    const result = await encode(inputFile, outputPath, options);
    if (!result.success) {
      console.error(`\n✗ Encoding failed: ${result.error}`);
      process.exit(1);
    }
    console.log(`\n✓ Encoding complete: ${result.data}`);
  } else if (command === "decode") {
    if (positional.length < 2) {
      console.error("Error: decode requires <input> and <output>");
      console.log(USAGE);
      process.exit(1);
    }
    const [inputPath, outputPath] = positional;

    const options: Partial<DecodeOptions> = {
      // undefined lets the pipeline auto-extract for archives; false forces raw.
      extract: flags["no-extract"] ? false : undefined,
      showProgress: !flags["no-progress"],
      keepCompressed: Boolean(flags["keep-compressed"]),
    };

    const result = await decode(inputPath, outputPath, options);
    if (!result.success) {
      console.error(`\n✗ Decoding failed: ${result.error}`);
      process.exit(1);
    }
    console.log(`\n✓ Decoding complete: ${result.data}`);
  } else if (command === "--version" || command === "-v") {
    const pkg = await Bun.file("package.json").json().catch(() => ({ version: "unknown" }));
    console.log(`mirr v${pkg.version}`);
  } else {
    console.error(`Unknown command: ${command}`);
    console.log(USAGE);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});