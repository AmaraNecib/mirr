
import { spawn } from "bun";
import type { Subprocess } from "bun";

export interface VideoStreamOptions {
    width: number;
    height: number;
    fps: number;
    outputPath: string;
    codec?: 'libx265' | 'ffv1' | 'libx264rgb';
}

export class VideoOutputStream {
    private ffmpeg: Subprocess;
    private stdin: any;
    private closed = false;

    constructor(options: VideoStreamOptions) {
        const codec = options.codec || 'libx265';
        console.log(`Starting video stream: ${options.width}x${options.height} @ ${options.fps}fps using ${codec}`);

        const ffmpegArgs = [
            'ffmpeg',
            '-y', // Overwrite output
            '-f', 'rawvideo',
            '-vcodec', 'rawvideo',
            '-s', `${options.width}x${options.height}`,
            '-pix_fmt', 'rgb24', // Input format from our buffer
            '-r', options.fps.toString(),
            '-i', '-', // Read from stdin
        ];

        if (codec === 'ffv1') {
            ffmpegArgs.push(
                '-c:v', 'ffv1',
                '-level', '3',
                '-coder', '1',
                '-context', '0',
                '-g', '1',
                '-slices', '4',
                '-slicecrc', '1',
                '-vf', 'format=gbrp',
                '-pix_fmt', 'gbrp'
            );
        } else if (codec === 'libx264rgb') {
            ffmpegArgs.push(
                '-c:v', 'libx264rgb',
                '-crf', '0',
                '-preset', 'veryslow',
                '-pix_fmt', 'rgb24'
            );
        } else {
            ffmpegArgs.push(
                '-c:v', 'libx265',
                '-x265-params', 'lossless=1',
                '-pix_fmt', 'gbrp'
            );
        }

        ffmpegArgs.push(options.outputPath);

        this.ffmpeg = spawn(ffmpegArgs, {
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
