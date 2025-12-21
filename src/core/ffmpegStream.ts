
import { spawn } from "bun";
import type { Subprocess } from "bun";

export interface VideoStreamOptions {
    width: number;
    height: number;
    fps: number;
    outputPath: string;
}

export class VideoOutputStream {
    private ffmpeg: Subprocess;
    private stdin: any;
    private closed = false;

    constructor(options: VideoStreamOptions) {
        console.log(`Starting video stream: ${options.width}x${options.height} @ ${options.fps}fps`);
        console.log(`Methods: rawvideo (rgba) -> libx265 (lossless) -> gbrp`);

        this.ffmpeg = spawn([
            'ffmpeg',
            '-y', // Overwrite output
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', `${options.width}x${options.height}`,
            '-pix_fmt', 'rgba', // Input format from our buffer
            '-r', options.fps.toString(),
            '-i', '-', // Read from stdin
            '-c:v', 'libx265',
            '-x265-params', 'lossless=1', // STRICT lossless
            '-pix_fmt', 'gbrp', // Planar RGB to avoid YUV conversion errors
            options.outputPath
        ], {
            stdin: 'pipe',
            stdout: 'inherit',
            stderr: 'inherit',
        });

        if (!this.ffmpeg.stdin) {
            throw new Error("Failed to open FFmpeg stdin");
        }
        this.stdin = this.ffmpeg.stdin;
    }

    /** Write a frame buffer (RGBA) to the video stream */
    async writeFrame(buffer: Uint8Array): Promise<void> {
        if (this.closed) throw new Error("Stream is closed");
        // Bun's writer handling
        this.stdin.write(buffer);
        // Explicit flush not always needed with Bun's stream, but good to be aware
        await this.stdin.flush();
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;

        this.stdin.end();
        const exitCode = await this.ffmpeg.exited;

        if (exitCode !== 0) {
            throw new Error(`FFmpeg exited with code ${exitCode}`);
        }
    }
}
