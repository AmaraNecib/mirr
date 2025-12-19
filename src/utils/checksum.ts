/** Checksum utilities using CRC32 and SHA-256 */

/** Calculate CRC32 checksum */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = makeCRC32Table();
  
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ data[i]) & 0xff];
  }
  
  return (crc ^ 0xffffffff) >>> 0;
}

/** Generate CRC32 lookup table */
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

/** Calculate SHA-256 checksum (hex string) */
export async function sha256(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Calculate checksum as hex string */
export async function calculateChecksum(data: Uint8Array): Promise<string> {
  return await sha256(data);
}

/** Verify checksum */
export async function verifyChecksum(
  data: Uint8Array,
  expectedChecksum: string
): Promise<boolean> {
  const actualChecksum = await calculateChecksum(data);
  return actualChecksum === expectedChecksum;
}
