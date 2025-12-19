import type { Symbol, VisualBlock, ColorPalette, Color } from "../types/index.ts";
import { indexToColor } from "../utils/palette.ts";

/** Map symbols to visual blocks */
export function symbolsToBlocks(
  symbols: Symbol[],
  palette: ColorPalette,
  blockSize: number,
  frameWidth: number,
  frameHeight: number
): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  const blocksX = Math.floor(frameWidth / blockSize);
  const blocksY = Math.floor(frameHeight / blockSize);
  
  let symbolIndex = 0;
  
  for (let y = 0; y < blocksY && symbolIndex < symbols.length; y++) {
    for (let x = 0; x < blocksX && symbolIndex < symbols.length; x++) {
      const symbol = symbols[symbolIndex];
      const color = indexToColor(symbol.colorIndex, palette);
      
      blocks.push({
        x: x * blockSize,
        y: y * blockSize,
        size: blockSize,
        color,
      });
      
      symbolIndex++;
    }
  }
  
  return blocks;
}

/** Extract symbols from visual blocks */
export function blocksToSymbols(
  blocks: VisualBlock[],
  palette: ColorPalette
): Symbol[] {
  const symbols: Symbol[] = [];
  
  for (const block of blocks) {
    // Find which palette color this block represents
    const colorIndex = findColorIndex(block.color, palette);
    
    symbols.push({
      value: colorIndex,
      colorIndex,
    });
  }
  
  return symbols;
}

/** Find color index in palette (exact or nearest match) */
function findColorIndex(color: Color, palette: ColorPalette): number {
  // Try exact match first
  for (let i = 0; i < palette.colors.length; i++) {
    const paletteColor = palette.colors[i];
    if (
      paletteColor.r === color.r &&
      paletteColor.g === color.g &&
      paletteColor.b === color.b
    ) {
      return i;
    }
  }
  
  // Fall back to nearest color
  let minDistance = Infinity;
  let nearestIndex = 0;
  
  for (let i = 0; i < palette.colors.length; i++) {
    const distance = colorDistance(color, palette.colors[i]);
    if (distance < minDistance) {
      minDistance = distance;
      nearestIndex = i;
    }
  }
  
  return nearestIndex;
}

/** Calculate color distance */
function colorDistance(c1: Color, c2: Color): number {
  const dr = c1.r - c2.r;
  const dg = c1.g - c2.g;
  const db = c1.b - c2.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** Render blocks to pixel array (RGBA) */
export function renderBlocks(
  blocks: VisualBlock[],
  width: number,
  height: number
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  
  // Fill with black background
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = 0; // R
    pixels[i + 1] = 0; // G
    pixels[i + 2] = 0; // B
    pixels[i + 3] = 255; // A
  }
  
  // Draw blocks
  for (const block of blocks) {
    for (let dy = 0; dy < block.size; dy++) {
      for (let dx = 0; dx < block.size; dx++) {
        const x = block.x + dx;
        const y = block.y + dy;
        
        if (x >= width || y >= height) continue;
        
        const offset = (y * width + x) * 4;
        pixels[offset] = block.color.r;
        pixels[offset + 1] = block.color.g;
        pixels[offset + 2] = block.color.b;
        pixels[offset + 3] = 255;
      }
    }
  }
  
  return pixels;
}

/** Extract blocks from pixel array */
export function extractBlocks(
  pixels: Uint8Array,
  width: number,
  height: number,
  blockSize: number,
  palette: ColorPalette
): VisualBlock[] {
  const blocks: VisualBlock[] = [];
  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);
  
  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const x = bx * blockSize;
      const y = by * blockSize;
      
      // Sample center pixel of block
      const centerX = x + Math.floor(blockSize / 2);
      const centerY = y + Math.floor(blockSize / 2);
      const offset = (centerY * width + centerX) * 4;
      
      const color: Color = {
        r: pixels[offset],
        g: pixels[offset + 1],
        b: pixels[offset + 2],
      };
      
      blocks.push({ x, y, size: blockSize, color });
    }
  }
  
  return blocks;
}
