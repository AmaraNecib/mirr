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
  
  // Serialize config
  const configData = new Uint8Array(24);
  const configView = new DataView(configData.buffer);
  configView.setUint32(0, header.config.paletteSize, false);
  configView.setUint32(4, header.config.blockSize, false);
  configView.setUint32(8, header.config.frameWidth, false);
  configView.setUint32(12, header.config.frameHeight, false);
  configView.setUint8(16, header.config.encrypted ? 1 : 0);
  configView.setUint32(17, header.config.version, false);
  configView.setUint8(21, header.encryptionEnabled ? 1 : 0);
  
  // Serialize metadata
  const metadataBytes = serializeMetadata(header.metadata);
  
  // Serialize checksum
  const checksumBytes = encoder.encode(header.globalChecksum);
  
  // Calculate total size
  const totalSize =
    header.magic.length +
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
  buffer.set(header.magic, offset);
  offset += header.magic.length;
  
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

/** Serialize frame to bytes */
export async function serializeFrame(frame: Frame): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const checksumBytes = encoder.encode(frame.checksum);
  
  const totalSize =
    4 + // index
    4 + // payload length
    frame.payload.length +
    4 + // checksum length
    checksumBytes.length;
  
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  
  // Write index
  view.setUint32(offset, frame.index, false);
  offset += 4;
  
  // Write payload length
  view.setUint32(offset, frame.payloadLength, false);
  offset += 4;
  
  // Write payload
  buffer.set(frame.payload, offset);
  offset += frame.payload.length;
  
  // Write checksum
  view.setUint32(offset, checksumBytes.length, false);
  offset += 4;
  buffer.set(checksumBytes, offset);
  
  return buffer;
}

/** Split data into frames */
export async function splitIntoFrames(
  data: Uint8Array,
  bytesPerFrame: number
): Promise<Frame[]> {
  const frames: Frame[] = [];
  let offset = 0;
  let index = 0;
  
  while (offset < data.length) {
    const chunkSize = Math.min(bytesPerFrame, data.length - offset);
    const payload = data.slice(offset, offset + chunkSize);
    
    const frame = await buildFrame(index, payload);
    frames.push(frame);
    
    offset += chunkSize;
    index++;
  }
  
  return frames;
}

/** Build complete encoded data structure */
export async function buildEncodedData(
  config: EncodingConfig,
  metadata: FileMetadata,
  data: Uint8Array,
  encryptionEnabled: boolean
): Promise<EncodedData> {
  const globalChecksum = await calculateChecksum(data);
  
  const header = await buildGlobalHeader(
    config,
    metadata,
    data.length,
    globalChecksum,
    encryptionEnabled
  );
  
  // Calculate bytes per frame based on symbols per frame
  const blocksX = Math.floor(config.frameWidth / config.blockSize);
  const blocksY = Math.floor(config.frameHeight / config.blockSize);
  const symbolsPerFrame = blocksX * blocksY;
  const bitsPerSymbol = Math.ceil(Math.log2(config.paletteSize));
  const bytesPerFrame = Math.floor((symbolsPerFrame * bitsPerSymbol) / 8);
  
  const frames = await splitIntoFrames(data, bytesPerFrame);
  
  return {
    header,
    frames,
    endMarker: DEFAULT_CONFIG.END_MARKER,
  };
}
