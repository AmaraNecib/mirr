import type { EncodingConfig } from "../types/index.ts";

export const DEFAULT_CONFIG = {
  VERSION: 2,
  MAGIC: "CFTFF",
  FRAME_WIDTH: 1920,
  FRAME_HEIGHT: 1080,
  BLOCK_SIZE: 1, // Forced to 1 for True Color
  PALETTE_SIZE: 0, // 0 means True Color (24-bit)
  FPS: 30,
};

export function createEncodingConfig(
  paletteSize = DEFAULT_CONFIG.PALETTE_SIZE,
  blockSize = DEFAULT_CONFIG.BLOCK_SIZE,
  encrypted = false,
  compressed = false,
  frameWidth = DEFAULT_CONFIG.FRAME_WIDTH,
  frameHeight = DEFAULT_CONFIG.FRAME_HEIGHT
): EncodingConfig {
  return {
    paletteSize,
    blockSize: 1, // Always 1 for now
    frameWidth,
    frameHeight,
    encrypted,
    compressed,
    version: DEFAULT_CONFIG.VERSION,
  };
}

export function validateConfig(config: EncodingConfig): void {
  if (config.frameWidth % 2 !== 0 || config.frameHeight % 2 !== 0) {
    throw new Error("Frame dimensions must be even for FFmpeg compatibility");
  }
}
