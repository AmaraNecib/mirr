import type { GlobalHeader, Frame, EncodingConfig } from "../types/index.ts";
import { DEFAULT_CONFIG } from "../config/settings.ts";
import { deserializeMetadata } from "./metadata.ts";

/** Deserialize global header from bytes */
export function deserializeHeader(data: Uint8Array): {
  header: GlobalHeader;
  bytesRead: number;
} {
  const decoder = new TextDecoder();
  // Use data buffer directly with proper offset
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  // Read magic bytes
  const magicLength = DEFAULT_CONFIG.MAGIC_BYTES.length;
  const magic = data.slice(offset, offset + magicLength);
  offset += magicLength;
  
  // Verify magic bytes
  if (!arraysEqual(magic, DEFAULT_CONFIG.MAGIC_BYTES)) {
    throw new Error("Invalid magic bytes - not a CFTFF file");
  }
  
  // Read version
  const version = view.getUint32(offset, false);
  offset += 4;
  
  // Read config (24 bytes total)
  const paletteSize = view.getUint32(offset, false);
  offset += 4;
  const blockSize = view.getUint32(offset, false);
  offset += 4;
  const frameWidth = view.getUint32(offset, false);
  offset += 4;
  const frameHeight = view.getUint32(offset, false);
  offset += 4;
  const encrypted = view.getUint8(offset) === 1;
  offset += 1;
  const configVersion = view.getUint32(offset, false);
  offset += 4;
  const encryptionEnabled = view.getUint8(offset) === 1;
  offset += 1;
  // Skip padding bytes (config is 24 bytes total, we've read 22)
  offset += 2;
  
  const config: EncodingConfig = {
    paletteSize,
    blockSize,
    frameWidth,
    frameHeight,
    encrypted,
    version: configVersion,
  };
  
  // Read metadata
  const metadataLength = view.getUint32(offset, false);
  offset += 4;
  const metadataBytes = data.slice(offset, offset + metadataLength);
  const metadata = deserializeMetadata(metadataBytes);
  offset += metadataLength;
  
  // Read total data length
  const totalDataLength = Number(view.getBigUint64(offset, false));
  offset += 8;
  
  // Read checksum
  const checksumLength = view.getUint32(offset, false);
  offset += 4;
  const globalChecksum = decoder.decode(data.slice(offset, offset + checksumLength));
  offset += checksumLength;
  
  return {
    header: {
      magic,
      version,
      config,
      metadata,
      totalDataLength,
      globalChecksum,
      encryptionEnabled,
    },
    bytesRead: offset,
  };
}

/** Deserialize frame from bytes */
export function deserializeFrame(data: Uint8Array): {
  frame: Frame;
  bytesRead: number;
} {
  const decoder = new TextDecoder();
  // Use data buffer directly with proper offset
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  // Read index
  const index = view.getUint32(offset, false);
  offset += 4;
  
  // Read payload length
  const payloadLength = view.getUint32(offset, false);
  offset += 4;
  
  // Read payload
  const payload = data.slice(offset, offset + payloadLength);
  offset += payloadLength;
  
  // Read checksum
  const checksumLength = view.getUint32(offset, false);
  offset += 4;
  const checksum = decoder.decode(data.slice(offset, offset + checksumLength));
  offset += checksumLength;
  
  return {
    frame: {
      index,
      payloadLength,
      payload,
      checksum,
    },
    bytesRead: offset,
  };
}

/** Helper to compare byte arrays */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
