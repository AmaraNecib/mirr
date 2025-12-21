import type { GlobalHeader, Frame, EncodedData, EncodingConfig, FileMetadata } from "../types/index.ts";
import { DEFAULT_CONFIG } from "../config/settings.ts";
import { serializeMetadata } from "./metadata.ts";
import { calculateChecksum } from "../utils/checksum.ts";

/** Build global header */
export async function buildGlobalHeader(
  config: EncodingConfig,
  metadata: FileMetadata,
  totalDataLength: number,
  globalChecksum: string,
  encryptionEnabled: boolean
): Promise<GlobalHeader> {
  return {
    magic: DEFAULT_CONFIG.MAGIC_BYTES,
    version: config.version,
    config,
    metadata,
    totalDataLength,
    globalChecksum,
    encryptionEnabled,
  };
}

/** Serialize global header to bytes */
export async function serializeHeader(header: GlobalHeader): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  
  // Magic bytes are already encoded
  const magicBytes = header.magic;
  
  // Serialize config
  const configData = new Uint8Array(25);
  const configView = new DataView(configData.buffer);
  configView.setUint32(0, header.config.paletteSize, false);
  configView.setUint32(4, header.config.blockSize, false);
  configView.setUint32(8, header.config.frameWidth, false);
  configView.setUint32(12, header.config.frameHeight, false);
  configView.setUint8(16, header.config.encrypted ? 1 : 0);
  configView.setUint32(17, header.config.version, false);
  configView.setUint8(21, header.encryptionEnabled ? 1 : 0);
  configView.setUint8(22, header.config.compressed ? 1 : 0);
  
  // Serialize metadata
  const metadataBytes = serializeMetadata(header.metadata);
  
  // Serialize checksum
  const checksumBytes = encoder.encode(header.globalChecksum);
  
  // Calculate total size
  const totalSize =
    magicBytes.length +
    4 + // version
    configData.length +
    4 + // metadata length
    metadataBytes.length +
    8 + // total data length
    4 + // checksum length
    checksumBytes.length;
  
  const buffer = new Uint8Array(totalSize);
  let offset = 0;
  
  // Write magic bytes
  buffer.set(magicBytes, offset);
  offset += magicBytes.length;
  
  // Write version
  new DataView(buffer.buffer).setUint32(offset, header.version, false);
  offset += 4;
  
  // Write config
  buffer.set(configData, offset);
  offset += configData.length;
  
  // Write metadata
  new DataView(buffer.buffer).setUint32(offset, metadataBytes.length, false);
  offset += 4;
  buffer.set(metadataBytes, offset);
  offset += metadataBytes.length;
  
  // Write total data length
  new DataView(buffer.buffer).setBigUint64(offset, BigInt(header.totalDataLength), false);
  offset += 8;
  
  // Write checksum
  new DataView(buffer.buffer).setUint32(offset, checksumBytes.length, false);
  offset += 4;
  buffer.set(checksumBytes, offset);
  
  return buffer;
}

/** Build a frame */
export async function buildFrame(
  index: number,
  payload: Uint8Array
): Promise<Frame> {
  const checksum = await calculateChecksum(payload);
  
  return {
    index,
    payloadLength: payload.length,
    payload,
    checksum,
  };
}
