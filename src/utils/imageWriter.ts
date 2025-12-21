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
  const fs = await import("fs");
  
  // Check if inputDir is actually a video file
  if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile() && inputDir.endsWith('.mp4')) {
    console.log(`Detected video input: ${inputDir} (streaming frames)`);
    return await readFramesFromVideo(inputDir, blockSize, palette);
  }
  
  // Check if there's a video file in the directory
  const videoPath = join(inputDir, "output.mp4");
  if (fs.existsSync(videoPath) && fs.statSync(videoPath).isFile()) {
    console.log(`Detected video file in directory: ${videoPath} (streaming frames)`);
    return await readFramesFromVideo(videoPath, blockSize, palette);
  }
  
  // Otherwise read from PNG files
  const files = await Array.fromAsync(
    new Bun.Glob("frame_*.png").scan({ cwd: inputDir })
  );
  
  files.sort(); // Ensure correct order
  
  if (files.length === 0) {
    throw new Error("No frames found in input directory");
  }
  
  const allBlocks: VisualBlock[][] = [];
  
  for (const file of files) {
    const fullPath = join(inputDir, file);
    const blocks = await readImage(fullPath, blockSize, palette);
    allBlocks.push(blocks);
  }
  
  return allBlocks;
}

/** Read frames directly from video file via streaming (no disk writes) */
async function readFramesFromVideo(
  videoPath: string,
  blockSize: number,
  palette: ColorPalette
): Promise<VisualBlock[][]> {
  const { width, height } = await probeVideoDimensions(videoPath);
  const frameSize = width * height * 4;
  
  const ffmpeg = Bun.spawn([
    'ffmpeg',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-an',
    '-sn',
    '-dn',
    '-vsync', '0',
    '-map', '0:v:0',
    'pipe:1'
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  if (!ffmpeg.stdout) {
    throw new Error("Failed to start ffmpeg for video decoding");
  }
  
  const reader = ffmpeg.stdout.getReader();
  let buffer = new Uint8Array(0);
  const frames: VisualBlock[][] = [];
  
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    
    // Append new data
    const chunk = new Uint8Array(value);
    const combined = new Uint8Array(buffer.length + chunk.length);
    combined.set(buffer, 0);
    combined.set(chunk, buffer.length);
    buffer = combined;
    
    // Process complete frames
    while (buffer.length >= frameSize) {
      const frameData = buffer.slice(0, frameSize);
      buffer = buffer.slice(frameSize);
      const blocks = extractBlocks(frameData, width, height, blockSize, palette);
      frames.push(blocks);
    }
  }
  
  const stderrText = ffmpeg.stderr ? await new Response(ffmpeg.stderr).text() : "";
  const exitCode = await ffmpeg.exited;
  if (exitCode !== 0) {
    throw new Error(`ffmpeg failed while streaming video (exit ${exitCode}): ${stderrText.trim()}`);
  }
  
  if (buffer.length !== 0) {
    console.warn(`Warning: leftover bytes (${buffer.length}) after frame extraction`);
  }
  
  if (frames.length === 0) {
    throw new Error("No frames were read from the video stream");
  }
  
  return frames;
}

/** Probe video dimensions using ffprobe/ffmpeg */
async function probeVideoDimensions(videoPath: string): Promise<{ width: number; height: number }> {
  const probe = Bun.spawn([
    'ffprobe',
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    videoPath
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  
  const output = probe.stdout ? await new Response(probe.stdout).text() : "";
  const stderrText = probe.stderr ? await new Response(probe.stderr).text() : "";
  const exitCode = await probe.exited;
  
  if (exitCode !== 0 || !output.trim()) {
    throw new Error(`ffprobe failed to read video dimensions (exit ${exitCode}): ${stderrText.trim()}`);
  }
  
  const [widthStr, heightStr] = output.trim().split(/[x,]/);
  const width = Number(widthStr);
  const height = Number(heightStr);
  
  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    throw new Error(`Invalid video dimensions reported by ffprobe: ${output.trim()}`);
  }
  
  return { width, height };
}
