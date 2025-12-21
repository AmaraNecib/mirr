// Core type definitions for the visual file storage system

/** RGB color representation */
export interface Color {
  r: number;
  g: number;
  b: number;
}

/** Color palette configuration */
export interface ColorPalette {
  colors: Color[];
  size: number;
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
  magic: Uint8Array; // Magic bytes: "CFTFF"
  version: number;
  config: EncodingConfig;
  metadata: FileMetadata;
  totalDataLength: number;
  globalChecksum: string;
  encryptionEnabled: boolean;
}

/** Frame structure */
export interface Frame {
  index: number;
  payloadLength: number;
  payload: Uint8Array;
  checksum: string;
}

/** Complete encoded data structure */
export interface EncodedData {
  header: GlobalHeader;
  frames: Frame[];
  endMarker: Uint8Array;
}

/** Symbol representation (intermediate encoding) */
export interface Symbol {
  value: number;
  colorIndex: number;
}

/** Visual block (NxN pixels with same color) */
export interface VisualBlock {
  x: number;
  y: number;
  size: number;
  color: Color;
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
}

/** Decoding options from CLI */
export interface DecodeOptions {
  inputPath: string;
  outputFile: string;
  paletteSize: number;
  blockSize: number;
  extractArchive?: boolean;
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
