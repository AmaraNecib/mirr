import type { DecodeOptions, PipelineResult } from "../types/index.ts";
import { writeFile } from "../core/fileReader.ts";
import { createEncryptionService } from "../core/encryption.ts";
import { loadEnv } from "../config/settings.ts";
import { deserializeHeader, deserializeFrame } from "../core/decoder.ts";
import { decodeFromSymbols } from "../core/encoder.ts";
import { blocksToSymbols } from "../core/visualMapper.ts";
import { generatePalette } from "../utils/palette.ts";
import { readFrames } from "../utils/imageWriter.ts";
import { verifyChecksum } from "../utils/checksum.ts";

/** Main decoding pipeline */
export async function decodePipeline(
  options: DecodeOptions
): Promise<PipelineResult<string>> {
  try {
    console.log("Starting decoding pipeline...");
    
    // Step 1: Generate palette
    const palette = generatePalette(options.paletteSize);
    
    // Step 2: Read all frames
    console.log(`Reading frames from: ${options.inputPath}`);
    const allBlocks = await readFrames(
      options.inputPath,
      options.blockSize,
      palette
    );
    
    if (allBlocks.length === 0) {
      throw new Error("No frames found in input directory");
    }
    
    console.log(`Found ${allBlocks.length} frames`);
    
    // Step 3: Extract header from first frame
    console.log("Decoding header...");
    const headerBlocks = allBlocks[0];
    const headerSymbols = blocksToSymbols(headerBlocks, palette);
    
    // Calculate how many bytes we can decode from available symbols
    const bitsPerSymbol = Math.ceil(Math.log2(palette.size));
    const totalBits = headerSymbols.length * bitsPerSymbol;
    const maxBytes = Math.floor(totalBits / 8);
    
    // Decode header bytes
    let headerBytes = decodeFromSymbols(headerSymbols, palette.size, maxBytes);
    const { header, bytesRead } = deserializeHeader(headerBytes);
    
    console.log(`Original file: ${header.metadata.name}`);
    console.log(`File size: ${header.metadata.size} bytes`);
    console.log(`Encryption: ${header.encryptionEnabled ? "enabled" : "disabled"}`);
    
    // Step 4: Decode data frames
    console.log("Decoding data frames...");
    const dataFrames = allBlocks.slice(1);
    const allPayloads: Uint8Array[] = [];
    
    for (let i = 0; i < dataFrames.length; i++) {
      const blocks = dataFrames[i];
      const symbols = blocksToSymbols(blocks, palette);
      
      // Calculate max bytes we can decode
      const bitsPerSymbol = Math.ceil(Math.log2(palette.size));
      const totalBits = symbols.length * bitsPerSymbol;
      const maxBytes = Math.floor(totalBits / 8);
      
      // Decode frame
      const frameBytes = decodeFromSymbols(symbols, palette.size, maxBytes);
      const { frame } = deserializeFrame(frameBytes);
      
      // Verify frame checksum
      const isValid = await verifyChecksum(frame.payload, frame.checksum);
      if (!isValid) {
        console.warn(`Warning: Frame ${i} checksum mismatch`);
      }
      
      allPayloads.push(frame.payload);
    }
    
    // Step 5: Combine payloads
    const totalLength = allPayloads.reduce((sum, p) => sum + p.length, 0);
    const combinedData = new Uint8Array(totalLength);
    let offset = 0;
    
    for (const payload of allPayloads) {
      combinedData.set(payload, offset);
      offset += payload.length;
    }
    
    // Trim to actual data length
    const actualData = combinedData.slice(0, header.totalDataLength);
    
    // Step 6: Verify global checksum
    console.log("Verifying checksum...");
    const isValid = await verifyChecksum(actualData, header.globalChecksum);
    if (!isValid) {
      console.warn("Warning: Global checksum mismatch");
    }
    
    // Step 7: Optional decryption
    let finalData = actualData;
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
      
      const decrypted = await encryptionService.decrypt(actualData);
      finalData = new Uint8Array(decrypted.buffer as ArrayBuffer);
    }
    
    // Step 8: Write output file
    console.log(`Writing file: ${options.outputFile}`);
    await writeFile(options.outputFile, finalData);
    
    console.log(`✓ Successfully decoded file`);
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
