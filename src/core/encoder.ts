import type { Color } from "../types/index.ts";

/** 
 * Encode bytes directly to RGB pixels (24-bit color)
 * Returns Uint8Array of RGBA values (width * height * 4)
 */
export function encodeToPixels(
  data: Uint8Array,
  width: number,
  height: number,
  paddingColor: Color = { r: 0, g: 0, b: 0 }
): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  let dataIndex = 0;

  for (let i = 0; i < width * height; i++) {
    const pixelIndex = i * 4;

    if (dataIndex < data.length) {
      // We have data for at least R
      pixels[pixelIndex] = data[dataIndex++]; // R

      // G
      if (dataIndex < data.length) {
        pixels[pixelIndex + 1] = data[dataIndex++];
      } else {
        pixels[pixelIndex + 1] = paddingColor.g;
      }

      // B
      if (dataIndex < data.length) {
        pixels[pixelIndex + 2] = data[dataIndex++];
      } else {
        pixels[pixelIndex + 2] = paddingColor.b;
      }

      pixels[pixelIndex + 3] = 255; // Alpha always 255
    } else {
      // Padding pixel (black)
      pixels[pixelIndex] = paddingColor.r;
      pixels[pixelIndex + 1] = paddingColor.g;
      pixels[pixelIndex + 2] = paddingColor.b;
      pixels[pixelIndex + 3] = 255;
    }
  }

  return pixels;
}

/** 
 * Decode RGB pixels (from RGBA buffer) back to bytes
 */
export function decodeFromPixels(
  pixels: Uint8Array,
  originalDataLength: number
): Uint8Array {
  const data = new Uint8Array(originalDataLength);
  let dataIndex = 0;

  // Process each pixel
  for (let i = 0; i < pixels.length; i += 4) {
    if (dataIndex >= originalDataLength) break;
    data[dataIndex++] = pixels[i];     // R

    if (dataIndex >= originalDataLength) break;
    data[dataIndex++] = pixels[i + 1]; // G

    if (dataIndex >= originalDataLength) break;
    data[dataIndex++] = pixels[i + 2]; // B
  }

  return data;
}

/** Calculate required frames for 24-bit mode (3 bytes per pixel) */
export function calculateRequiredFrames24Bit(
  dataLength: number,
  pixelsPerFrame: number
): number {
  const bytesPerFrame = pixelsPerFrame * 3;
  return Math.ceil(dataLength / bytesPerFrame);
}
