import { readdirSync, statSync, createWriteStream, createReadStream } from "fs";
import { join, relative, sep } from "path";
import { readFile as bunReadFile } from "fs/promises";
import { tmpdir } from "os";

/** File entry in archive */
export interface ArchiveEntry {
  path: string;
  data: Uint8Array;
  isDirectory: boolean;
}

/** Archive result - either in-memory data or file path for large archives */
export type ArchiveResult = 
  | { type: 'memory'; data: Uint8Array }
  | { type: 'file'; path: string; size: number };

/** Create archive from folder or file using checkpoints to avoid memory issues */
export async function createArchive(inputPath: string): Promise<ArchiveResult> {
  const stats = statSync(inputPath);
  
  // For small single files, use direct memory approach
  if (stats.isFile() && stats.size < 50 * 1024 * 1024) { // < 50MB
    const data = await bunReadFile(inputPath);
    const fileName = inputPath.split(/[/\\]/).pop() || inputPath;
    const entries = [{
      path: fileName,
      data: new Uint8Array(data),
      isDirectory: false,
    }];
    return { type: 'memory', data: serializeArchive(entries) };
  }
  
  // For directories, use checkpoint-based approach
  if (stats.isDirectory()) {
    return await createArchiveWithCheckpoints(inputPath);
  }
  
  // For large single files, return file path
  return { type: 'file', path: inputPath, size: stats.size };
}

/** Create archive using checkpoints to process files in batches */
async function createArchiveWithCheckpoints(inputPath: string): Promise<ArchiveResult> {
  const fs = await import("fs");
  
  // Use current directory for temp files to avoid running out of space
  const tempDir = join(process.cwd(), `.cftff-temp-${Date.now()}`);
  
  try {
    // Create temp directory for checkpoints
    fs.mkdirSync(tempDir, { recursive: true });
    
    // Collect all file info without loading data
    const entryInfos: { path: string; size: number; isDirectory: boolean; fullPath?: string }[] = [];
    await collectEntryInfo(inputPath, inputPath, entryInfos);
    
    console.log(`Processing ${entryInfos.length} entries in checkpoints...`);
    
    const encoder = new TextEncoder();
    const CHECKPOINT_SIZE = 100 * 1024 * 1024; // 100MB per checkpoint
    
    // Calculate metadata size
    let metadataSize = 4; // entry count
    for (const info of entryInfos) {
      const pathBytes = encoder.encode(info.path);
      metadataSize += 4 + pathBytes.length + 1 + 4; // path length + path + isDirectory + data length
    }
    
    // Write metadata to first checkpoint
    const metadataBuffer = new Uint8Array(metadataSize);
    const metadataView = new DataView(metadataBuffer.buffer);
    let offset = 0;
    
    metadataView.setUint32(offset, entryInfos.length, false);
    offset += 4;
    
    for (const info of entryInfos) {
      const pathBytes = encoder.encode(info.path);
      metadataView.setUint32(offset, pathBytes.length, false);
      offset += 4;
      metadataBuffer.set(pathBytes, offset);
      offset += pathBytes.length;
      
      metadataBuffer[offset] = info.isDirectory ? 1 : 0;
      offset += 1;
      
      metadataView.setUint32(offset, info.size, false);
      offset += 4;
    }
    
    const metadataFile = join(tempDir, 'archive_metadata.bin');
    await Bun.write(metadataFile, metadataBuffer);
    
    // Process file data and write directly to data file (streaming approach)
    const dataFile = join(tempDir, 'archive_data.bin');
    const dataStream = fs.createWriteStream(dataFile);
    
    let totalWritten = 0;
    const CHUNK_READ_SIZE = 50 * 1024 * 1024; // Read files in 50MB chunks
    
    for (const info of entryInfos) {
      if (!info.isDirectory && info.fullPath) {
        const file = Bun.file(info.fullPath);
        let bytesRead = 0;
        
        while (bytesRead < info.size) {
          const chunkSize = Math.min(CHUNK_READ_SIZE, info.size - bytesRead);
          const chunk = await file.slice(bytesRead, bytesRead + chunkSize).arrayBuffer();
          
          // Write chunk to stream
          await new Promise<void>((resolve, reject) => {
            dataStream.write(Buffer.from(chunk), (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
          
          bytesRead += chunkSize;
          totalWritten += chunkSize;
          
          if (totalWritten % (100 * 1024 * 1024) === 0 || Math.abs(totalWritten - (100 * 1024 * 1024) * Math.floor(totalWritten / (100 * 1024 * 1024))) < chunkSize) {
            console.log(`Processed: ${(totalWritten / 1024 / 1024).toFixed(2)}MB`);
          }
        }
      }
    }
    
    // Close the stream
    await new Promise<void>((resolve) => {
      dataStream.end(() => resolve());
    });
    
    console.log(`Total data written: ${(totalWritten / 1024 / 1024).toFixed(2)}MB`);
    
    // Directly combine files without creating duplicates
    const finalFile = join(tempDir, 'archive.bin');
    const finalStream = fs.createWriteStream(finalFile);
    
    // Copy metadata
    const metadataReadStream = fs.createReadStream(metadataFile);
    await new Promise<void>((resolve, reject) => {
      metadataReadStream.pipe(finalStream, { end: false });
      metadataReadStream.on('end', () => resolve());
      metadataReadStream.on('error', reject);
    });
    
    // Copy data
    const dataReadStream = fs.createReadStream(dataFile);
    await new Promise<void>((resolve, reject) => {
      dataReadStream.pipe(finalStream, { end: true });
      dataReadStream.on('end', () => resolve());
      dataReadStream.on('error', reject);
    });
    
    await new Promise<void>((resolve) => finalStream.end(() => resolve()));
    
    // Delete intermediate files immediately
    try {
      fs.unlinkSync(metadataFile);
      fs.unlinkSync(dataFile);
    } catch (e) {
      // Ignore
    }
    
    const finalSize = metadataBuffer.length + totalWritten;
    console.log(`Archive created: ${(finalSize / 1024 / 1024).toFixed(2)}MB`);
    
    // Return file path instead of loading into memory
    // Note: temp directory cleanup is skipped - file will be cleaned up after encoding
    return { type: 'file', path: finalFile, size: finalSize };
    
  } catch (error) {
    // Clean up on error
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/** Collect entry information without loading file data */
async function collectEntryInfo(
  rootPath: string,
  currentPath: string,
  infos: { path: string; size: number; isDirectory: boolean; fullPath?: string }[]
): Promise<void> {
  const items = readdirSync(currentPath);
  
  for (const item of items) {
    const fullPath = join(currentPath, item);
    const stats = statSync(fullPath);
    const relativePath = relative(rootPath, fullPath);
    
    if (stats.isDirectory()) {
      infos.push({
        path: relativePath + sep,
        size: 0,
        isDirectory: true,
      });
      await collectEntryInfo(rootPath, fullPath, infos);
    } else {
      infos.push({
        path: relativePath,
        size: stats.size,
        isDirectory: false,
        fullPath,
      });
    }
  }
}

/** Serialize archive entries to binary format */
function serializeArchive(entries: ArchiveEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  
  // Calculate total size
  let totalSize = 4; // entry count
  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path);
    totalSize += 4 + pathBytes.length + 1 + 4 + entry.data.length;
  }
  
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  
  // Write entry count
  view.setUint32(offset, entries.length, false);
  offset += 4;
  
  // Write entries
  for (const entry of entries) {
    const pathBytes = encoder.encode(entry.path);
    
    // Write path length and path
    view.setUint32(offset, pathBytes.length, false);
    offset += 4;
    buffer.set(pathBytes, offset);
    offset += pathBytes.length;
    
    // Write isDirectory flag
    view.setUint8(offset, entry.isDirectory ? 1 : 0);
    offset += 1;
    
    // Write data length and data
    view.setUint32(offset, entry.data.length, false);
    offset += 4;
    buffer.set(entry.data, offset);
    offset += entry.data.length;
  }
  
  return buffer;
}

/** Deserialize archive from binary format */
export function deserializeArchive(data: Uint8Array): ArchiveEntry[] {
  const decoder = new TextDecoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  // Read entry count
  const entryCount = view.getUint32(offset, false);
  offset += 4;
  
  const entries: ArchiveEntry[] = [];
  
  // Read entries
  for (let i = 0; i < entryCount; i++) {
    // Read path
    const pathLength = view.getUint32(offset, false);
    offset += 4;
    const path = decoder.decode(data.slice(offset, offset + pathLength));
    offset += pathLength;
    
    // Read isDirectory flag
    const isDirectory = view.getUint8(offset) === 1;
    offset += 1;
    
    // Read data
    const dataLength = view.getUint32(offset, false);
    offset += 4;
    const entryData = data.slice(offset, offset + dataLength);
    offset += dataLength;
    
    entries.push({
      path,
      data: entryData,
      isDirectory,
    });
  }
  
  return entries;
}

/** Extract archive to output directory */
export async function extractArchive(
  archiveData: Uint8Array,
  outputPath: string
): Promise<void> {
  const entries = deserializeArchive(archiveData);
  const { mkdirSync } = await import("fs");
  const { writeFile } = await import("../core/fileReader.ts");
  
  for (const entry of entries) {
    const fullPath = join(outputPath, entry.path);
    
    if (entry.isDirectory) {
      mkdirSync(fullPath, { recursive: true });
    } else {
      // Create parent directory
      const parentDir = fullPath.split(/[/\\]/).slice(0, -1).join(sep);
      if (parentDir) {
        mkdirSync(parentDir, { recursive: true });
      }
      await writeFile(fullPath, entry.data);
    }
  }
}

/** Check if path is a compressed file */
export function isCompressedFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop();
  return ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext || "");
}
