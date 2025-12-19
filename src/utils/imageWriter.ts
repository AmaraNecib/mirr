import sharp from "sharp";
import type { VisualBlock } from "../types/index.ts";
import { renderBlocks, extractBlocks } from "../core/visualMapper.ts";
import type { ColorPalette } from "../types/index.ts";
import { join } from "path";

/** Write image from visual blocks */
export async function writeImage(
  blocks: VisualBlock[],
  width: number,
  height: number,
  outputPath: string
): Promise<void> {
  const pixels = renderBlocks(blocks, width, height);
  
  await sharp(Buffer.from(pixels), {
    raw: {
      width,
      height,
      channels: 4,
    },
  })
    .png({ compressionLevel: 0 }) // No compression to preserve exact colors
    .toFile(outputPath);
}

/** Read image and extract blocks */
export async function readImage(
  imagePath: string,
  blockSize: number,
  palette: ColorPalette
): Promise<VisualBlock[]> {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  
  if (!metadata.width || !metadata.height) {
    throw new Error("Could not read image dimensions");
  }
  
  const { data, info } = await image
    .raw()
    .toBuffer({ resolveWithObject: true });
  
  return extractBlocks(data, info.width, info.height, blockSize, palette);
}

/** Write multiple frames as numbered images */
export async function writeFrames(
  frameData: { blocks: VisualBlock[]; width: number; height: number }[],
  outputDir: string
): Promise<string[]> {
  const outputPaths: string[] = [];
  
  for (let i = 0; i < frameData.length; i++) {
    const frame = frameData[i];
    const filename = `frame_${i.toString().padStart(6, "0")}.png`;
    const outputPath = join(outputDir, filename);
    
    await writeImage(frame.blocks, frame.width, frame.height, outputPath);
    outputPaths.push(outputPath);
  }
  
  return outputPaths;
}

/** Read all frames from directory */
export async function readFrames(
  inputDir: string,
  blockSize: number,
  palette: ColorPalette
): Promise<VisualBlock[][]> {
  const files = await Array.fromAsync(
    new Bun.Glob("frame_*.png").scan({ cwd: inputDir })
  );
  
  files.sort(); // Ensure correct order
  
  const allBlocks: VisualBlock[][] = [];
  
  for (const file of files) {
    const fullPath = join(inputDir, file);
    const blocks = await readImage(fullPath, blockSize, palette);
    allBlocks.push(blocks);
  }
  
  return allBlocks;
}
