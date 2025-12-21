# CFTFF - Convert Files To Frames/Files

Encode any file as a lossless video using True Color (24-bit) encoding. Handles files of any size with automatic multi-part processing.

## Quick Start

```bash
# Encode
bun run encode input.txt output

# Decode  
bun run decode output result.txt
```

## Features

- ✅ **True Color (24-bit)** - Lossless data recovery
- ✅ **Any File Size** - Automatic multi-part for large files
- ✅ **Encryption** - Optional RSA-2048 encryption
- ✅ **Compression** - Optional gzip compression
- ✅ **Progress Tracking** - Real-time progress with ETA
- ✅ **Auto Cleanup** - Temporary files removed automatically

## Installation

```bash
# Clone repository
git clone <repo-url>
cd cftff

# Install Bun (if not installed)
curl -fsSL https://bun.sh/install | bash

# Verify FFmpeg is installed
ffmpeg -version
```

## Usage

### Basic

```bash
# Encode a file
bun run encode input.txt output

# Decode
bun run decode output result.txt

# Encode a directory
bun run encode my-folder output
```

### With Options

```bash
# Encryption
bun run encode secret.txt output --encryption

# Compression
bun run encode data.bin output --compress

# Custom settings
bun run encode input.txt output --fps 60 --frame 3840x2160

# Combined
bun run encode input.txt output --encryption --compress
```

## Examples

See the `examples/` directory:
- `basic.ts` - Basic usage examples
- `encryption.ts` - Encryption setup and usage

## How It Works

**Small Files (<1.5GB):**
- Encodes directly to video
- Fast and efficient

**Large Files (>1.5GB):**
- Automatically splits into 1.5GB chunks
- Encodes each chunk separately
- Reassembles on decode
- Cleans up temporary files

## Technical Details

- **Encoding**: 24-bit RGB (3 bytes/pixel)
- **Video Format**: H.265/HEVC lossless
- **Chunk Size**: 1.5GB (for large files)
- **Memory Usage**: ~4GB peak per chunk
- **Encryption**: RSA-2048
- **Compression**: gzip

## Requirements

- [Bun](https://bun.sh) runtime
- [FFmpeg](https://ffmpeg.org) with libx265

## Contributing

Contributions welcome! Please ensure:
- Code follows existing style
- Add tests for new features
- Update documentation

## License

MIT

## Acknowledgments

Built with Bun and FFmpeg
