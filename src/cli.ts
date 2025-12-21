import type { EncodeOptions, DecodeOptions } from "./types/index.ts";
import { DEFAULT_CONFIG } from "./config/settings.ts";
import { encodePipeline } from "./pipeline/encodePipeline.ts";
import { decodePipeline } from "./pipeline/decodePipeline.ts";

/** Print CLI usage information */
function printUsage() {
  console.log(`
CFTFF - Convert Files to Frames/Files
A tool for encoding files as visual data in images

Usage:
  bun run src/cli.ts encode <input> <output> [options]
  bun run src/cli.ts decode <input> <output> [options]

Commands:
  encode    Encode a file or folder into visual frames
  decode    Decode visual frames back to a file

Encode Options:
  --encrypt           Enable RSA encryption
  --compress          Enable gzip compression
  --output <format>   Output format: video (default), frames, single-image
  --frame <WxH>       Frame dimensions (default: 1920x1080)
  --fps <n>           Frames per second for video (default: 30)
  --threads <n>       Number of threads for parallel processing
  --palette-size <n>  Number of colors in palette (default: 16)
  --block-size <n>    Size of color blocks in pixels (default: 4)
  --keep-frames       Keep PNG frames after video creation
  --no-progress       Hide progress indicators

Decode Options:
  --extract           Extract archive after decoding
  --threads <n>       Number of threads for parallel processing
  --palette-size <n>  Number of colors in palette (must match encode)
  --block-size <n>    Size of color blocks (must match encode)

Examples:
  # Encode a file with compression to video (default)
  bun run src/cli.ts encode test.txt output --compress

  # Encode with custom frame size and video output
  bun run src/cli.ts encode test.txt output --frame 3840x2160 --fps 2

  # Encode to single optimized image
  bun run src/cli.ts encode test.txt output --output single-image

  # Encode to individual frame images
  bun run src/cli.ts encode test.txt output --output frames

  # Decode with extraction
  bun run src/cli.ts decode output result.txt --extract

  # Encode with encryption
  bun run src/cli.ts encode secret.txt output --encrypt
`);
}

/** Parse command line arguments */
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
  const commandArgs: string[] = [];
  const options: any = {};
  
  // Parse command arguments and options
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    
    if (arg.startsWith("--")) {
      // It's an option
      if (arg === "--encrypt") {
        options.encrypt = true;
      } else if (arg === "--compress") {
        options.compress = true;
      } else if (arg === "--output" && args[i + 1]) {
        options.output = args[i + 1];
        i++;
      } else if (arg === "--frame" && args[i + 1]) {
        const [w, h] = args[i + 1].split('x').map(n => parseInt(n));
        if (w && h) {
          options.frameWidth = w;
          options.frameHeight = h;
        }
        i++;
      } else if (arg === "--fps" && args[i + 1]) {
        options.fps = parseInt(args[i + 1]);
        i++;
      } else if (arg === "--extract") {
        options.extract = true;
      } else if (arg === "--threads" && args[i + 1]) {
        options.threads = parseInt(args[i + 1]);
        i++;
      } else if (arg === "--palette-size" && args[i + 1]) {
        options.paletteSize = parseInt(args[i + 1]);
        i++;
      } else if (arg === "--block-size" && args[i + 1]) {
        options.blockSize = parseInt(args[i + 1]);
        i++;
      } else if (arg === "--no-progress") {
        options.noProgress = true;
      } else if (arg === "--keep-frames") {
        options.keepFrames = true;
      }
    } else {
      // It's a command argument
      commandArgs.push(arg);
    }
  }
  
  return { command, args: commandArgs, options };
}

/** Main CLI entry point */
async function main() {
  const { command, args, options } = parseCLIArgs();
  
  if (command === "encode") {
    if (args.length < 2) {
      console.error("Error: encode requires <input> and <output> arguments");
      printUsage();
      process.exit(1);
    }
    
    const outputFormat = options.output || 'video'; // Default to video
    
    const encodeOptions: EncodeOptions = {
      inputFile: args[0],
      outputPath: args[1],
      encrypt: options.encrypt || false,
      compress: options.compress || false,
      outputFormat: outputFormat as 'video' | 'frames' | 'single-image',
      fps: options.fps || DEFAULT_CONFIG.FPS,
      threads: options.threads,
      paletteSize: options.paletteSize || DEFAULT_CONFIG.PALETTE_SIZE,
      blockSize: options.blockSize || DEFAULT_CONFIG.BLOCK_SIZE,
      frameWidth: options.frameWidth || DEFAULT_CONFIG.FRAME_WIDTH,
      frameHeight: options.frameHeight || DEFAULT_CONFIG.FRAME_HEIGHT,
      showProgress: !options.noProgress,
      keepFrames: options.keepFrames || false,
    };
    
    const result = await encodePipeline(encodeOptions);
    
    if (result.success) {
      console.log(`\n✓ Encoding complete: ${result.data}`);
    } else {
      console.error(`\n✗ Encoding failed: ${result.error}`);
      process.exit(1);
    }
  } else if (command === "decode") {
    if (args.length < 2) {
      console.error("Error: decode requires <input> and <output> arguments");
      printUsage();
      process.exit(1);
    }
    
    const decodeOptions: DecodeOptions = {
      inputPath: args[0],
      outputFile: args[1],
      extractArchive: options.extract, // undefined if not provided, auto-extracts archives
      paletteSize: options.paletteSize || DEFAULT_CONFIG.PALETTE_SIZE,
      blockSize: options.blockSize || DEFAULT_CONFIG.BLOCK_SIZE,
      threads: options.threads,
      showProgress: !options.noProgress,
    };
    
    const result = await decodePipeline(decodeOptions);
    
    if (result.success) {
      console.log(`\n✓ Decoding complete: ${result.data}`);
    } else {
      console.error(`\n✗ Decoding failed: ${result.error}`);
      process.exit(1);
    }
  } else {
    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
