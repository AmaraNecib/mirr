import sharp from "sharp";
import { join } from "path";

/** Read raw RGBA frames (efficient path for True Color) - Reads all into memory */
export async function readRawFrames(
  inputDir: string
): Promise<Uint8Array[]> {
  const frames: Uint8Array[] = [];
  for await (const frame of streamRawFrames(inputDir)) {
    frames.push(frame);
  }
  return frames;
}

/** Stream raw RGBA frames (Generator) */
export async function* streamRawFrames(
  inputDir: string
): AsyncGenerator<Uint8Array> {
  const fs = await import("fs");

  // Check valid video extensions
  if (fs.existsSync(inputDir) && fs.statSync(inputDir).isFile() && (inputDir.endsWith('.mp4') || inputDir.endsWith('.mkv'))) {
    console.log(`Detected video input: ${inputDir} (streaming raw frames)`);
    yield* streamRawFramesFromVideo(inputDir);
    return;
  }

  const videoPath = join(inputDir, "output.mkv");
  if (fs.existsSync(videoPath) && fs.statSync(videoPath).isFile()) {
    console.log(`Detected video file: ${videoPath}`);
    yield* streamRawFramesFromVideo(videoPath);
    return;
  }

  throw new Error("No valid video input found for streaming");
}

/** Stream raw RGBA frames directly from video stream (Generator) */
export async function* streamRawFramesFromVideo(videoPath: string): AsyncGenerator<Uint8Array> {
  const { width, height } = await probeVideoDimensions(videoPath);
  const frameSize = width * height * 4; // RGBA

  const ffmpeg = Bun.spawn([
    'ffmpeg',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', videoPath,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-an', '-sn', '-dn',
    '-vsync', '0',
    '-map', '0:v:0',
    'pipe:1'
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (!ffmpeg.stdout) throw new Error("Failed to start ffmpeg");
  if (!ffmpeg.stderr) throw new Error("Failed to capture stderr");

  // Capture stderr for debugging crashes
  const stderrBox = { text: "" };
  (async () => {
    const reader = ffmpeg.stderr.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        stderrBox.text += decoder.decode(value);
      }
    } catch (e) { /* ignore stderr read errors */ }
  })();

  const reader = ffmpeg.stdout.getReader();
  let buffer = new Uint8Array(0);

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;

      const combined = new Uint8Array(buffer.length + value.length);
      combined.set(buffer);
      combined.set(value, buffer.length);
      buffer = combined;

      while (buffer.length >= frameSize) {
        // Yield frame
        yield buffer.slice(0, frameSize);
        buffer = buffer.slice(frameSize);
      }
    }

    if (buffer.length > 0) {
      console.warn(`Warning: Dropped ${buffer.length} incomplete bytes from video stream`);
    }

  } finally {
    // Check exit code
    const exitCode = await ffmpeg.exited;
    if (exitCode !== 0) {
      throw new Error(`FFmpeg exited with error ${exitCode}: ${stderrBox.text}`);
    }
  }
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
