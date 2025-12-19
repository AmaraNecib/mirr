import type { FileMetadata } from "../types/index.ts";

/** Serialize metadata to binary format */
export function serializeMetadata(metadata: FileMetadata): Uint8Array {
  const encoder = new TextEncoder();
  
  // Encode strings
  const nameBytes = encoder.encode(metadata.name);
  const mimeTypeBytes = encoder.encode(metadata.mimeType);
  const checksumBytes = encoder.encode(metadata.checksum);
  
  // Calculate total size
  const totalSize =
    4 + // name length
    nameBytes.length +
    8 + // size (64-bit)
    4 + // mime type length
    mimeTypeBytes.length +
    4 + // checksum length
    checksumBytes.length +
    8 + // createdAt timestamp
    8; // modifiedAt timestamp
  
  const buffer = new Uint8Array(totalSize);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  
  // Write name
  view.setUint32(offset, nameBytes.length, false);
  offset += 4;
  buffer.set(nameBytes, offset);
  offset += nameBytes.length;
  
  // Write size (using BigInt for 64-bit)
  view.setBigUint64(offset, BigInt(metadata.size), false);
  offset += 8;
  
  // Write mime type
  view.setUint32(offset, mimeTypeBytes.length, false);
  offset += 4;
  buffer.set(mimeTypeBytes, offset);
  offset += mimeTypeBytes.length;
  
  // Write checksum
  view.setUint32(offset, checksumBytes.length, false);
  offset += 4;
  buffer.set(checksumBytes, offset);
  offset += checksumBytes.length;
  
  // Write timestamps
  view.setBigUint64(offset, BigInt(metadata.createdAt.getTime()), false);
  offset += 8;
  view.setBigUint64(offset, BigInt(metadata.modifiedAt.getTime()), false);
  
  return buffer;
}

/** Deserialize metadata from binary format */
export function deserializeMetadata(data: Uint8Array): FileMetadata {
  const decoder = new TextDecoder();
  // Use data buffer directly with proper offset
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;
  
  // Read name
  const nameLength = view.getUint32(offset, false);
  offset += 4;
  const name = decoder.decode(data.slice(offset, offset + nameLength));
  offset += nameLength;
  
  // Read size
  const size = Number(view.getBigUint64(offset, false));
  offset += 8;
  
  // Read mime type
  const mimeTypeLength = view.getUint32(offset, false);
  offset += 4;
  const mimeType = decoder.decode(data.slice(offset, offset + mimeTypeLength));
  offset += mimeTypeLength;
  
  // Read checksum
  const checksumLength = view.getUint32(offset, false);
  offset += 4;
  const checksum = decoder.decode(data.slice(offset, offset + checksumLength));
  offset += checksumLength;
  
  // Read timestamps
  const createdAt = new Date(Number(view.getBigUint64(offset, false)));
  offset += 8;
  const modifiedAt = new Date(Number(view.getBigUint64(offset, false)));
  
  return { name, size, mimeType, checksum, createdAt, modifiedAt };
}
