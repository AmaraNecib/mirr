#!/usr/bin/env bash
# Comprehensive round-trip test matrix.
set -e

# Resolve the repo from this script's location so the matrix works anywhere.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
# Use the platform's temp dir; mktemp gives a fresh subdir every run.
T="$(mktemp -d -t mirr-test-XXXXXX)"
trap 'rm -rf "$T"' EXIT

PASS=0
FAIL=0

check() {
  local name="$1"
  local original="$2"
  local decoded="$3"
  if diff -rq "$original" "$decoded" > /dev/null 2>&1; then
    echo "  ✅ $name"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name"
    FAIL=$((FAIL+1))
  fi
}

expect_fail() {
  local name="$1"
  local output="$2"
  if echo "$output" | grep -qiE "error|failed" ; then
    echo "  ✅ $name (got expected error)"
    PASS=$((PASS+1))
  else
    echo "  ❌ $name (did NOT fail)"
    FAIL=$((FAIL+1))
  fi
}

# Load keys
export MIRR_PUBLIC_KEY="$(cat "$REPO/pub.pem")"
export MIRR_PRIVATE_KEY="$(cat "$REPO/priv.pem")"

# Setup test data
rm -rf "$T" && mkdir -p "$T/seed/sub"
head -c 200000 /dev/urandom > "$T/seed/big.bin"
echo "highly compressible text. $(yes 'a' | head -c 100000 | tr -d '\n')" > "$T/seed/text.txt"
echo "Hello mirr" > "$T/seed/sub/nested.txt"

run() {
  ( cd "$REPO" && bun "$@" 2>&1 )
}

echo
echo "══════ TEST 1: single file, plain ══════"
rm -rf "$T/out" "$T/dec"
run run encode "$T/seed/big.bin" "$T/out" >/dev/null
run run decode "$T/out" "$T/dec/big.bin" >/dev/null
check "single file, unencrypted, 200KB" "$T/seed/big.bin" "$T/dec/big.bin"

echo
echo "══════ TEST 2: single file, --encrypt ══════"
rm -rf "$T/out" "$T/dec"
run run encode "$T/seed/big.bin" "$T/out" --encrypt >/dev/null
run run decode "$T/out" "$T/dec/big.bin" >/dev/null
check "single file, encrypted, 200KB" "$T/seed/big.bin" "$T/dec/big.bin"

echo
echo "══════ TEST 3: single file, --encrypt --compress ══════"
rm -rf "$T/out" "$T/dec"
run run encode "$T/seed/text.txt" "$T/out" --encrypt --compress >/dev/null
run run decode "$T/out" "$T/dec/text.txt" >/dev/null
check "single file, encrypted+compressed" "$T/seed/text.txt" "$T/dec/text.txt"

echo
echo "══════ TEST 4: directory, --encrypt ══════"
rm -rf "$T/out" "$T/dec"
run run encode "$T/seed" "$T/out" --encrypt >/dev/null
run run decode "$T/out" "$T/dec" >/dev/null
check "directory, encrypted" "$T/seed" "$T/dec"

echo
echo "══════ TEST 5: directory, --encrypt --compress ══════"
rm -rf "$T/out" "$T/dec"
run run encode "$T/seed" "$T/out" --encrypt --compress >/dev/null
run run decode "$T/out" "$T/dec" >/dev/null
check "directory, encrypted+compressed" "$T/seed" "$T/dec"

echo
echo "══════ TEST 6: wrong private key (should fail loudly) ══════"
openssl genrsa -out "$T/wrong.pem" 2048 2>/dev/null
export MIRR_PRIVATE_KEY="$(cat "$T/wrong.pem")"
output=$(run run decode "$T/out" "$T/dec" 2>&1 || true)
expect_fail "wrong private key" "$output"
rm -f "$T/wrong.pem"

echo
echo "══════ TEST 7: missing key (encode) ══════"
unset MIRR_PRIVATE_KEY MIRR_PUBLIC_KEY
output=$(run run encode "$T/seed/big.bin" "$T/out" --encrypt 2>&1 || true)
expect_fail "missing public key on encode" "$output"

echo
echo "══════ TEST 8: missing key (decode) ══════"
export MIRR_PUBLIC_KEY="$(cat "$REPO/pub.pem")"
unset MIRR_PRIVATE_KEY
output=$(run run decode "$T/out" "$T/dec" 2>&1 || true)
expect_fail "missing private key on decode" "$output"

echo
echo "══════ TEST 9: smart fallback (compression skipped when unhelpful) ══════"
output=$(run run scripts/test-compression.ts 2>&1 || true)
if echo "$output" | grep -q "SKIP" && echo "$output" | grep -q "COMPRESS" && echo "$output" | grep -q "smart-fallback verified"; then
  echo "  ✅ smart fallback works (compresses good data, skips random)"
  PASS=$((PASS + 1))
else
  echo "  ❌ smart fallback test failed"
  echo "$output" | head -10
  FAIL=$((FAIL + 1))
fi

echo
echo "═══════════════════════════════════════"
echo "  RESULTS: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════"
exit $FAIL
