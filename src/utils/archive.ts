import { readdirSync, statSync, createWriteStream, createReadStream, existsSync, unlinkSync } from "fs";
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

  // For large single files (>1.5GB), split before archiving
  if (stats.isFile() && stats.size > 1.5 * 1024 * 1024 * 1024) {
    console.log(`Large file detected (${(stats.size / 1024 / 1024 / 1024).toFixed(2)}GB), splitting into chunks...`);

    const fs = await import("fs");
    const tempDir = join(process.cwd(), `.mirr-temp-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const fileName = inputPath.split(/[/\\]/).pop() || "file";
    const CHUNK_SIZE = 1.5 * 1024 * 1024 * 1024;
    const totalChunks = Math.ceil(stats.size / CHUNK_SIZE);

    const file = Bun.file(inputPath);
    for (let i = 0; i < totalChunks; i++) {
      const offset = i * CHUNK_SIZE;
      const chunkSize = Math.min(CHUNK_SIZE, stats.size - offset);
      const chunkName = `${fileName}.part${i.toString().padStart(3, '0')}`;
      const chunkPath = join(tempDir, chunkName);

      console.log(`  Creating chunk ${i + 1}/${totalChunks}: ${chunkName} (${(chunkSize / 1024 / 1024).toFixed(2)}MB)`);

      const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
      await Bun.write(chunkPath, chunk);
    }

    console.log(`✓ File split complete\n`);

    // Now archive the chunks directory
    const result = await createArchiveWithCheckpoints(tempDir);

    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch { }

    return result;
  }

  // For directories, use checkpoint-based approach
  if (stats.isDirectory()) {
    return await createArchiveWithCheckpoints(inputPath);
  }

  // For medium single files, return file path
  return { type: 'file', path: inputPath, size: stats.size };
}

/** Create archive using checkpoints to process files in batches */
/** Create archive using checkpoints to process files in batches */
async function createArchiveWithCheckpoints(inputPath: string): Promise<ArchiveResult> {
  const fs = await import("fs");

  // Use current directory for temp files to avoid running out of space
  const tempDir = join(process.cwd(), `.mirr-temp-${Date.now()}`);

  try {
    // Create temp directory for checkpoints
    fs.mkdirSync(tempDir, { recursive: true });

    // Collect all file info without loading data
    const entryInfos: { path: string; size: number; isDirectory: boolean; fullPath?: string }[] = [];
    await collectEntryInfo(inputPath, inputPath, entryInfos);

    const encoder = new TextEncoder();

    // Calculate final archive size ahead of time
    let finalSize = 4; // entry count
    for (const info of entryInfos) {
      const pathBytes = encoder.encode(info.path);
      // Per-entry: pathLen(4) + path + isDir(1) + dataLen(4) + data
      finalSize += 4 + pathBytes.length + 1 + 4 + info.size;
    }

    // Determine output file
    const finalFile = join(tempDir, 'archive.bin');
    const finalStream = fs.createWriteStream(finalFile);

    // Write Entry Count
    const headerBuffer = new Uint8Array(4);
    new DataView(headerBuffer.buffer).setUint32(0, entryInfos.length, false);

    await new Promise<void>((resolve, reject) => {
      finalStream.write(headerBuffer, (err) => err ? reject(err) : resolve());
    });

    let totalWritten = 4; // count header
    const CHUNK_READ_SIZE = 50 * 1024 * 1024; // 50MB chunks

    for (const info of entryInfos) {
      const pathBytes = encoder.encode(info.path);

      // Per-entry: pathLen(4) + path + isDir(1) + dataLen(4) — matches deserializeArchive
      const metaSize = 4 + pathBytes.length + 1 + 4;
      const metaBuffer = new Uint8Array(metaSize);
      const view = new DataView(metaBuffer.buffer);

      let offset = 0;
      view.setUint32(offset, pathBytes.length, false);
      offset += 4;
      metaBuffer.set(pathBytes, offset);
      offset += pathBytes.length;
      view.setUint8(offset, info.isDirectory ? 1 : 0);
      offset += 1;
      view.setUint32(offset, info.size, false);
      offset += 4;

      // Write Metadata
      await new Promise<void>((resolve, reject) => {
        finalStream.write(metaBuffer, (err) => err ? reject(err) : resolve());
      });
      totalWritten += metaSize;

      // Write Data (Streamed)
      if (!info.isDirectory && info.fullPath && info.size > 0) {
        const file = Bun.file(info.fullPath);
        let bytesRead = 0;

        while (bytesRead < info.size) {
          const chunkSize = Math.min(CHUNK_READ_SIZE, info.size - bytesRead);
          const chunk = await file.slice(bytesRead, bytesRead + chunkSize).arrayBuffer();

          await new Promise<void>((resolve, reject) => {
            finalStream.write(Buffer.from(chunk), (err) => err ? reject(err) : resolve());
          });

          bytesRead += chunkSize;
          totalWritten += chunkSize;

          if (totalWritten % (100 * 1024 * 1024) < chunkSize) {
            process.stdout.write(`\rArchived: ${(totalWritten / 1024 / 1024).toFixed(2)}MB`);
          }
        }
      }
    }

    // Close stream
    await new Promise<void>((resolve) => finalStream.end(() => resolve()));

    // Return file path
    return { type: 'file', path: finalFile, size: finalSize };

  } catch (error) {
    // Clean up on error
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) { }
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
  const { writeFile } = (await import("fs")).promises;

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


/** Reader helper for AsyncIterable */
class StreamReader {
  private buffer: Uint8Array = new Uint8Array(0);
  private iterator: AsyncIterator<Uint8Array>;
  private done = false;

  constructor(iterable: AsyncIterable<Uint8Array>) {
    this.iterator = iterable[Symbol.asyncIterator]();
  }

  async read(size: number): Promise<Uint8Array> {
    while (this.buffer.length < size) {
      if (this.done) {
        throw new Error(`Unexpected end of stream. Expected ${size} bytes, but only had ${this.buffer.length} available.`);
      }
      const { value, done } = await this.iterator.next();
      if (done) {
        this.done = true;
        if (this.buffer.length < size) {
          throw new Error(`Unexpected end of stream. Expected ${size} bytes, but stream ended with ${this.buffer.length} available.`);
        }
        break;
      }
      const newBuf = new Uint8Array(this.buffer.length + value.length);
      newBuf.set(this.buffer);
      newBuf.set(value, this.buffer.length);
      this.buffer = newBuf;
    }

    const result = this.buffer.slice(0, size);
    this.buffer = this.buffer.slice(size);
    return result;
  }

  /** Stream n bytes to a writable stream with chunking to prevent memory overflow */
  async pipeTo(writer: any, size: number): Promise<void> {
    const CHUNK_SIZE = 1 * 1024 * 1024; // 1MB chunks to prevent memory buildup
    let remaining = size;
    let chunksWritten = 0;

    while (remaining > 0) {
      // Determine how much to read this iteration
      const toRead = Math.min(CHUNK_SIZE, remaining);

      // Read from buffer first
      let chunk: Uint8Array;
      if (this.buffer.length >= toRead) {
        chunk = this.buffer.slice(0, toRead);
        this.buffer = this.buffer.slice(toRead);
      } else {
        // Need more data from iterator
        const needed = toRead - this.buffer.length;
        const accumulated: Uint8Array[] = [this.buffer];
        let accumulatedSize = this.buffer.length;

        while (accumulatedSize < toRead) {
          if (this.done) throw new Error(`Unexpected end of stream. Expected ${size} bytes total, got ${size - remaining + accumulatedSize}.`);

          const { value, done } = await this.iterator.next();
          if (done) {
            this.done = true;
            if (accumulatedSize < toRead) {
              throw new Error(`Unexpected end of stream. Expected ${size} bytes total, stream ended.`);
            }
            break;
          }

          const takeFromValue = Math.min(value.length, toRead - accumulatedSize);
          accumulated.push(value.slice(0, takeFromValue));
          accumulatedSize += takeFromValue;

          if (takeFromValue < value.length) {
            // Save leftover
            this.buffer = value.slice(takeFromValue);
          } else {
            this.buffer = new Uint8Array(0);
          }
        }

        // Combine accumulated chunks
        chunk = new Uint8Array(accumulatedSize);
        let offset = 0;
        for (const part of accumulated) {
          chunk.set(part, offset);
          offset += part.length;
        }
      }

      // Write chunk and wait for drain
      await new Promise<void>((resolve, reject) => {
        const canWrite = writer.write(Buffer.from(chunk), (err: any) => {
          if (err) reject(err);
          else resolve();
        });

        if (!canWrite) {
          writer.once('drain', resolve);
        }
      });

      remaining -= chunk.length;
      chunksWritten++;

      // Force GC every 50MB to release memory
      if (chunksWritten % 50 === 0 && global.gc) {
        global.gc();
      }
    }
  }
}

/** Extract archive from stream to output directory */
export async function extractArchiveFromStream(
  input: AsyncIterable<Uint8Array>,
  outputPath: string,
  showProgress: boolean = true
): Promise<void> {
  const fs = await import("fs");
  const reader = new StreamReader(input);
  const decoder = new TextDecoder();

  // Read Entry Count (4 bytes)
  const header = await reader.read(4);
  const entryCount = new DataView(header.buffer).getUint32(0, false);

  console.log(`Extracting ${entryCount} entries from stream...\n`);

  for (let i = 0; i < entryCount; i++) {
    // Read Path Length (4 bytes)
    const pathLenBuf = await reader.read(4);
    const pathLen = new DataView(pathLenBuf.buffer).getUint32(0, false);

    // Read Path
    const pathBytes = await reader.read(pathLen);
    const path = decoder.decode(pathBytes);

    // Read isDirectory (1 byte)
    const isDirBuf = await reader.read(1);
    const isDirectory = isDirBuf[0] === 1;

    // Read Data Length (8 bytes for 64-bit support)
    const dataLenBuf = await reader.read(8);
    const dataLen = Number(new DataView(dataLenBuf.buffer).getBigUint64(0, false));

    const fullPath = join(outputPath, path);

    if (isDirectory) {
      fs.mkdirSync(fullPath, { recursive: true });
      if (showProgress) {
        process.stdout.write(`\r[${i + 1}/${entryCount}] Creating directory: ${path}`);
      }
    } else {
      // Create parent dir
      const parentDir = fullPath.split(/[/\\]/).slice(0, -1).join(sep);
      if (parentDir) fs.mkdirSync(parentDir, { recursive: true });

      // Stream data to file
      if (dataLen > 0) {
        if (showProgress) {
          process.stdout.write(`\r[${i + 1}/${entryCount}] Extracting: ${path} (${(dataLen / 1024 / 1024).toFixed(2)} MB)...`);
        }

        const writeStream = fs.createWriteStream(fullPath);
        try {
          await reader.pipeTo(writeStream, dataLen);
        } finally {
          await new Promise<void>(resolve => writeStream.end(resolve));
        }

        if (showProgress) {
          process.stdout.write(`\r[${i + 1}/${entryCount}] ✓ Extracted: ${path} (${(dataLen / 1024 / 1024).toFixed(2)} MB)   \n`);
        }
      } else {
        // Empty file
        fs.writeFileSync(fullPath, new Uint8Array(0));
      }
    }
  }

  // Auto-reassemble split files
  const files = fs.readdirSync(outputPath, { recursive: true }) as string[];
  const splitFiles = new Map<string, string[]>();

  for (const file of files) {
    const match = file.match(/^(.+)\.part(\d{3})$/);
    if (match) {
      const [, baseName] = match;
      if (!splitFiles.has(baseName)) {
        splitFiles.set(baseName, []);
      }
      splitFiles.get(baseName)!.push(join(outputPath, file));
    }
  }

  if (splitFiles.size > 0) {
    console.log(`\nReassembling ${splitFiles.size} split file(s)...`);

    for (const [baseName, chunks] of splitFiles) {
      chunks.sort(); // Ensure correct order
      const finalPath = join(outputPath, baseName);
      const parentDir = finalPath.split(/[/\\]/).slice(0, -1).join(sep);
      if (parentDir) fs.mkdirSync(parentDir, { recursive: true });

      console.log(`  Joining ${chunks.length} chunks → ${baseName}`);

      const finalStream = fs.createWriteStream(finalPath);
      for (const chunkPath of chunks) {
        const chunkData = fs.readFileSync(chunkPath);
        await new Promise<void>((resolve, reject) => {
          finalStream.write(chunkData, (err: any) => err ? reject(err) : resolve());
        });
        fs.unlinkSync(chunkPath); // Delete chunk after appending
      }
      await new Promise<void>(resolve => finalStream.end(resolve));

      console.log(`  ✓ Reassembled: ${baseName}`);
    }
  }

  if (showProgress) {
    console.log(`\n✓ Archive extraction complete`);
  } else {
    console.log(`✓ Archive extraction complete`);
  }
}

/** Check if path is a compressed file */
export function isCompressedFile(path: string): boolean {
  const ext = path.toLowerCase().split(".").pop();
  return ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext || "");
}
/** Extract archive from a file on disk */
export async function extractArchiveFromFile(
  archivePath: string,
  outputPath: string,
  showProgress: boolean = true
): Promise<void> {
  const fs = await import("fs");
  const stream = fs.createReadStream(archivePath);

  // Create an AsyncIterable from the ReadStream
  const iterable = (async function* () {
    for await (const chunk of stream) {
      yield new Uint8Array(chunk as Buffer);
    }
  })();

  await extractArchiveFromStream(iterable, outputPath, showProgress);
}
