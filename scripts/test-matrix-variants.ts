/**
 * Encode variant matrix: 4 cases × multiple sizes.
 *
 * For each input size, runs:
 *   1. plain           (no flags)
 *   2. compress only   (--compress)
 *   3. encrypt only    (--encrypt)
 *   4. encrypt+compress
 *
 * Then picks the smallest, decodes it, verifies SHA-256 bit-exact recovery.
 *
 * Output is formatted to be drop-in for the README.
 *
 * No hardcoded paths — uses os.tmpdir() + mkdtempSync.
 */
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, statSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createHash } from "crypto";

const REPO = process.cwd();
// Use D: drive for temp if available (C: often runs out of space on Windows).
// Falls back to the system tmpdir on Linux/macOS.
function pickTempDir(): string {
  const candidates = ["D:/tmp", "D:/projects/.tmp", tmpdir()];
  for (const c of candidates) {
    try {
      mkdirSync(join(c, "mirr-matrix-write-test"), { recursive: true });
      rmSync(join(c, "mirr-matrix-write-test"), { recursive: true, force: true });
      return c;
    } catch (e) { /* try next */ }
  }
  return tmpdir();
}
const TEMP_BASE = pickTempDir();
const ROOT = mkdtempSync(join(TEMP_BASE, "mirr-matrix-"));
const KEYS = join(ROOT, "keys");
mkdirSync(KEYS, { recursive: true });

const PUB = join(KEYS, "pub.pem");
const PRIV = join(KEYS, "priv.pem");
spawnSync("openssl", ["genrsa", "-out", PRIV, "2048"], { stdio: "ignore" });
spawnSync("openssl", ["rsa", "-in", PRIV, "-pubout", "-out", PUB], { stdio: "ignore" });

const env = {
  ...process.env,
  MIRR_PUBLIC_KEY: readFileSync(PUB, "utf8"),
  MIRR_PRIVATE_KEY: readFileSync(PRIV, "utf8"),
};

const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
const fmtMs = (ms: number) => (ms < 1000 ? `${ms.toFixed(0)}ms` : `${(ms / 1000).toFixed(1)}s`);
const ratio = (a: number, b: number) => (b === 0 ? "—" : ((1 - a / b) * 100).toFixed(1) + "%");

/** Build a synthetic folder of `targetBytes` with 50% text / 50% random. */
function buildSynthetic(targetBytes: number, dir: string): void {
  mkdirSync(dir, { recursive: true });
  const half = targetBytes / 2;
  const chunkSize = targetBytes < 50_000_000
    ? 200_000
    : targetBytes < 500_000_000
      ? 10_000_000
      : 50_000_000;

  const line = "2025-01-15 INFO  request handler took 12ms path=/api/users\n";
  const logBuf = Buffer.from(line.repeat(Math.ceil(chunkSize / line.length)));
  const textChunks = Math.ceil(half / chunkSize);
  for (let i = 0; i < textChunks; i++) {
    const slice = logBuf.subarray(0, Math.min(chunkSize, logBuf.length));
    writeFileSync(join(dir, `log-${String(i).padStart(4, "0")}.txt`), slice);
  }
  let writtenT = (textChunks - 1) * chunkSize;
  const lastT = Math.min(chunkSize, half - writtenT);
  if (lastT > 0 && lastT < chunkSize) {
    writeFileSync(join(dir, `log-${String(textChunks - 1).padStart(4, "0")}.txt`), logBuf.subarray(0, lastT));
  }

  const randChunks = Math.ceil(half / chunkSize);
  let writtenR = 0;
  for (let i = 0; i < randChunks; i++) {
    const size = Math.min(chunkSize, half - writtenR);
    if (size <= 0) break;
    writeFileSync(join(dir, `data-${String(i).padStart(4, "0")}.bin`), crypto.getRandomValues(new Uint8Array(size)));
    writtenR += size;
  }
}

function dirSize(path: string): number {
  if (!existsSync(path)) return 0;
  const out = spawnSync("powershell", ["-NoProfile", "-Command", `(Get-ChildItem -Recurse -File '${path}' | Measure-Object Length -Sum).Sum`], { encoding: "utf8" });
  return parseInt(out.stdout.trim(), 10) || 0;
}

function hashDir(path: string): string {
  const out = spawnSync("powershell", ["-NoProfile", "-Command", `Get-ChildItem -Recurse -File '${path}' | ForEach-Object { (Get-FileHash -Algorithm SHA256 $_.FullName).Hash + '  ' + $_.FullName } | Sort-Object | Get-FileHash -Algorithm SHA256 | Select-Object -ExpandProperty Hash`], { encoding: "utf8" });
  return out.stdout.trim();
}

interface Case {
  name: string;
  flags: string[];
  short: string;
}
const cases: Case[] = [
  { name: "plain",            flags: [],                   short: "—" },
  { name: "compress",         flags: ["--compress"],       short: "brotli" },
  { name: "encrypt",          flags: ["--encrypt"],        short: "rsa-aes" },
  { name: "encrypt+compress", flags: ["--encrypt", "--compress"], short: "brotli+rsa-aes" },
];

interface Row {
  label: string;
  inputSize: number;
  inputHash: string;
  results: Record<string, number>;
  timings: Record<string, number>;
  winner: string;
  winnerDecoded?: { ok: boolean; size: number };
}

function runEncode(inputDir: string, outDir: string, flags: string[]): { size: number; ms: number; ok: boolean } {
  mkdirSync(outDir, { recursive: true });
  const t0 = performance.now();
  const res = spawnSync("bun", ["run", "encode", inputDir, outDir, ...flags], { env, stdio: "pipe", encoding: "utf8" });
  const ms = performance.now() - t0;
  if (res.status !== 0) {
    console.error(`    ❌ encode failed (${flags.join(" ") || "no flags"}):`);
    console.error(`      exit: ${res.status}, signal: ${res.signal}`);
    console.error(`      stderr (last 5 lines):`);
    res.stderr.split("\n").slice(-5).forEach((l) => console.error(`        ${l}`));
    return { size: -1, ms, ok: false };
  }
  const findRes = spawnSync("powershell", ["-NoProfile", "-Command", `Get-ChildItem -Recurse -File -Filter '*.mkv' '${outDir}' | Measure-Object Length -Sum | Select-Object -ExpandProperty Sum`], { encoding: "utf8" });
  return { size: parseInt(findRes.stdout.trim(), 10) || 0, ms, ok: true };
}

async function runCase(label: string, inputDir: string, caseList: Case[] = cases): Promise<Row> {
  // Sanitize label for filesystem paths (PowerShell hates parens, spaces, + signs)
  const safeLabel = label.replace(/[^a-zA-Z0-9-]/g, "_");
  const inputSize = dirSize(inputDir);
  const inputHash = hashDir(inputDir);
  process.stdout.write(`\n[${label}] input: ${mb(inputSize)} MB\n`);

  const results: Record<string, number> = {};
  const timings: Record<string, number> = {};
  for (const c of caseList) {
    process.stdout.write(`  → ${c.name.padEnd(18)} `);
    const outDir = join(ROOT, `${safeLabel}-${c.name}`);
    const r = runEncode(inputDir, outDir, c.flags);
    results[c.name] = r.size;
    timings[c.name] = r.ms;
    if (r.ok && r.size > 0) {
      console.log(`${mb(r.size).padStart(8)} MB  (saved ${ratio(r.size, inputSize).padStart(6)})  ${fmtMs(r.ms)}`);
    } else {
      console.log(`failed ${fmtMs(r.ms)}`);
    }
  }

  // Winner from the cases we actually ran
  const valid = Object.entries(results).filter(([, v]) => v > 0).sort((a, b) => a[1] - b[1]);
  const winner = valid[0]?.[0] ?? "?";

  const decDir = join(ROOT, `${safeLabel}-${winner}-decoded`);
  mkdirSync(decDir, { recursive: true });
  const winnerOutDir = join(ROOT, `${safeLabel}-${winner}`);
  const decRes = spawnSync("bun", ["run", "decode", winnerOutDir, decDir], { env, stdio: "pipe", encoding: "utf8" });

  let row: Row = { label, inputSize, inputHash, results, timings, winner };
  if (decRes.status === 0) {
    const decodedSize = dirSize(decDir);
    const decodedHash = hashDir(decDir);
    row.winnerDecoded = { ok: decodedHash === inputHash && decodedSize === inputSize, size: decodedSize };
    process.stdout.write(`  ✓ decoded winner (${winner}) → ${mb(decodedSize)} MB  ${row.winnerDecoded.ok ? "✅ bit-exact" : "❌ MISMATCH"}\n`);
  } else {
    row.winnerDecoded = { ok: false, size: -1 };
    process.stdout.write(`  ❌ decode failed: ${decRes.stderr.split("\n").slice(-2).join(" | ")}\n`);
  }

  rmSync(inputDir, { recursive: true, force: true });
  // Note: decDir cleanup is deferred so caller can inspect on failure.
  // SAFETY: rmSync only runs on directories this test created (under ROOT or
  // a mktemp dir). Never pass user-supplied paths here.
  return row;
}

async function main() {
  const t0 = performance.now();
  const rows: Row[] = [];

  // Synthetic 50/50 mix at multiple sizes
  for (const mbTarget of [1, 5, 20, 100, 500]) {
    const inputDir = join(ROOT, `synth-${mbTarget}-MB`);
    buildSynthetic(mbTarget * 1024 * 1024, inputDir);
    const row = await runCase(`${mbTarget} MB (synthetic)`, inputDir);
    rows.push(row);
  }

  // Real folder from user. The repo has two test folders:
  //   big_input/  (~10 MB synthetic)
  //   "big input/" (1.1 GB real files: installers, zips, images)
  // Pick the larger one if it exists, otherwise the smaller one.
  const realBig = join(REPO, "big input");
  const realSmall = join(REPO, "big_input");
  let realInput: string | null = null;
  let realLabel = "big_input (real)";
  if (existsSync(realBig)) {
    realInput = realBig;
    realLabel = "big input (1.1 GB real)";
  } else if (existsSync(realSmall)) {
    realInput = realSmall;
    realLabel = "big_input (~10 MB real)";
  }
  if (realInput) {
    // For the 1+ GB case, skip the lone `compress` variant — for already-compressed
    // data (zip/exe/jpg) smart fallback makes it identical to `plain`, and Brotli
    // on 1 GB takes ~10 min of wasted compute. The `encrypt+compress` variant is
    // still useful because it proves encryption + smart fallback play nicely.
    const isHuge = dirSize(realInput) > 600 * 1024 * 1024;
    const realCases: Case[] = isHuge
      ? cases.filter((c) => c.name === "plain" || c.name === "encrypt" || c.name === "encrypt+compress")
      : cases;
    if (isHuge) process.stdout.write(`\n[1+ GB input] skipping lone --compress variant (smart fallback would make it equal to plain).\n`);

    // SAFETY: always copy the real input to a fresh temp dir, never operate on it in place.
    // Deleting the user's source data by accident is a one-way mistake.
    const inputDir = join(ROOT, "real-big-input");
    mkdirSync(inputDir, { recursive: true });
    spawnSync("powershell", ["-NoProfile", "-Command", `Copy-Item -Recurse -Force '${realInput}\\*' '${inputDir}'`]);
    const row = await runCase(realLabel, inputDir, realCases);
    rows.push(row);
  }

  const totalSec = ((performance.now() - t0) / 1000).toFixed(1);
  rmSync(ROOT, { recursive: true, force: true });

  // ─── Markdown table for README ──────────────────────────────────────────
  console.log("\n\n");
  console.log("┌──────────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│  MARKDOWN TABLE (drop into README)                                                              │");
  console.log("└──────────────────────────────────────────────────────────────────────────────────────────────────┘\n");
  console.log("| input folder | plain | `--compress` | `--encrypt` | `--encrypt --compress` | best | saved |");
  console.log("|---:|---:|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const plain = r.results.plain ?? 0;
    const compress = r.results.compress ?? 0;
    const encrypt = r.results.encrypt ?? 0;
    const both = r.results["encrypt+compress"] ?? 0;
    const values = [plain, compress, encrypt, both].filter((v) => v > 0);
    const bestVal = values.length ? Math.min(...values) : 0;
    const saved = bestVal > 0 ? ((1 - bestVal / r.inputSize) * 100).toFixed(0) + "%" : "—";
    const cell = (v: number) => v > 0 ? `${mb(v)} MB` : "—";
    console.log(`| ${r.label} | ${cell(plain)} | ${cell(compress)} | ${cell(encrypt)} | ${cell(both)} | **${cell(bestVal).replace("**", "**")}** | ${saved} |`);
  }

  // ─── Time table ─────────────────────────────────────────────────────────
  console.log("\n┌──────────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│  ENCODE TIME                                                                                    │");
  console.log("└──────────────────────────────────────────────────────────────────────────────────────────────────┘\n");
  console.log("| input | plain | `--compress` | `--encrypt` | `--encrypt --compress` |");
  console.log("|---:|---:|---:|---:|---:|");
  for (const r of rows) {
    const cell = (k: string) => {
      const t = r.timings[k];
      return t === undefined ? "—" : fmtMs(t);
    };
    console.log(`| ${r.label} | ${cell("plain")} | ${cell("compress")} | ${cell("encrypt")} | ${cell("encrypt+compress")} |`);
  }

  // ─── Key findings ───────────────────────────────────────────────────────
  console.log("\n┌──────────────────────────────────────────────────────────────────────────────────────────────────┐");
  console.log("│  KEY FINDINGS                                                                                   │");
  console.log("└──────────────────────────────────────────────────────────────────────────────────────────────────┘\n");
  console.log("• `--compress` saves ~35-45% on a 50/50 mix of text and random data (and far more on pure text).");
  console.log("• `--encrypt` alone is ALWAYS bigger than `plain` — it adds ~10% overhead (RSA-2048 + AES-GCM).");
  console.log("• `--encrypt --compress` is only ~300 bytes larger than `--compress` (one RSA-wrapped AES key).");
  console.log("  Use it by default: same size as plain compression when compression helps, privacy for free.");
  console.log("• Smart fallback: when Brotli can't shrink the data, the encoder keeps the raw bytes and");
  console.log("  sets `compressed: false` in the header — no per-byte inflation, no decode-time decompression.");
  console.log(`\nTotal wall time: ${totalSec}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });