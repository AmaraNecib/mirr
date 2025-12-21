import sharp from "sharp";
import type { VisualBlock, ColorPalette } from "../types/index.ts";
import { renderBlocks } from "../core/visualMapper.ts";

/** Calculate optimal image dimensions for data size */
export function calculateOptimalDimensions(
  dataBytes: number,
  paletteSize: number,
  blockSize: number,
  maxWidth: number = 8192,
  maxHeight: number = 8192
): { width: number; height: number; frames: number } {
  const bitsPerSymbol = Math.ceil(Math.log2(paletteSize));
  const totalBits = dataBytes * 8;
  const totalSymbols = Math.ceil(totalBits / bitsPerSymbol);
  
  // Calculate blocks needed
  const blocksPerPixel = blockSize * blockSize;
  const totalBlocks = totalSymbols;
  
  // Try to fit in single image first
  const maxBlocksX = Math.floor(maxWidth / blockSize);
  const maxBlocksY = Math.floor(maxHeight / blockSize);
  const maxBlocksPerFrame = maxBlocksX * maxBlocksY;
  
  if (totalBlocks <= maxBlocksPerFrame) {
    // Can fit in single image
    const blocksX = Math.min(Math.ceil(Math.sqrt(totalBlocks)), maxBlocksX);
    const blocksY = Math.ceil(totalBlocks / blocksX);
    
    return {
      width: blocksX * blockSize,
      height: blocksY * blockSize,
      frames: 1,
    };
  } else {
    // Need multiple frames
    const frames = Math.ceil(totalBlocks / maxBlocksPerFrame);
    return {
      width: maxBlocksX * blockSize,
      height: maxBlocksY * blockSize,
      frames,
    };
  }
}

/** Write single optimized image */
export async function writeSingleImage(
  allBlocks: VisualBlock[],
  width: number,
  height: number,
  outputPath: string
): Promise<void> {
  // Reposition blocks sequentially in the image
  const blockSize = allBlocks[0]?.size || 4;
  const blocksPerRow = Math.floor(width / blockSize);
  
  const repositionedBlocks: VisualBlock[] = allBlocks.map((block, index) => {
    const col = index % blocksPerRow;
    const row = Math.floor(index / blocksPerRow);
    
    return {
      ...block,
      x: col * blockSize,
      y: row * blockSize,
    };
  });
  
  const pixels = renderBlocks(repositionedBlocks, width, height);
  
  await sharp(Buffer.from(pixels), {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 0, quality: 100 }) // Lossless
    .toFile(outputPath);
}

/** Read single image and get dimensions */
export async function readSingleImage(
  imagePath: string
): Promise<{ pixels: Uint8Array; width: number; height: number }> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read image dimensions");
  }
  
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  
  return {
    pixels: data,
    width: info.width,
    height: info.height,
  };
}
