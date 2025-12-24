#!/usr/bin/env bun
/**
 * Decode wrapper with automatic multi-part handling and full flag support
 * Usage: bun decode.ts <input> <output> [flags]
 */

import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { cpus } from "os";

const args = process.argv.slice(2);
const inputPath = args[0];
const outputPath = args[1];

if (!inputPath || !outputPath) {
    console.error("Usage: bun decode.ts <input> <output> [flags]");
    console.error("Flags: --extract, etc.");
    process.exit(1);
}

// Extract flags
const flags = args.slice(2);

const metadataPath = join(inputPath, "multipart.json");

// Multi-part video
if (existsSync(metadataPath)) {
    const metadata = await Bun.file(metadataPath).json();

    console.log(`\n⚠️  Multi-part video detected (${metadata.totalParts} parts)\n`);

    const chunksDir = `.cftff-decoded-${Date.now()}`;
    mkdirSync(chunksDir, { recursive: true });

    try {
        // Decode each
        console.log("Step 1/3: Decoding parts...");

        const threadsFlagIndex = flags.indexOf("--threads");
        // Default to a safer concurrency for massive files
        const maxConcurrency = threadsFlagIndex !== -1 ? parseInt(flags[threadsFlagIndex + 1]) : Math.min(cpus().length, 3);

        console.log(`Using max ${maxConcurrency} parallel decoding tasks\n`);

        const activeTasks = new Set<Promise<void>>();
        const failedIndices: number[] = [];

        for (let i = 0; i < metadata.totalParts; i++) {
            if (activeTasks.size >= maxConcurrency) {
                await Promise.race(activeTasks);
            }

            const partDir = join(inputPath, `part${i.toString().padStart(3, '0')}`);
            const chunkOut = join(chunksDir, `chunk.part${i.toString().padStart(3, '0')}`);

            console.log(`[Queueing] Part ${i}...`);

            const task = (async () => {
                const proc = Bun.spawn(
                    ["bun", "--expose-gc", "run", "src/cli.ts", "decode", partDir, chunkOut, "--no-extract", ...flags],
                    { stdout: "pipe", stderr: "pipe" }
                );

                const [stdout, stderr] = await Promise.all([
                    new Response(proc.stdout).text(),
                    new Response(proc.stderr).text()
                ]);

                const exitCode = await proc.exited;
                if (exitCode !== 0) {
                    console.error(`\n❌ Error decoding part ${i}:\n${stderr}`);
                    failedIndices.push(i);
                } else {
                    console.log(`✓ Part ${i} complete`);
                }
            })();

            activeTasks.add(task);
            task.finally(() => activeTasks.delete(task));
        }

        await Promise.all(activeTasks);

        if (failedIndices.length > 0) {
            throw new Error(`Decoding failed for parts: ${failedIndices.join(", ")}`);
        }

        // Join
        console.log(`\nStep 2/3: Joining chunks...`);
        const shouldExtract = metadata.isArchive && !flags.includes('--no-extract');
        const finalOutputFile = shouldExtract ? `${outputPath}.tmp_archive` : outputPath;

        const joinProc = Bun.spawn(["bun", "src/utils/join-files.ts", chunksDir, finalOutputFile], {
            stdout: "inherit",
            stderr: "inherit"
        });

        if ((await joinProc.exited) !== 0) throw new Error("Join failed");

        // Step 3: Optional Extraction for Archive
        if (shouldExtract) {
            console.log(`\nStep 3/3: Reassembled file is an archive. Extracting...`);
            const { extractArchiveFromFile } = await import("./utils/archive.ts");
            const { unlinkSync, existsSync } = await import("fs");

            await extractArchiveFromFile(finalOutputFile, outputPath);

            // Cleanup temp archive
            if (existsSync(finalOutputFile)) {
                unlinkSync(finalOutputFile);
            }
        }

        console.log(`\n✓ Multi-part decoding complete!`);
        console.log(`  Output: ${outputPath}`);

    } finally {
        // Cleanup
        console.log(`\nStep 3/3: Cleaning up...`);
        try {
            rmSync(chunksDir, { recursive: true, force: true });
            console.log(`✓ Cleanup complete`);
        } catch { }
    }
} else {
    // Normal decoding - pass all flags
    const proc = Bun.spawn(
        ["bun", "--expose-gc", "run", "src/cli.ts", "decode", inputPath, outputPath, ...flags],
        { stdout: "inherit", stderr: "inherit" }
    );

    const exitCode = await proc.exited;
    process.exit(exitCode);
}
