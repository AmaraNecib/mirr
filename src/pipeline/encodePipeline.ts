import type { EncodeOptions, PipelineResult, EncodedData } from "../types/index.ts";
import { readFile, extractMetadata, writeFile } from "../core/fileReader.ts";
import { createEncryptionService } from "../core/encryption.ts";
import { loadEnv, createEncodingConfig, validateConfig } from "../config/settings.ts";
import { buildEncodedData, serializeHeader, serializeFrame } from "../core/protocol.ts";
import { encodeToSymbols, calculateSymbolsPerFrame } from "../core/encoder.ts";
import { symbolsToBlocks } from "../core/visualMapper.ts";
import { generatePalette } from "../utils/palette.ts";
import { writeFrames } from "../utils/imageWriter.ts";
import { mkdir } from "fs/promises";

/** Main encoding pipeline */
export async function encodePipeline(
  options: EncodeOptions
): Promise<PipelineResult<string[]>> {
  try {
    console.log("Starting encoding pipeline...");
    
    // Step 1: Read file
    console.log(`Reading file: ${options.inputFile}`);
    const fileData = await readFile(options.inputFile);
    const metadata = await extractMetadata(options.inputFile);
    console.log(`File size: ${metadata.size} bytes`);
    
    // Step 2: Optional encryption
    let dataToEncode = fileData;
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
      
      dataToEncode = await encryptionService.encrypt(fileData);
      console.log(`Encrypted size: ${dataToEncode.length} bytes`);
    }
    
    // Step 3: Create encoding config
    const config = createEncodingConfig(
      options.paletteSize,
      options.blockSize,
      options.encrypt,
      options.frameWidth,
      options.frameHeight
    );
    validateConfig(config);
    
    // Step 4: Build protocol structure
    console.log("Building protocol structure...");
    const encodedData = await buildEncodedData(
      config,
      metadata,
      dataToEncode,
      options.encrypt
    );
    
    console.log(`Created ${encodedData.frames.length} frames`);
    
    // Step 5: Generate color palette
    const palette = generatePalette(config.paletteSize);
    
    // Step 6: Encode to visual frames
    console.log("Encoding to visual frames...");
    const frameDataList = [];
    
    for (let i = 0; i < encodedData.frames.length; i++) {
      const frame = encodedData.frames[i];
      const frameBytes = await serializeFrame(frame);
      
      // Encode frame bytes to symbols
      const symbols = encodeToSymbols(frameBytes, config.paletteSize);
      
      // Map symbols to visual blocks
      const blocks = symbolsToBlocks(
        symbols,
        palette,
        config.blockSize,
        config.frameWidth,
        config.frameHeight
      );
      
      frameDataList.push({
        blocks,
        width: config.frameWidth,
        height: config.frameHeight,
      });
    }
    
    // Add header frame at the beginning
    const headerBytes = await serializeHeader(encodedData.header);
    const headerSymbols = encodeToSymbols(headerBytes, config.paletteSize);
    const headerBlocks = symbolsToBlocks(
      headerSymbols,
      palette,
      config.blockSize,
      config.frameWidth,
      config.frameHeight
    );
    
    frameDataList.unshift({
      blocks: headerBlocks,
      width: config.frameWidth,
      height: config.frameHeight,
    });
    
    // Step 7: Write output images
    console.log(`Writing frames to: ${options.outputPath}`);
    await mkdir(options.outputPath, { recursive: true });
    
    const outputPaths = await writeFrames(frameDataList, options.outputPath);
    
    console.log(`✓ Successfully encoded ${outputPaths.length} frames`);
    
    return {
      success: true,
      data: outputPaths,
    };
  } catch (error) {
    return {
      success: false,
      error: `Encoding failed: ${error}`,
    };
  }
}
