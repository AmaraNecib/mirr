/**
 * Encode bytes directly to RGB pixels (24-bit color).
 * Returns a Uint8Array of width × height × 3 bytes (RGB24, no alpha).
 * Zero-fills any tail pixels so the frame count is always predictable.
 */
export function encodeToPixels(
  data: Uint8Array,
  width: number,
  height: number
): Uint8Array {
  const pixels = new Uint8Array(width * height * 3);
  const max = data.length;
  let dataIndex = 0;

  for (let i = 0; i < width * height; i++) {
    const pixelIndex = i * 3;
    pixels[pixelIndex] = dataIndex < max ? data[dataIndex++] : 0;
    pixels[pixelIndex + 1] = dataIndex < max ? data[dataIndex++] : 0;
    pixels[pixelIndex + 2] = dataIndex < max ? data[dataIndex++] : 0;
  }

  return pixels;
}

/**
 * Decode RGB pixels back to bytes. Stops once `originalDataLength` is reached.
 */
export function decodeFromPixels(
  pixels: Uint8Array,
  originalDataLength: number
): Uint8Array {
  const data = new Uint8Array(originalDataLength);
  let dataIndex = 0;

  for (let i = 0; i < pixels.length; i += 3) {
    if (dataIndex >= originalDataLength) break;
    data[dataIndex++] = pixels[i];
    if (dataIndex >= originalDataLength) break;
    data[dataIndex++] = pixels[i + 1];
    if (dataIndex >= originalDataLength) break;
    data[dataIndex++] = pixels[i + 2];
  }

  return data;
}

/** Calculate required frames for 24-bit mode (3 bytes per pixel). */
export function calculateRequiredFrames24Bit(
  dataLength: number,
  pixelsPerFrame: number
): number {
  const bytesPerFrame = pixelsPerFrame * 3;
  return Math.ceil(dataLength / bytesPerFrame);
}