import type { EncodeOptions, PipelineResult } from "../types/index.ts";
import { readFile, extractMetadata } from "../core/fileReader.ts";
import { createEncryptionService } from "../core/encryption.ts";
import { loadEnv, createEncodingConfig, validateConfig } from "../config/settings.ts";
import { buildGlobalHeader, serializeHeader } from "../core/protocol.ts";
import { encodeToSymbols } from "../core/encoder.ts";
import { symbolsToBlocks } from "../core/visualMapper.ts";
import { generatePalette } from "../utils/palette.ts";
import { writeFrames } from "../utils/imageWriter.ts";
import { createArchive, isCompressedFile } from "../utils/archive.ts";
import { compress, getCompressionRatio } from "../utils/compression.ts";
import { getOptimalThreadCount, parallelMap } from "../utils/threading.ts";
import {  writeSingleImage } from "../utils/singleImage.ts";
import { calculateChecksum } from "../utils/checksum.ts";
import { ProgressTracker } from "../utils/progress.ts";
import { mkdir } from "fs/promises";
import { statSync } from "fs";
import { join } from "path";

/** Main encoding pipeline */
export async function encodePipeline(
  options: EncodeOptions
): Promise<PipelineResult<string[]>> {
  let archiveTempPath: string | null = null;
  
  try {
    console.log("Starting encoding pipeline...");
    
    const threads = getOptimalThreadCount(options.threads);
    console.log(`Using ${threads} threads for parallel processing`);
    
    // Step 1: Read input (file, folder, or archive)
    console.log(`Reading input: ${options.inputFile}`);
    let fileData: Uint8Array;
    let metadata;
    
    const stats = statSync(options.inputFile);
    
    if (stats.isDirectory()) {
      console.log("Input is a directory - creating archive...");
      const archiveResult = await createArchive(options.inputFile);
      
      if (archiveResult.type === 'file') {
        // Large archive - process in streaming mode
        console.log(`Large archive detected (${(archiveResult.size / 1024 / 1024).toFixed(2)}MB)`);
        console.log("Switching to streaming mode...");
        archiveTempPath = archiveResult.path;
        
        // Stream the file directly to encoding pipeline
        return await encodeFromFile(archiveResult.path, options, threads, archiveTempPath);
      } else {
        // Small archive - in memory
        fileData = archiveResult.data;
      }
      
      metadata = {
        name: options.inputFile.split(/[/\\]/).pop() + ".archive",
        size: fileData.length,
        mimeType: "application/x-cftff-archive",
        checksum: await calculateChecksum(fileData),
        createdAt: new Date(),
        modifiedAt: new Date(),
      };
    } else if (isCompressedFile(options.inputFile)) {
      console.log("Input is a compressed file - reading directly...");
      fileData = await readFile(options.inputFile);
      metadata = await extractMetadata(options.inputFile);
    } else {
      fileData = await readFile(options.inputFile);
      metadata = await extractMetadata(options.inputFile);
    }
    
    console.log(`Original size: ${metadata.size} bytes`);
    
    // Step 2: Optional compression
    let dataToProcess = fileData;
    if (options.compress) {
      if (options.showProgress) {
        process.stdout.write("Compressing data... ");
      } else {
        console.log("Compressing data...");
      }
      const compressed = compress(fileData);
      const ratio = getCompressionRatio(fileData.length, compressed.length);
      if (options.showProgress) {
        console.log(`✓ ${compressed.length} bytes (${ratio.toFixed(1)}% reduction)`);
      } else {
        console.log(`Compressed: ${compressed.length} bytes (${ratio.toFixed(1)}% reduction)`);
      }
      dataToProcess = compressed;
    }
    
    // Step 3: Optional encryption
    let dataToEncode = dataToProcess;
    if (options.encrypt) {
      console.log("Encrypting data...");
      const env = loadEnv();
      
      if (!env.RSA_PUBLIC_KEY) {
        throw new Error("RSA_PUBLIC_KEY not found in environment");
      }
      
      const encryptionService = createEncryptionService();
      await encryptionService.loadKeys({
        publicKey: env.RSA_PUBLIC_KEY,
        privateKey: "",
      });
      
      dataToEncode = await encryptionService.encrypt(dataToProcess);
      console.log(`Encrypted size: ${dataToEncode.length} bytes`);
    }
    
    // Step 4: Use configured frame dimensions (no optimization for single-image)
    const frameWidth = options.frameWidth;
    const frameHeight = options.frameHeight;
    console.log(`Using frame dimensions: ${frameWidth}x${frameHeight}`);
    
    // Step 5: Create encoding config
    const config = createEncodingConfig(
      options.paletteSize,
      options.blockSize,
      options.encrypt,
      options.compress,
      frameWidth,
      frameHeight
    );
    validateConfig(config);
    
    // Step 6: Build protocol header
    console.log("Building protocol header...");
    const globalChecksum = await calculateChecksum(dataToEncode);
    const header = await buildGlobalHeader(
      config,
      metadata,
      dataToEncode.length,
      globalChecksum,
      options.encrypt
    );
    
    // Step 7: Generate color palette
    const palette = generatePalette(config.paletteSize);
    
    // Step 8: Combine header + data into continuous byte stream
    console.log("Building frame data...");
    const headerBytes = await serializeHeader(header);
    
    // Combine header + raw data
    const totalLength = headerBytes.length + dataToEncode.length;
    const allBytes = new Uint8Array(totalLength);
    allBytes.set(headerBytes, 0);
    allBytes.set(dataToEncode, headerBytes.length);
    
    console.log(`Header size: ${headerBytes.length} bytes`);
    console.log(`Data size: ${dataToEncode.length} bytes`);
    console.log(`Total size: ${allBytes.length} bytes`);
    
    // Calculate how many visual frames we need
    const blocksPerFrame = (config.frameWidth / config.blockSize) * (config.frameHeight / config.blockSize);
    const bitsPerSymbol = Math.ceil(Math.log2(config.paletteSize));
    const bytesPerFrame = Math.floor((blocksPerFrame * bitsPerSymbol) / 8);
    
    console.log(`Encoding to visual frames (${Math.ceil(allBytes.length / bytesPerFrame)} frame(s) needed)...`);
    
    // Split into frame-sized chunks and encode in parallel
    const frameChunks: Uint8Array[] = [];
    for (let i = 0; i < allBytes.length; i += bytesPerFrame) {
      frameChunks.push(allBytes.slice(i, i + bytesPerFrame));
    }
    
    // Create output directory before encoding
    await mkdir(options.outputPath, { recursive: true });
    
    const progress = options.showProgress ? new ProgressTracker(frameChunks.length, "Encoding frames", true) : null;
    
    // Step 9: Create output
    console.log(`Writing output to: ${options.outputPath}`);
    
    let finalOutputPaths: string[];
    
    if (options.outputFormat === 'single-image') {
      throw new Error("Single-image format not supported. Use 'frames' or 'video' format.");
    } else if (options.outputFormat === 'frames') {
      // Write frames to disk in parallel
      const { writeImage } = await import("../utils/imageWriter.ts");
      const outputPaths: string[] = [];
      let completed = 0;
      
      await parallelMap(
        frameChunks,
        async (chunk, index) => {
          const symbols = encodeToSymbols(chunk, config.paletteSize);
          const blocks = symbolsToBlocks(
            symbols,
            palette,
            config.blockSize,
            config.frameWidth,
            config.frameHeight
          );
          
          const filename = `frame_${index.toString().padStart(6, "0")}.png`;
          const outputPath = join(options.outputPath, filename);
          await writeImage(blocks, config.frameWidth, config.frameHeight, outputPath);
          outputPaths.push(outputPath);
          
          if (progress) {
            completed++;
            progress.update(completed);
          }
          
          return null;
        },
        threads
      );
      
      finalOutputPaths = outputPaths;
      console.log(`✓ Created ${finalOutputPaths.length} frame images`);
    } else {
      // Default: Stream frames directly to FFmpeg (no disk writes!)
      const videoPath = `${options.outputPath}/output.mp4`;
      console.log(`Streaming frames directly to video at ${options.fps || 30} fps...`);
      console.log(`No temporary PNG files will be created!`);
      
      // Start FFmpeg process with raw RGBA input from stdin
      const ffmpeg = Bun.spawn([
        'ffmpeg',
        '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', `${config.frameWidth}x${config.frameHeight}`,
        '-pix_fmt', 'rgba',
        '-r', (options.fps || 30).toString(),
        '-i', '-', // Read from stdin
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '0', // Lossless
        '-preset', 'ultrafast',
        videoPath
      ], {
        stdin: 'pipe',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      
      const stdin = ffmpeg.stdin;
      let completed = 0;
      
      // Encode and stream frames in parallel batches
      const BATCH_SIZE = threads;
      for (let i = 0; i < frameChunks.length; i += BATCH_SIZE) {
        const batch = frameChunks.slice(i, Math.min(i + BATCH_SIZE, frameChunks.length));
        
        // Encode batch in parallel
        const frameBuffers = await Promise.all(
          batch.map(async (chunk) => {
            const symbols = encodeToSymbols(chunk, config.paletteSize);
            const blocks = symbolsToBlocks(
              symbols,
              palette,
              config.blockSize,
              config.frameWidth,
              config.frameHeight
            );
            
            // Convert blocks to raw RGBA buffer
            const pixels = new Uint8Array(config.frameWidth * config.frameHeight * 4);
            
            // Fill with black background first
            pixels.fill(0);
            
            // Render each block
            for (const block of blocks) {
              for (let by = 0; by < block.size; by++) {
                for (let bx = 0; bx < block.size; bx++) {
                  const px = block.x + bx;
                  const py = block.y + by;
                  
                  if (px < config.frameWidth && py < config.frameHeight) {
                    const pixelIndex = (py * config.frameWidth + px) * 4;
                    pixels[pixelIndex] = block.color.r;
                    pixels[pixelIndex + 1] = block.color.g;
                    pixels[pixelIndex + 2] = block.color.b;
                    pixels[pixelIndex + 3] = block.color.a;
                  }
                }
              }
            }
            
            return pixels;
          })
        );
        
        // Write frames to FFmpeg stdin sequentially
        for (const frameBuffer of frameBuffers) {
          stdin.write(frameBuffer);
          completed++;
          
          if (progress && completed % 10 === 0) {
            progress.update(completed);
          }
        }
      }
      
      // Close stdin to signal end of input
      stdin.end();
      
      // Wait for FFmpeg to finish
      await ffmpeg.exited;
      
      console.log(`✓ Created video: ${videoPath}`);
      finalOutputPaths = [videoPath];
    }
    
    console.log(`  Original size: ${metadata.size} bytes`);
    console.log(`  Final data size: ${dataToEncode.length} bytes`);
    console.log(`  Total frames: ${frameChunks.length}`);
    
    // Clean up temporary archive file if created
    if (archiveTempPath) {
      try {
        const fs = await import("fs");
        const { dirname } = await import("path");
        fs.rmSync(dirname(archiveTempPath), { recursive: true, force: true });
        console.log("Cleaned up temporary archive");
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return {
      success: true,
      data: finalOutputPaths,
    };
  } catch (error) {
    // Clean up temporary archive file on error
    if (archiveTempPath) {
      try {
        const fs = await import("fs");
        const { dirname } = await import("path");
        fs.rmSync(dirname(archiveTempPath), { recursive: true, force: true });
      } catch (e) {
        // Ignore cleanup errors
      }
    }
    
    return {
      success: false,
      error: `Encoding failed: ${error}`,
    };
  }
}

/** Encode large file directly without loading into memory */
async function encodeFromFile(
  filePath: string,
  options: EncodeOptions,
  threads: number,
  tempPath: string
): Promise<PipelineResult<string[]>> {
  try {
    const file = Bun.file(filePath);
    const fileSize = file.size;
    
    // Create encoding config
    const config = createEncodingConfig(
      options.paletteSize,
      options.blockSize,
      false,
      options.compress,
      options.frameWidth,
      options.frameHeight
    );
    validateConfig(config);
    
    // Generate color palette
    const palette = generatePalette(config.paletteSize);
    
    // Calculate frame capacity
    const blocksPerFrame = (config.frameWidth / config.blockSize) * (config.frameHeight / config.blockSize);
    const bitsPerSymbol = Math.ceil(Math.log2(config.paletteSize));
    const bytesPerFrame = Math.floor((blocksPerFrame * bitsPerSymbol) / 8);
    const totalFramesNeeded = Math.ceil(fileSize / bytesPerFrame);
    const fps = options.fps || 30;
    
    console.log(`Frame capacity: ${bytesPerFrame.toLocaleString()} bytes per frame`);
    console.log(`Total frames needed: ${totalFramesNeeded.toLocaleString()}`);
    console.log(`Estimated video duration: ${(totalFramesNeeded / fps).toFixed(1)}s at ${fps} fps`);
    
    await mkdir(options.outputPath, { recursive: true });
    
    // Start streaming to FFmpeg for video output
    if (options.outputFormat !== 'frames') {
      const videoPath = `${options.outputPath}/output.mp4`;
      console.log(`Streaming directly to video at ${fps} fps (no temp files)...`);
      
      // Start FFmpeg with stdin pipe
      const ffmpeg = Bun.spawn([
        'ffmpeg',
        '-y',
        '-f', 'rawvideo',
        '-vcodec', 'rawvideo',
        '-s', `${config.frameWidth}x${config.frameHeight}`,
        '-pix_fmt', 'rgba',
        '-r', fps.toString(),
        '-i', '-',
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-crf', '0',
        '-preset', 'ultrafast',
        videoPath
      ], {
        stdin: 'pipe',
        stdout: 'inherit',
        stderr: 'inherit',
      });
      
      const stdin = ffmpeg.stdin;
      
      // Stream file in chunks
      const CHUNK_SIZE = 100 * 1024 * 1024; // 100MB chunks
      const stream = file.stream();
      const reader = stream.getReader();
      
      let leftover = new Uint8Array(0);
      let bytesProcessed = 0;
      let frameIndex = 0;
      
      // Process chunks and stream to FFmpeg
      while (true) {
        const { done, value } = await reader.read();
        
        if (done) break;
        
        const chunk = new Uint8Array(leftover.length + value.length);
        chunk.set(leftover, 0);
        chunk.set(value, leftover.length);
        
        const chunkSize = chunk.length - (chunk.length % bytesPerFrame);
        let offset = 0;
        
        // Process frames in parallel batches
        const BATCH_SIZE = threads;
        while (offset + bytesPerFrame <= chunk.length) {
          const batchFrames: Uint8Array[] = [];
          
          // Collect batch
          for (let i = 0; i < BATCH_SIZE && offset + bytesPerFrame <= chunk.length; i++) {
            batchFrames.push(chunk.slice(offset, offset + bytesPerFrame));
            offset += bytesPerFrame;
          }
          
          // Encode batch in parallel
          const frameBuffers = await Promise.all(
            batchFrames.map(async (frameData) => {
              const symbols = encodeToSymbols(frameData, config.paletteSize);
              const blocks = symbolsToBlocks(
                symbols,
                palette,
                config.blockSize,
                config.frameWidth,
                config.frameHeight
              );
              
              // Convert to raw RGBA pixels
              const pixels = new Uint8Array(config.frameWidth * config.frameHeight * 4);
              
              // Fill with black background
              pixels.fill(0);
              
              // Render each block
              for (const block of blocks) {
                for (let by = 0; by < block.size; by++) {
                  for (let bx = 0; bx < block.size; bx++) {
                    const px = block.x + bx;
                    const py = block.y + by;
                    
                    if (px < config.frameWidth && py < config.frameHeight) {
                      const pixelIndex = (py * config.frameWidth + px) * 4;
                      pixels[pixelIndex] = block.color.r;
                      pixels[pixelIndex + 1] = block.color.g;
                      pixels[pixelIndex + 2] = block.color.b;
                      pixels[pixelIndex + 3] = block.color.a;
                    }
                  }
                }
              }
              
              return pixels;
            })
          );
          
          // Stream frames to FFmpeg
          for (const frameBuffer of frameBuffers) {
            stdin.write(frameBuffer);
            frameIndex++;
            
            if (frameIndex % 100 === 0) {
              const totalProcessed = bytesProcessed + offset;
              const progress = ((totalProcessed / fileSize) * 100).toFixed(1);
              console.log(`Streamed ${frameIndex} frames (${(totalProcessed / 1024 / 1024).toFixed(2)}MB / ${(fileSize / 1024 / 1024).toFixed(2)}MB - ${progress}%)`);
            }
          }
        }
        
        leftover = chunk.slice(offset);
        bytesProcessed += chunkSize;
      }
      
      // Process final leftover if any
      if (leftover.length > 0) {
        const symbols = encodeToSymbols(leftover, config.paletteSize);
        const blocks = symbolsToBlocks(
          symbols,
          palette,
          config.blockSize,
          config.frameWidth,
          config.frameHeight
        );
        
        const pixels = new Uint8Array(config.frameWidth * config.frameHeight * 4);
        
        // Fill with black background
        pixels.fill(0);
        
        // Render each block
        for (const block of blocks) {
          for (let by = 0; by < block.size; by++) {
            for (let bx = 0; bx < block.size; bx++) {
              const px = block.x + bx;
              const py = block.y + by;
              
              if (px < config.frameWidth && py < config.frameHeight) {
                const pixelIndex = (py * config.frameWidth + px) * 4;
                pixels[pixelIndex] = block.color.r;
                pixels[pixelIndex + 1] = block.color.g;
                pixels[pixelIndex + 2] = block.color.b;
                pixels[pixelIndex + 3] = block.color.a;
              }
            }
          }
        }
        
        stdin.write(pixels);
        frameIndex++;
      }
      
      console.log(`Total frames streamed: ${frameIndex}`);
      
      // Close stdin and wait for FFmpeg
      stdin.end();
      await ffmpeg.exited;
      
      console.log(`✓ Created video: ${videoPath}`);
      
      // Clean up temp archive
      try {
        const fs = await import("fs");
        const { dirname } = await import("path");
        fs.rmSync(dirname(tempPath), { recursive: true, force: true });
        console.log("Cleaned up temporary archive");
      } catch (e) {
        // Ignore
      }
      
      return {
        success: true,
        data: [videoPath],
      };
    } else {
      // For frames output, still write to disk
      const { writeImage } = await import("../utils/imageWriter.ts");
      const outputPaths: string[] = [];
      
      const stream = file.stream();
      const reader = stream.getReader();
      
      let leftover = new Uint8Array(0);
      let bytesProcessed = 0;
      let frameIndex = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = new Uint8Array(leftover.length + value.length);
        chunk.set(leftover, 0);
        chunk.set(value, leftover.length);
        
        const chunkSize = chunk.length - (chunk.length % bytesPerFrame);
        let offset = 0;
        
        while (offset + bytesPerFrame <= chunk.length) {
          const frameData = chunk.slice(offset, offset + bytesPerFrame);
          const symbols = encodeToSymbols(frameData, config.paletteSize);
          const blocks = symbolsToBlocks(
            symbols,
            palette,
            config.blockSize,
            config.frameWidth,
            config.frameHeight
          );
          
          const filename = `frame_${frameIndex.toString().padStart(6, "0")}.png`;
          const outputPath = join(options.outputPath, filename);
          await writeImage(blocks, config.frameWidth, config.frameHeight, outputPath);
          outputPaths.push(outputPath);
          
          offset += bytesPerFrame;
          frameIndex++;
          
          if (frameIndex % 100 === 0) {
            const totalProcessed = bytesProcessed + offset;
            const progress = ((totalProcessed / fileSize) * 100).toFixed(1);
            console.log(`Encoded ${frameIndex} frames (${(totalProcessed / 1024 / 1024).toFixed(2)}MB / ${(fileSize / 1024 / 1024).toFixed(2)}MB - ${progress}%)`);
          }
        }
        
        leftover = chunk.slice(offset);
        bytesProcessed += chunkSize;
      }
      
      // Process final leftover
      if (leftover.length > 0) {
        const symbols = encodeToSymbols(leftover, config.paletteSize);
        const blocks = symbolsToBlocks(
          symbols,
          palette,
          config.blockSize,
          config.frameWidth,
          config.frameHeight
        );
        
        const filename = `frame_${frameIndex.toString().padStart(6, "0")}.png`;
        const outputPath = join(options.outputPath, filename);
        await writeImage(blocks, config.frameWidth, config.frameHeight, outputPath);
        outputPaths.push(outputPath);
        frameIndex++;
      }
      
      console.log(`Total frames encoded: ${frameIndex}`);
      console.log(`✓ Created ${outputPaths.length} frame images`);
      
      // Clean up temp archive
      try {
        const fs = await import("fs");
        const { dirname } = await import("path");
        fs.rmSync(dirname(tempPath), { recursive: true, force: true });
        console.log("Cleaned up temporary archive");
      } catch (e) {
        // Ignore
      }
      
      return {
        success: true,
        data: outputPaths,
      };
    }
  } catch (error) {
    // Clean up on error
    try {
      const fs = await import("fs");
      const { dirname } = await import("path");
      fs.rmSync(dirname(tempPath), { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
    
    return {
      success: false,
      error: `Encoding failed: ${error}`,
    };
  }
}
