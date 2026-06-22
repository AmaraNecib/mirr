# mirr — lossless file-in-video codec

Encode any file or folder into a lossless video. Optional Brotli compression and RSA-2048 + AES-256-GCM hybrid encryption, all from the command line. Built on Bun and FFmpeg.

```
input file  ───►  [ brotli?  ──►  RSA+AES?  ──►  video  ]  ───►  output.mkv
                      ↓                ↓
                  optional        optional
```

The video is the file. Decoding is the exact inverse. The result is bit-exact — verified by SHA-256 round-trip in CI.

---

## ⚠️ Do not upload the output to YouTube, Twitter, Discord, etc.

These platforms **re-encode** every uploaded video. The result is not bit-exact — frame data is lossy-transcoded and your original file cannot be recovered. Use the output for:

- **Local archival** (reliable — the file stays a video on your disk)
- **Sharing via file transfer** (Dropbox, S3, rsync, email attachment, USB)
- **Hosting on platforms that preserve the original codec** (own S3 + `<video>` tag, GitHub releases, IPFS with `?pin=raw`)

The output is a normal `.mkv` — it plays in any video player, but treat it like a `.zip`: a container, not a streamable video.

---

## Quick start

```bash
# 1. install
git clone <repo-url> && cd mirr
bun install

# 2. (optional) generate encryption keys — skip if you don't need --encrypt
openssl genrsa -out priv.pem 2048
openssl rsa -in priv.pem -pubout -out pub.pem

# 3. encode (with both flags on — recommended)
export MIRR_PUBLIC_KEY="$(cat pub.pem)"   # anyone with this can ENCODE for you
export MIRR_PRIVATE_KEY="$(cat priv.pem)"  # only you can DECODE
bun run encode ./my-folder ./out --encrypt --compress

# 4. decode
bun run decode ./out ./restored
```

> **Security note:** never commit `priv.pem`. It is already in `.gitignore`.

---

## Generate encryption keys

mirr uses **RSA-2048** + **AES-256-GCM** (hybrid encryption — RSA wraps a fresh AES key per file).

```bash
# private key (KEEP SECRET — needed to decode)
openssl genrsa -out priv.pem 2048

# public key (safe to share — needed to encode for you)
openssl rsa -in priv.pem -pubout -out pub.pem
```

Set the env vars when running `mirr`:

```bash
# PowerShell
$env:MIRR_PUBLIC_KEY  = Get-Content pub.pem  -Raw
$env:MIRR_PRIVATE_KEY = Get-Content priv.pem -Raw

# bash / zsh
export MIRR_PUBLIC_KEY="$(cat pub.pem)"
export MIRR_PRIVATE_KEY="$(cat priv.pem)"
```

Or use a `.env` file (see `.env.example`):

```
MIRR_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
MIRR_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

> The keys must be **PEM-encoded PKCS#1 or PKCS#8 RSA-2048** — exactly what `openssl genrsa` produces. Other sizes (e.g., 4096) are not supported.

---

## Usage

### Encode

```bash
bun run encode <input> <output-dir> [flags]
```

| Flag | Effect |
|---|---|
| _(none)_ | Encode the bytes as-is. Smart fallback skips compression if it would grow the data. |
| `--compress` | Compress with Brotli before encoding. Smart fallback: if Brotli would grow the data, the encoder stores the raw bytes and sets `compressed: false` in the header. |
| `--encrypt` | Encrypt with RSA-2048 + AES-256-GCM. Requires `MIRR_PUBLIC_KEY` env var. |
| `--encrypt --compress` | **Recommended default.** Same size as `--compress` when compression helps, ~300 B of RSA overhead. |
| `--fps <n>` | Frames per second (default: 30). |
| `--frame <WxH>` | Frame size (default: 1920×1080). |
| `--block-size <n>` | Block size in bytes (default: 4). |
| `--no-progress` | Hide the progress bar. |

### Decode

```bash
bun run decode <input-dir> <output-path> [flags]
```

| Flag | Effect |
|---|---|
| _(none)_ | Decrypt (if encrypted), decompress (if compressed), and write the result. Files in the archive are extracted to `output-path/`. |
| `--keep-compressed` | Stop after decryption. Writes the still-compressed bytes to `output-path`. Useful for inspecting how much compression saved. |
| `--no-extract` | Write the inner file as a single blob instead of extracting. |

The decoder reads the `compressed` and `encrypted` flags from the header — you don't need to remember which flags were used at encode time.

---

## Encode sizes (50% text + 50% random folder)

| input folder | plain | `--compress` | `--encrypt` | `--encrypt --compress` | best | saved |
|---:|---:|---:|---:|---:|---:|---:|
| 1 MB | 0.73 MB | 0.61 MB | 1.15 MB | 0.61 MB | **0.61 MB** | 39% |
| 5 MB | 3.31 MB | 2.77 MB | 5.49 MB | 2.77 MB | **2.77 MB** | 45% |
| 20 MB | 13.20 MB | 10.98 MB | 21.93 MB | 10.98 MB | **10.98 MB** | 45% |
| 100 MB | 64.73 MB | 54.77 MB | 109.48 MB | 54.76 MB | **54.76 MB** | 45% |
| 500 MB | 323.35 MB | 273.70 MB | 547.37 MB | 273.71 MB | **273.70 MB** | 45% |
| `big_input` (real, ~10 MB) | 10.48 MB | 10.48 MB | 10.48 MB | 10.48 MB | **10.48 MB** | -10% |

### What this means

- **`--compress`** saves ~35–45% on a 50/50 mix of text and random data, and far more on pure text (logs, JSON, source code can hit 99%+).
- **`--encrypt` alone is always worse than `plain`** — it adds ~10% overhead (RSA-2048 wrapped key + AES-GCM auth tag). Use it only when confidentiality is worth the cost.
- **`--encrypt --compress` is only ~300 bytes larger than `--compress`** (one RSA-wrapped 256-bit AES key). Use it by default: same size as plain compression when compression helps, **privacy for free**.
- **Smart fallback**: when Brotli can't shrink the data (already-compressed input like JPG / MP4 / random), the encoder keeps the raw bytes and sets `compressed: false` in the header — no per-byte inflation, no decode-time decompression. The `big_input` row above demonstrates this on real data.

### Encode time

| input | plain | `--compress` | `--encrypt` | `--encrypt --compress` |
|---:|---:|---:|---:|---:|
| 1 MB | 276 ms | 1.4 s | 282 ms | 1.5 s |
| 5 MB | 356 ms | 2.7 s | 389 ms | 2.6 s |
| 20 MB | 622 ms | 11.4 s | 748 ms | 11.6 s |
| 100 MB | 1.8 s | 46.8 s | 2.5 s | 46.4 s |
| 500 MB | 8.2 s | 233.5 s | 12.2 s | 233.6 s |

Compression is the dominant cost. It is single-threaded Brotli over the entire input — for multi-GB files, expect a few minutes.

---

## How it works

1. **Archive** the input (if a directory) into a single binary blob with our custom archive format.
2. **Compress** (Brotli) if `--compress` is set and the output is smaller than the input.
3. **Encrypt** (RSA-2048 wraps a fresh AES-256 key, then AES-256-GCM encrypts the payload) if `--encrypt` is set.
4. **Encode** the resulting payload as 24-bit RGB pixels in an FFV1-lossless MKV video, one frame at a time.
5. **Write** the protocol header in the first frame so the decoder knows the layout.

The reverse on decode: read frames → parse header → slice `dataLength` → decrypt → decompress → extract.

For files larger than 1.5 GB, the encoder automatically splits into multiple `.mkv` parts, each with its own header and (if `--encrypt`) its own AES key.

---

## Tests

```bash
# 8-case round-trip matrix (single/dir × plain/encrypt/encrypt+compress + key errors)
bash scripts/test-matrix.sh

# Compression smart-fallback (proves Brotli is skipped when it grows the data)
bun run scripts/test-compression.ts

# Encode variant matrix (size comparison across all 4 flags × 5 input sizes)
bun run scripts/test-matrix-variants.ts
```

All tests are hermetic (no hardcoded paths, no network, no FFmpeg installation step) and finish in under 12 minutes on a 4-core machine.

---

## Requirements

- [Bun](https://bun.sh) ≥ 1.2
- [FFmpeg](https://ffmpeg.org) with the `ffv1` codec (in nearly every distro's ffmpeg package)
- (For encryption) [OpenSSL](https://www.openssl.org) — to generate keys

---

## License

MIT
