#!/usr/bin/env bash
# Test harness: encode with encryption, decode, verify bit-exact.
set -e

# Resolve the repo from this script's location so the harness works anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
# Use a fresh temp subdir for this run.
T="$(mktemp -d -t mirr-roundtrip-XXXXXX)"
SEED="$T/seed"
ENC_DIR="$T/encoded"
DEC_DIR="$T/decoded"
VIDEO_DIR="$T/video"
trap 'rm -rf "$T"' EXIT

mkdir -p "$SEED"

# Read keys from PEM files in the repo (or use env vars if already set).
if [ -z "$MIRR_PUBLIC_KEY" ] || [ -z "$MIRR_PRIVATE_KEY" ]; then
  if [ -f "$REPO/pub.pem" ] && [ -f "$REPO/priv.pem" ]; then
    export MIRR_PUBLIC_KEY=$(cat "$REPO/pub.pem")
    export MIRR_PRIVATE_KEY=$(cat "$REPO/priv.pem")
  else
    echo "❌ Need pub.pem + priv.pem in $REPO, or MIRR_PUBLIC_KEY + MIRR_PRIVATE_KEY in env." >&2
    exit 1
  fi
fi

# Build a small synthetic seed (50 KB text + 50 KB random).
{
  printf '2025-01-15 INFO  request handler took 12ms path=/api/users\n%.0s' {1..1300}
} > "$SEED/server.log"
head -c 50000 /dev/urandom > "$SEED/noise.bin"

echo "=== ENCODE (with --encrypt) ==="
cd "$REPO" && bun run encode "$SEED" "$ENC_DIR" --encrypt 2>&1 | tail -5

echo
echo "=== DECODE single-part ==="
cd "$REPO" && bun run decode "$ENC_DIR" "$DEC_DIR" 2>&1 | tail -8

echo
echo "=== VERIFY: diff seed vs decoded ==="
diff -r "$SEED" "$DEC_DIR" && echo "✅ BIT-EXACT MATCH" || { echo "❌ MISMATCH"; exit 1; }

echo
echo "=== SHA256 comparison ==="
echo "Original:"
(cd "$SEED" && find . -type f -exec sha256sum {} \; | sort)
echo "Decoded:"
(cd "$DEC_DIR" && find . -type f -exec sha256sum {} \; | sort)