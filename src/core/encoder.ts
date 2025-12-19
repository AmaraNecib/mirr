import type { Symbol } from "../types/index.ts";

/** Encode bytes to symbols using palette size */
export function encodeToSymbols(data: Uint8Array, paletteSize: number): Symbol[] {
  const symbols: Symbol[] = [];
  const bitsPerSymbol = Math.ceil(Math.log2(paletteSize));
  
  // Convert bytes to bit string for easier manipulation
  let bitBuffer = "";
  for (const byte of data) {
    bitBuffer += byte.toString(2).padStart(8, "0");
  }
  
  // Extract symbols from bit buffer
  for (let i = 0; i < bitBuffer.length; i += bitsPerSymbol) {
    const symbolBits = bitBuffer.slice(i, i + bitsPerSymbol);
    if (symbolBits.length === 0) break;
    
    // Pad with zeros if necessary
    const paddedBits = symbolBits.padEnd(bitsPerSymbol, "0");
    const value = parseInt(paddedBits, 2);
    
    // Ensure value is within palette range
    const colorIndex = Math.min(value, paletteSize - 1);
    
    symbols.push({ value, colorIndex });
  }
  
  return symbols;
}

/** Decode symbols back to bytes */
export function decodeFromSymbols(
  symbols: Symbol[],
  paletteSize: number,
  originalByteLength: number
): Uint8Array {
  const bitsPerSymbol = Math.ceil(Math.log2(paletteSize));
  
  // Reconstruct bit string from symbols
  let bitBuffer = "";
  for (const symbol of symbols) {
    bitBuffer += symbol.value.toString(2).padStart(bitsPerSymbol, "0");
  }
  
  // Convert bit string back to bytes
  const bytes: number[] = [];
  for (let i = 0; i < bitBuffer.length && bytes.length < originalByteLength; i += 8) {
    const byteBits = bitBuffer.slice(i, i + 8);
    if (byteBits.length === 8) {
      bytes.push(parseInt(byteBits, 2));
    }
  }
  
  return new Uint8Array(bytes);
}

/** Calculate symbols per frame based on dimensions and block size */
export function calculateSymbolsPerFrame(
  frameWidth: number,
  frameHeight: number,
  blockSize: number
): number {
  const blocksX = Math.floor(frameWidth / blockSize);
  const blocksY = Math.floor(frameHeight / blockSize);
  return blocksX * blocksY;
}

/** Calculate required number of frames */
export function calculateRequiredFrames(
  dataLength: number,
  paletteSize: number,
  symbolsPerFrame: number
): number {
  const bitsPerSymbol = Math.ceil(Math.log2(paletteSize));
  const totalBits = dataLength * 8;
  const totalSymbols = Math.ceil(totalBits / bitsPerSymbol);
  return Math.ceil(totalSymbols / symbolsPerFrame);
}
