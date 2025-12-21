#!/usr/bin/env bun
/**
 * Encode wrapper with automatic multi-part handling and full flag support
 */

import { statSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { createArchive } from "./utils/archive.ts";

const args = process.argv.slice(2);
const inputPath = args[0];
const outputPath = args[1] || "output";

if (!inputPath) {
    console.error("Usage: bun encode.ts <input> [output] [flags]");
    process.exit(1);
}

const flags = args.slice(2);
const CHUNK_SIZE = 1.5 * 1024 * 1024 * 1024;

async function main() {
    let targetFile = inputPath;
    let isTempArchive = false;
    const stats = statSync(inputPath);

    // Step 1: Handle directory by archiving first
    if (stats.isDirectory()) {
        console.log(`Input is a directory - creating temporary archive...`);
        const archResult = await createArchive(inputPath);

        if (archResult.type === 'file') {
            targetFile = archResult.path;
            isTempArchive = true;
        } else {
            // Memory data - write to temp file
            targetFile = `.temp-archive-${Date.now()}.bin`;
            await Bun.write(targetFile, archResult.data);
            isTempArchive = true;
        }
    }

    const fileStats = statSync(targetFile);

    // Step 2: Split if too large
    if (fileStats.size > CHUNK_SIZE) {
        console.log(`\n⚠️  Large data (${(fileStats.size / 1024 / 1024 / 1024).toFixed(2)}GB) - using multi-part encoding\n`);

        const chunksDir = `.cftff-chunks-${Date.now()}`;
        mkdirSync(chunksDir, { recursive: true });

        try {
            const fileName = inputPath.split(/[/\\]/).pop() || "data";
            const totalChunks = Math.ceil(fileStats.size / CHUNK_SIZE);
            const file = Bun.file(targetFile);

            console.log(`Step 1/3: Splitting into ${totalChunks} parts...`);
            for (let i = 0; i < totalChunks; i++) {
                const offset = i * CHUNK_SIZE;
                const chunkSize = Math.min(CHUNK_SIZE, fileStats.size - offset);
                const chunkName = `part${i.toString().padStart(3, '0')}.bin`;

                console.log(`  [${i + 1}/${totalChunks}] Writing chunk ${i}...`);
                const chunk = await file.slice(offset, offset + chunkSize).arrayBuffer();
                await Bun.write(join(chunksDir, chunkName), chunk);
            }

            console.log(`\nStep 2/3: Encoding parts...`);
            mkdirSync(outputPath, { recursive: true });

            for (let i = 0; i < totalChunks; i++) {
                const chunkName = `part${i.toString().padStart(3, '0')}.bin`;
                const partOut = join(outputPath, `part${i.toString().padStart(3, '0')}`);

                console.log(`\n[${i + 1}/${totalChunks}] Encoding part ${i}...`);
                const proc = Bun.spawn(
                    ["bun", "--expose-gc", "run", "src/cli.ts", "encode", join(chunksDir, chunkName), partOut, "--mime", "application/x-cftff-archive", ...flags],
                    { stdout: "inherit", stderr: "inherit" }
                );

                if ((await proc.exited) !== 0) throw new Error(`Encoding failed for part ${i}`);
            }

            // Metadata for reassembly
            await Bun.write(join(outputPath, "multipart.json"), JSON.stringify({
                originalFile: fileName,
                totalParts: totalChunks,
                chunkSize: CHUNK_SIZE,
                totalSize: fileStats.size,
                isArchive: stats.isDirectory()
            }, null, 2));

            console.log(`\n✓ Multi-part encoding complete: ${outputPath}`);

        } finally {
            rmSync(chunksDir, { recursive: true, force: true });
        }
    } else {
        // Step 2 (Normal): Direct encoding
        const combinedFlags = isTempArchive ? ["--mime", "application/x-cftff-archive", ...flags] : flags;
        console.log(`[DEBUG] Wrapper: Spawning cli.ts with flags: ${combinedFlags.join(' ')}`);
        const proc = Bun.spawn(
            ["bun", "--expose-gc", "run", "src/cli.ts", "encode", targetFile, outputPath, ...combinedFlags],
            { stdout: "inherit", stderr: "inherit" }
        );
        const exitCode = await proc.exited;
        if (exitCode !== 0) process.exit(exitCode);
    }

    // Step 3: Global Cleanup
    if (isTempArchive && existsSync(targetFile)) {
        rmSync(targetFile, { force: true });
    }
}

main().catch(err => {
    console.error("\n❌ Error:", err.message);
    process.exit(1);
});
