import type { DecodeOptions, PipelineResult, VisualBlock } from "../types/index.ts";
import { writeFile } from "../core/fileReader.ts";
import { createEncryptionService } from "../core/encryption.ts";
import { loadEnv } from "../config/settings.ts";
import { deserializeHeader } from "../core/decoder.ts";
import { decodeFromSymbols } from "../core/encoder.ts";
import { blocksToSymbols } from "../core/visualMapper.ts";
import { generatePalette } from "../utils/palette.ts";
import { readFrames } from "../utils/imageWriter.ts";
import { calculateChecksum, verifyChecksum } from "../utils/checksum.ts";
import { decompress } from "../utils/compression.ts";
import { extractArchive } from "../utils/archive.ts";
import { getOptimalThreadCount, parallelMap } from "../utils/threading.ts";
import { ProgressTracker } from "../utils/progress.ts";

/** Main decoding pipeline */
export async function decodePipeline(
  options: DecodeOptions
): Promise<PipelineResult<string>> {
  try {
    console.log("Starting decoding pipeline...");
    
    const threads = getOptimalThreadCount(options.threads);
    console.log(`Using ${threads} threads for parallel processing`);
    
    // Step 1: Generate palette
    const palette = generatePalette(options.paletteSize);
    
    // Step 2: Read all frames from input directory
    console.log(`Reading from: ${options.inputPath}`);
    const allBlocks = await readFrames(
      options.inputPath,
      options.blockSize,
      palette
    );
    
    if (allBlocks.length === 0 || allBlocks[0].length === 0) {
      throw new Error("No frames found in input directory");
    }
    
    console.log(`Found ${allBlocks.length} frame(s)`);
    
    // Step 3: Decode all frames into continuous byte stream
    console.log("Decoding frames...");
    
    const progress = options.showProgress ? new ProgressTracker(allBlocks.length, "Decoding frames", true) : null;
    let completed = 0;
    
    const allFrameBytes = await parallelMap(
      allBlocks,
      async (blocks) => {
        const symbols = blocksToSymbols(blocks, palette);
        const bitsPerSymbol = Math.ceil(Math.log2(palette.size));
        const totalBits = symbols.length * bitsPerSymbol;
        const maxBytes = Math.floor(totalBits / 8);
        const result = decodeFromSymbols(symbols, palette.size, maxBytes);
        
        // Update progress
        if (progress) {
          completed++;
          progress.update(completed);
        }
        
        return result;
      },
      threads
    );
    
    // Combine all frame bytes into single stream
    const totalLength = allFrameBytes.reduce((sum, fb) => sum + fb.length, 0);
    const allBytes = new Uint8Array(totalLength);
    let offset = 0;
    for (const frameBytes of allFrameBytes) {
      allBytes.set(frameBytes, offset);
      offset += frameBytes.length;
    }
    
    // Step 4: Deserialize header from beginning of byte stream
    console.log("Reading header...");
    const { header, bytesRead } = deserializeHeader(allBytes);
    
    console.log(`Original file: ${header.metadata.name}`);
    console.log(`File size: ${header.metadata.size} bytes`);
    console.log(`Encryption: ${header.encryptionEnabled ? "enabled" : "disabled"}`);
    console.log(`Compression: ${header.config.compressed ? "enabled" : "disabled"}`);    
    // Step 5: Extract data from remaining bytes (no frame deserialization needed)
    console.log("Extracting data...");
    const dataLength = header.totalDataLength;
    const dataBytes = allBytes.slice(bytesRead, bytesRead + dataLength);
    
    // Step 6: Verify global checksum
    console.log("Verifying checksum...");
    const isValid = await verifyChecksum(dataBytes, header.globalChecksum);
    if (!isValid) {
      console.warn("Warning: Global checksum mismatch");
    }
    
    // Step 7: Optional decryption
    let finalData = dataBytes;
    if (header.encryptionEnabled) {
      console.log("Decrypting data...");
      const env = loadEnv();
      
      if (!env.RSA_PRIVATE_KEY) {
        throw new Error("RSA_PRIVATE_KEY not found in environment");
      }
      
      const encryptionService = createEncryptionService();
      await encryptionService.loadKeys({
        publicKey: "",
        privateKey: env.RSA_PRIVATE_KEY,
      });
      
      const decrypted = await encryptionService.decrypt(dataBytes);
      finalData = new Uint8Array(decrypted.buffer as ArrayBuffer);
    }
    
    // Step 8: Optional decompression
    if (header.config.compressed) {
      console.log("Decompressing data...");
      const decompressed = decompress(finalData);
      finalData = new Uint8Array(decompressed.buffer as ArrayBuffer);
    }
    
    // Step 9: Write output file or extract archive
    // Auto-extract archives by default (unless extractArchive is explicitly false)
    const isArchive = header.metadata.mimeType === "application/x-cftff-archive";
    const shouldExtract = isArchive && options.extractArchive !== false;
    
    if (shouldExtract) {
      console.log(`Detected archive - extracting to: ${options.outputFile}`);
      await extractArchive(finalData, options.outputFile);
      console.log(`✓ Successfully extracted archive`);
    } else {
      console.log(`Writing file: ${options.outputFile}`);
      await writeFile(options.outputFile, finalData);
      console.log(`✓ Successfully decoded file`);
    }
    
    console.log(`  Original name: ${header.metadata.name}`);
    console.log(`  Size: ${finalData.length} bytes`);
    
    return {
      success: true,
      data: options.outputFile,
    };
  } catch (error) {
    return {
      success: false,
      error: `Decoding failed: ${error}`,
    };
  }
}
