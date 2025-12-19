import type { FileMetadata } from "../types/index.ts";
import { calculateChecksum } from "../utils/checksum.ts";

/** Read file as Uint8Array */
export async function readFile(filePath: string): Promise<Uint8Array> {
  try {
    const file = Bun.file(filePath);
    const arrayBuffer = await file.arrayBuffer();
    return new Uint8Array(arrayBuffer);
  } catch (error) {
    throw new Error(`Failed to read file: ${error}`);
  }
}

/** Write file from Uint8Array */
export async function writeFile(
  filePath: string,
  data: Uint8Array
): Promise<void> {
  try {
    await Bun.write(filePath, data);
  } catch (error) {
    throw new Error(`Failed to write file: ${error}`);
  }
}

/** Extract file metadata */
export async function extractMetadata(filePath: string): Promise<FileMetadata> {
  try {
    const file = Bun.file(filePath);
    const stats = await file.stat();
    const data = await readFile(filePath);
    const checksum = await calculateChecksum(data);
    
    // Extract filename without path
    const name = filePath.split(/[/\\]/).pop() || filePath;
    
    // Detect MIME type
    const mimeType = file.type || "application/octet-stream";
    
    return {
      name,
      size: stats.size,
      mimeType,
      checksum,
      createdAt: stats.birthtime || new Date(),
      modifiedAt: stats.mtime || new Date(),
    };
  } catch (error) {
    throw new Error(`Failed to extract metadata: ${error}`);
  }
}
