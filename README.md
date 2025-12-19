# CFTFF - Visual File Storage System

A CLI tool to encode any file as visual data (images/video frames) using a configurable color palette, with optional RSA encryption.

## Features

- **Universal file support**: Encode any file type (binary-safe)
- **Loss-tolerant encoding**: Uses color quantization and block-based encoding
- **Configurable palette**: Default 16-color palette (extensible)
- **Optional RSA encryption**: Secure your data before visual encoding
- **Bit-perfect restoration**: Decode files exactly as they were
- **Frame-based protocol**: Paginated encoding with checksums

## Installation

```bash
bun install
```

## Usage

### Encode a file

```bash
bun run encode <inputFile> <outputDir> [options]

# Example
bun run encode document.pdf ./output --palette-size 16 --block-size 4
```

### Decode a file

```bash
bun run decode <inputDir> <outputFile> [options]

# Example
bun run decode ./output document.pdf
```

### Options

- `--encrypt`: Enable RSA encryption (requires keys in .env)
- `--palette-size <number>`: Colors in palette (default: 16)
- `--block-size <number>`: Pixels per symbol (default: 4)

## Configuration

Copy `.env.example` to `.env` and add RSA keys for encryption support.

## Architecture

```
src/
├── cli.ts                 # CLI entry point
├── config/
│   └── settings.ts        # Configuration management
├── types/
│   └── index.ts          # Core interfaces and types
├── core/
│   ├── fileReader.ts     # File I/O operations
│   ├── metadata.ts       # Metadata extraction
│   ├── encryption.ts     # RSA encryption layer
│   ├── encoder.ts        # Bytes to symbols encoding
│   ├── visualMapper.ts   # Symbol to color mapping
│   ├── frameBuilder.ts   # Frame construction
│   ├── decoder.ts        # Visual to bytes decoding
│   └── protocol.ts       # Binary protocol handling
├── pipeline/
│   ├── encodePipeline.ts # Encoding workflow
│   └── decodePipeline.ts # Decoding workflow
└── utils/
    ├── checksum.ts       # Checksum utilities
    ├── palette.ts        # Color palette definitions
    └── imageWriter.ts    # Image output utilities
```

## Protocol Structure

Each encoded file follows this structure:

1. **Global Header**: Magic bytes, version, settings, metadata, checksums
2. **Frame Data**: Paginated payload with per-frame checksums
3. **End Marker**: Termination signal

## License

MIT
