// Core type definitions for the visual file storage system

/** RGB color representation */
export interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}

/** Color palette configuration */
export interface ColorPalette {
  colors: Color[];
  size: number;
}

/** Visual block (NxN pixels with same color) */
export interface VisualBlock {
  x: number;
  y: number;
  size: number;
  color: Color;
}

/** File metadata */
export interface FileMetadata {
  name: string;
  size: number;
  mimeType: string;
  checksum: string;
  createdAt: Date;
  modifiedAt: Date;
}

/** Encoding configuration */
export interface EncodingConfig {
  paletteSize: number;
  blockSize: number;
  frameWidth: number;
  frameHeight: number;
  encrypted: boolean;
  compressed: boolean;
  version: number;
}

/** Global header structure */
export interface GlobalHeader {
  magic: Uint8Array;
  version: number;
  config: EncodingConfig;
  metadata: FileMetadata;
  dataLength: number;
  headerSize: number;
}

/** Encoding options from CLI */
export interface EncodeOptions {
  inputFile: string;
  outputPath: string;
  encrypt: boolean;
  paletteSize: number;
  blockSize: number;
  frameWidth: number;
  frameHeight: number;
  compress: boolean;
  outputFormat: 'video' | 'frames' | 'single-image';
  fps?: number;
  threads?: number;
  showProgress: boolean;
  keepFrames: boolean;
  mimeType?: string;
}

/** Decoding options from CLI */
export interface DecodeOptions {
  inputPath: string;
  outputPath: string; // Stay with outputPath as it's more descriptive for potentially multiple files
  extract?: boolean;   // Stay with extract as it's shorter
  paletteSize: number;
  blockSize: number;
  threads?: number;
  showProgress: boolean;
}

/** Encryption keys */
export interface EncryptionKeys {
  publicKey: string;
  privateKey: string;
}

/** Pipeline result */
export interface PipelineResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}
