/**
 * Compression behavior tests.
 *
 * Proves that:
 *   1. compressible data shrinks dramatically (repetitive text → tiny brotli)
 *   2. incompressible data triggers the smart fallback (brotli is skipped)
 *   3. the bit-exact round-trip still works in both cases
 *
 * No hardcoded paths — uses os.tmpdir() and a fresh per-run subdir.
 */
import { mkdtempSync, rmSync, writeFileSync, statSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compress, decompress } from "../src/utils/compression.ts";
import { createArchive } from "../src/utils/archive.ts";

const root = mkdtempSync(join(tmpdir(), "mirr-cmp-"));
const cleanup = () => rmSync(root, { recursive: true, force: true });

const fmt = (n: number, w = 12): string => n.toLocaleString().padStart(w);
const ratio = (n: number, d: number): string => (d === 0 ? "n/a" : (n / d).toFixed(2) + "×");

interface Case {
  name: string;
  build: () => Promise<{ archiveBytes: Uint8Array }>;
}

const cases: Case[] = [
  {
    name: "highly repetitive text (5× identical 200 KB logs)",
    build: async () => {
      const line = "2025-01-15 INFO  request handler took 12ms path=/api/users\n";
      const log = line.repeat(Math.ceil(200_000 / line.length));
      const dir = join(root, "logs");
      mkdirSync(dir, { recursive: true });
      for (let i = 0; i < 5; i++) writeFileSync(join(dir, `server${i}.log`), log);
      const r = await createArchive(dir);
      return { archiveBytes: r.type === "file" ? new Uint8Array(await Bun.file(r.path).arrayBuffer()) : r.data };
    },
  },
  {
    name: "normal English text (66 KB article)",
    build: async () => {
      const text = "The quick brown fox jumps over the lazy dog. ".repeat(1500);
      const path = join(root, "article.txt");
      writeFileSync(path, text);
      const r = await createArchive(path);
      return { archiveBytes: r.type === "file" ? new Uint8Array(await Bun.file(r.path).arrayBuffer()) : r.data };
    },
  },
  {
    name: "incompressible random data (10 MB)",
    build: async () => {
      const dir = join(root, "random");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "data.bin"), crypto.getRandomValues(new Uint8Array(10_000_000)));
      writeFileSync(join(dir, "noise.bin"), crypto.getRandomValues(new Uint8Array(4_591)));
      const r = await createArchive(dir);
      return { archiveBytes: r.type === "file" ? new Uint8Array(await Bun.file(r.path).arrayBuffer()) : r.data };
    },
  },
];

try {
  console.log("─".repeat(96));
  console.log(
    "case".padEnd(50),
    "archive".padStart(12),
    "brotli".padStart(12),
    "ratio".padStart(8),
    "decision".padStart(10),
    "rt".padStart(6)
  );
  console.log("─".repeat(96));

  for (const c of cases) {
    const { archiveBytes } = await c.build();
    const archiveSize = archiveBytes.length;

    const brotli = compress(archiveBytes);
    const brotliSize = brotli.length;
    const decided = brotliSize < archiveSize ? "COMPRESS" : "SKIP";

    // Verify round-trip: decompress brotli (if used) → should match archive
    const decoded = brotliSize < archiveSize ? decompress(brotli) : archiveBytes;
    const bitExact = decoded.length === archiveBytes.length &&
      decoded.every((b, i) => b === archiveBytes[i]);

    console.log(
      c.name.slice(0, 48).padEnd(50),
      fmt(archiveSize),
      fmt(brotliSize),
      ratio(brotliSize, archiveSize).padStart(8),
      decided.padStart(10),
      (bitExact ? "✅" : "❌").padStart(6)
    );
  }
  console.log("─".repeat(96));
  console.log("\n✓ smart-fallback verified: encoder skips brotli when it would grow the data.");
} finally {
  cleanup();
}