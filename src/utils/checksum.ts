/**
 * Checksum utilities: CRC32 (in-memory) and SHA-256 (streaming or in-memory).
 */

import { createHash } from "crypto";

/** Calculate CRC32 checksum of a buffer. */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = makeCRC32Table();

  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeCRC32Table(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  return table;
}

/** Calculate SHA-256 checksum of a buffer (hex string). */
export async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Calculate checksum as hex string. */
export async function calculateChecksum(data: Uint8Array): Promise<string> {
  return await sha256(data);
}

/** Stateful streaming SHA-256 for use on `ReadableStream` chunks. */
export class StreamingChecksum {
  private hash = createHash("sha256");

  update(chunk: Uint8Array): void {
    this.hash.update(chunk);
  }

  digest(): string {
    return this.hash.digest("hex");
  }
}
