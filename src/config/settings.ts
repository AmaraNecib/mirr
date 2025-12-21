import type { EncodingConfig, ColorPalette, Color } from "../types/index.ts";

/** Default configuration values */
export const DEFAULT_CONFIG = {
  PALETTE_SIZE: 16,
  BLOCK_SIZE: 4,
  FRAME_WIDTH: 1920,
  FRAME_HEIGHT: 1080,
  VERSION: 1,
  FPS: 30, // Default 30 frames per second for video
  MAGIC_BYTES: new TextEncoder().encode("CFTFF"),
  END_MARKER: new TextEncoder().encode("END"),
} as const;

/** Load environment variables */
export function loadEnv() {
  return {
    RSA_PUBLIC_KEY: process.env.RSA_PUBLIC_KEY || "",
    RSA_PRIVATE_KEY: process.env.RSA_PRIVATE_KEY || "",
  };
}

/** Create encoding configuration */
export function createEncodingConfig(
  paletteSize: number = DEFAULT_CONFIG.PALETTE_SIZE,
  blockSize: number = DEFAULT_CONFIG.BLOCK_SIZE,
  encrypted: boolean = false,
  compressed: boolean = false,
  frameWidth: number = DEFAULT_CONFIG.FRAME_WIDTH,
  frameHeight: number = DEFAULT_CONFIG.FRAME_HEIGHT
): EncodingConfig {
  return {
    paletteSize,
    blockSize,
    frameWidth,
    frameHeight,
    encrypted,
    compressed,
    version: DEFAULT_CONFIG.VERSION,
  };
}

/** Validate configuration */
export function validateConfig(config: EncodingConfig): boolean {
  if (config.paletteSize < 2 || config.paletteSize > 256) {
    throw new Error("Palette size must be between 2 and 256");
  }
  if (config.blockSize < 1 || config.blockSize > 32) {
    throw new Error("Block size must be between 1 and 32");
  }
  if (config.frameWidth < 64 || config.frameHeight < 64) {
    throw new Error("Frame dimensions must be at least 64x64");
  }
  return true;
}
