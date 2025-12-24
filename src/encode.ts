import { statSync, mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { createArchive } from "./utils/archive.ts";
import { cpus } from "os";

import * as fs from "fs";

/** Minimal TTY table for progress */
function printProgressTable(parts: { status: string, progress: string }[]) {
    // Prevent errors if stdout is not a TTY
    if (!process.stdout.isTTY) return;

    const lines = parts.map((p, i) => `Part ${i.toString().padStart(3, '0')}: [${p.status.padEnd(10)}] ${p.progress}`);
    process.stdout.write('\x1b[?25l'); // Hide cursor
    // Move up N lines to overwrite
    process.stdout.write(`\x1b[${lines.length}A`);
    for (const line of lines) {
        process.stdout.write(`\r\x1b[K${line}\n`); // Clear line and write
    }
    process.stdout.write('\x1b[?25h'); // Show cursor
}

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

            console.log(`\nStep 1/2: Parallel Encoding (High Concurrency | Table UI)`);
            mkdirSync(outputPath, { recursive: true });

            const threadsFlagIndex = flags.indexOf("--threads");
            // Default to a safer concurrency for massive files to avoid disk/RAM exhaustion
            const maxConcurrency = threadsFlagIndex !== -1 ? parseInt(flags[threadsFlagIndex + 1]) : Math.min(cpus().length, 3);

            console.log(`Using max ${maxConcurrency} parallel tasks | Total Parts: ${totalChunks}\n`);

            const partStates = Array.from({ length: totalChunks }, () => ({ status: "Pending", progress: "0%" }));
            // Initialize the table area
            console.log(partStates.map((_, i) => `Part ${i.toString().padStart(3, '0')}: Pending...`).join('\n'));

            const partIndices = Array.from({ length: totalChunks }, (_, i) => i);
            const activeTasks = new Set<Promise<void>>();
            const failedIndices: number[] = [];

            for (const i of partIndices) {
                if (activeTasks.size >= maxConcurrency) {
                    await Promise.race(activeTasks);
                }

                const chunkName = `part${i.toString().padStart(3, '0')}.bin`;
                const chunkPath = join(chunksDir, chunkName);
                const partOut = join(outputPath, `part${i.toString().padStart(3, '0')}`);

                const task = (async () => {
                    try {
                        const offset = i * CHUNK_SIZE;
                        const chunkSize = Math.min(CHUNK_SIZE, fileStats.size - offset);

                        partStates[i].status = "Splitting";
                        if (process.stdout.isTTY) printProgressTable(partStates);
                        else console.log(`[${i}] Splitting...`);

                        // Use arrayBuffer for guaranteed precise sizing
                        const chunkData = await file.slice(offset, offset + chunkSize).arrayBuffer();
                        await Bun.write(chunkPath, chunkData);

                        partStates[i].status = "Encoding";
                        partStates[i].progress = "Starting...";
                        if (process.stdout.isTTY) printProgressTable(partStates);
                        else console.log(`[${i}] Encoding...`);

                        const proc = Bun.spawn(
                            ["bun", "--expose-gc", "run", "src/cli.ts", "encode", chunkPath, partOut, "--mime", "application/x-cftff-archive", ...flags],
                            { stdout: "pipe", stderr: "pipe" }
                        );

                        // Read stdout line by line for progress
                        const reader = proc.stdout.getReader();
                        const decoder = new TextDecoder();
                        let frameCount = 0;

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;
                            const text = decoder.decode(value);
                            // Look for "Frame X (Y.Z%)" in output
                            const match = text.match(/Frame\s+\d+\s+\((\d+\.?\d?%)\)/);
                            if (match) {
                                partStates[i].progress = match[1];
                                printProgressTable(partStates);
                            }
                        }

                        const exitCode = await proc.exited;
                        if (exitCode !== 0) {
                            const stderr = await new Response(proc.stderr).text();
                            partStates[i].status = "FAILED";
                            printProgressTable(partStates);
                            failedIndices.push(i);
                        } else {
                            partStates[i].status = "Done";
                            partStates[i].progress = "100%";
                            printProgressTable(partStates);
                        }
                    } catch (e) {
                        partStates[i].status = "CRASHED";
                        printProgressTable(partStates);
                        failedIndices.push(i);
                    } finally {
                        try { if (existsSync(chunkPath)) rmSync(chunkPath, { force: true }); } catch { }
                    }
                })();

                activeTasks.add(task);
                task.finally(() => activeTasks.delete(task));
            }

            await Promise.all(activeTasks);
            console.log("\n✓ All tasks completed.");

            // Final cleanup of chunks directory
            try { if (existsSync(chunksDir)) rmSync(chunksDir, { recursive: true, force: true }); } catch { }
            // Cleanup main archive if it was temp
            if (isTempArchive && targetFile && existsSync(targetFile)) {
                try { rmSync(targetFile, { force: true }); } catch { }
            }

            if (failedIndices.length > 0) {
                throw new Error(`Encoding failed for parts: ${failedIndices.join(", ")}`);
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
