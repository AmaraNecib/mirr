#!/usr/bin/env bun
/**
 * Join split file chunks back together
 * Used internally by decode.ts for automatic reassembly
 */

import { readdirSync, createWriteStream, readFileSync } from "fs";
import { join } from "path";

const [inputDir, outputFile] = process.argv.slice(2);

if (!inputDir || !outputFile) {
    console.error("Usage: bun join-files.ts <input-dir> <output-file>");
    process.exit(1);
}

const files = readdirSync(inputDir);
const partFiles = files.filter(f => f.match(/\.part\d{3}$/)).sort();

if (partFiles.length === 0) {
    console.error("No .part files found");
    process.exit(1);
}

const writeStream = createWriteStream(outputFile);

for (let i = 0; i < partFiles.length; i++) {
    const data = readFileSync(join(inputDir, partFiles[i]));
    await new Promise<void>((resolve, reject) => {
        writeStream.write(data, (err: any) => err ? reject(err) : resolve());
    });
}

await new Promise<void>(resolve => writeStream.end(resolve));
