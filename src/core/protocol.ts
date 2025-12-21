import type { GlobalHeader, EncodingConfig, FileMetadata } from "../types/index.ts";
import { DEFAULT_CONFIG } from "../config/settings.ts";

/** Build global header */
export async function buildGlobalHeader(
  config: EncodingConfig,
  metadata: FileMetadata,
  dataLength: number,
  globalChecksum: string,
  encryptionEnabled: boolean
): Promise<GlobalHeader> {
  return {
    magic: new TextEncoder().encode(DEFAULT_CONFIG.MAGIC),
    version: config.version,
    config,
    metadata,
    dataLength,
    headerSize: 0, // Will be calculated on serialization
  };
}

/** Serialize global header to bytes */
export async function serializeHeader(header: GlobalHeader): Promise<Uint8Array> {
  const encoder = new TextEncoder();

  const nameBytes = encoder.encode(header.metadata.name);
  const mimeBytes = encoder.encode(header.metadata.mimeType);
  const checksumBytes = encoder.encode(header.metadata.checksum);

  // Total size calculation
  // Magic (5) + Version (4) + Config (25) + Metadata (Len info + data) + DataLength (8)
  const metadataSize = 4 + nameBytes.length + 8 + 4 + mimeBytes.length + 4 + checksumBytes.length + 16;
  const totalSize = 5 + 4 + 25 + 4 + metadataSize + 8;

  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;

  // Magic
  buffer.set(header.magic, offset); offset += 5;

  // Version
  view.setUint32(offset, header.version, false); offset += 4;

  // Config
  view.setUint32(offset, header.config.paletteSize, false); offset += 4;
  view.setUint32(offset, header.config.blockSize, false); offset += 4;
  view.setUint32(offset, header.config.frameWidth, false); offset += 4;
  view.setUint32(offset, header.config.frameHeight, false); offset += 4;
  view.setUint8(offset, header.config.encrypted ? 1 : 0); offset += 1;
  view.setUint32(offset, header.config.version, false); offset += 4;
  view.setUint8(offset, header.config.compressed ? 1 : 0); offset += 1;
  view.setUint8(offset, 0); offset += 3; // Alignment padding

  // Metadata
  view.setUint32(offset, metadataSize, false); offset += 4;
  view.setUint32(offset, nameBytes.length, false); offset += 4;
  buffer.set(nameBytes, offset); offset += nameBytes.length;
  view.setBigUint64(offset, BigInt(header.metadata.size), false); offset += 8;
  view.setUint32(offset, mimeBytes.length, false); offset += 4;
  buffer.set(mimeBytes, offset); offset += mimeBytes.length;
  view.setUint32(offset, checksumBytes.length, false); offset += 4;
  buffer.set(checksumBytes, offset); offset += checksumBytes.length;
  view.setBigUint64(offset, BigInt(header.metadata.createdAt.getTime()), false); offset += 8;
  view.setBigUint64(offset, BigInt(header.metadata.modifiedAt.getTime()), false); offset += 8;

  // Data Length
  view.setBigUint64(offset, BigInt(header.dataLength), false);

  return buffer;
}

/** Parse global header from bytes */
export async function parseHeader(data: Uint8Array): Promise<GlobalHeader> {
  const decoder = new TextDecoder();
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  const magic = decoder.decode(data.slice(0, 5));
  if (magic !== DEFAULT_CONFIG.MAGIC) throw new Error("Invalid magic bytes");
  offset += 5;

  const version = view.getUint32(offset, false); offset += 4;

  const config: EncodingConfig = {
    paletteSize: view.getUint32(offset, false),
    blockSize: (offset += 4, view.getUint32(offset, false)),
    frameWidth: (offset += 4, view.getUint32(offset, false)),
    frameHeight: (offset += 4, view.getUint32(offset, false)),
    encrypted: (offset += 4, view.getUint8(offset) === 1),
    version: (offset += 1, view.getUint32(offset, false)),
    compressed: (offset += 4, view.getUint8(offset) === 1)
  };
  offset += 4; // Skip padding

  const metadataSize = view.getUint32(offset, false); offset += 4;
  const metadataStart = offset;

  const nameLen = view.getUint32(offset, false); offset += 4;
  const name = decoder.decode(data.slice(offset, offset + nameLen)); offset += nameLen;
  const size = Number(view.getBigUint64(offset, false)); offset += 8;
  const mimeLen = view.getUint32(offset, false); offset += 4;
  const mimeType = decoder.decode(data.slice(offset, offset + mimeLen)); offset += mimeLen;
  const checksumLen = view.getUint32(offset, false); offset += 4;
  const checksum = decoder.decode(data.slice(offset, offset + checksumLen)); offset += checksumLen;
  const createdAt = new Date(Number(view.getBigUint64(offset, false))); offset += 8;
  const modifiedAt = new Date(Number(view.getBigUint64(offset, false))); offset += 8;

  const dataLength = Number(view.getBigUint64(metadataStart + metadataSize, false));

  return {
    magic: data.slice(0, 5),
    version,
    config,
    metadata: { name, size, mimeType, checksum, createdAt, modifiedAt },
    dataLength,
    headerSize: metadataStart + metadataSize + 8
  };
}
