#!/usr/bin/env bun

import { parseArgs } from "util";
import type { EncodeOptions, DecodeOptions } from "./types/index.ts";
import { encodePipeline } from "./pipeline/encodePipeline.ts";
import { decodePipeline } from "./pipeline/decodePipeline.ts";
import { DEFAULT_CONFIG } from "./config/settings.ts";

/** Print usage information */
function printUsage() {
  console.log(`
CFTFF - Visual File Storage System

Usage:
  bun run cli.ts encode <inputFile> <outputDir> [options]
  bun run cli.ts decode <inputDir> <outputFile> [options]

Commands:
  encode    Encode a file into visual frames (images)
  decode    Decode visual frames back into the original file

Options:
  --encrypt              Enable RSA encryption (requires .env with keys)
  --palette-size <n>     Number of colors in palette (default: ${DEFAULT_CONFIG.PALETTE_SIZE})
  --block-size <n>       Pixels per symbol block (default: ${DEFAULT_CONFIG.BLOCK_SIZE})
  --frame-width <n>      Frame width in pixels (default: ${DEFAULT_CONFIG.FRAME_WIDTH})
  --frame-height <n>     Frame height in pixels (default: ${DEFAULT_CONFIG.FRAME_HEIGHT})
  --help                 Show this help message

Examples:
  # Encode a file
  bun run cli.ts encode document.pdf ./output

  # Encode with encryption
  bun run cli.ts encode secret.txt ./output --encrypt

  # Encode with custom palette and block size
  bun run cli.ts encode data.zip ./output --palette-size 256 --block-size 2

  # Decode a file
  bun run cli.ts decode ./output restored.pdf

Environment Variables:
  RSA_PUBLIC_KEY         PEM-encoded RSA public key for encryption
  RSA_PRIVATE_KEY        PEM-encoded RSA private key for decryption

Notes:
  - Output directory will be created if it doesn't exist
  - Frames are saved as frame_000000.png, frame_000001.png, etc.
  - Use the same palette-size and block-size for encoding and decoding
`);
}

/** Parse CLI arguments */
function parseCLIArgs(): {
  command: string;
  args: string[];
  options: any;
} {
  const args = process.argv.slice(2);
  
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage();
    process.exit(0);
  }
  
  const command = args[0];
  const commandArgs = args.slice(1).filter((arg) => !arg.startsWith("--"));
  
  // Parse options
  const options: any = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === "--encrypt") {
      options.encrypt = true;
    } else if (arg === "--palette-size" && args[i + 1]) {
      options.paletteSize = parseInt(args[i + 1]);
      i++;
    } else if (arg === "--block-size" && args[i + 1]) {
      options.blockSize = parseInt(args[i + 1]);
      i++;
    } else if (arg === "--frame-width" && args[i + 1]) {
      options.frameWidth = parseInt(args[i + 1]);
      i++;
    } else if (arg === "--frame-height" && args[i + 1]) {
      options.frameHeight = parseInt(args[i + 1]);
      i++;
    }
  }
  
  return { command, args: commandArgs, options };
}

/** Main CLI entry point */
async function main() {
  const { command, args, options } = parseCLIArgs();
  
  if (command === "encode") {
    if (args.length < 2) {
      console.error("Error: encode requires <inputFile> and <outputDir>");
      printUsage();
      process.exit(1);
    }
    
    const encodeOptions: EncodeOptions = {
      inputFile: args[0],
      outputPath: args[1],
      encrypt: options.encrypt || false,
      paletteSize: options.paletteSize || DEFAULT_CONFIG.PALETTE_SIZE,
      blockSize: options.blockSize || DEFAULT_CONFIG.BLOCK_SIZE,
      frameWidth: options.frameWidth || DEFAULT_CONFIG.FRAME_WIDTH,
      frameHeight: options.frameHeight || DEFAULT_CONFIG.FRAME_HEIGHT,
    };
    
    const result = await encodePipeline(encodeOptions);
    
    if (!result.success) {
      console.error(`✗ ${result.error}`);
      process.exit(1);
    }
    
    console.log(`\nOutput: ${result.data?.length} frames in ${encodeOptions.outputPath}`);
  } else if (command === "decode") {
    if (args.length < 2) {
      console.error("Error: decode requires <inputDir> and <outputFile>");
      printUsage();
      process.exit(1);
    }
    
    const decodeOptions: DecodeOptions = {
      inputPath: args[0],
      outputFile: args[1],
      paletteSize: options.paletteSize || DEFAULT_CONFIG.PALETTE_SIZE,
      blockSize: options.blockSize || DEFAULT_CONFIG.BLOCK_SIZE,
    };
    
    const result = await decodePipeline(decodeOptions);
    
    if (!result.success) {
      console.error(`✗ ${result.error}`);
      process.exit(1);
    }
    
    console.log(`\nOutput: ${result.data}`);
  } else {
    console.error(`Error: Unknown command "${command}"`);
    printUsage();
    process.exit(1);
  }
}

// Run CLI
main().catch((error) => {
  console.error(`Fatal error: ${error}`);
  process.exit(1);
});
