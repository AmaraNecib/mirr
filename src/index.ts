/**
 * mirr public library entry.
 *
 *   import { encode, decode } from "mirr";
 *
 * See README.md for usage and `src/cli.ts` for the CLI surface.
 */

export { encode } from "./engine/encode.ts";
export { decode } from "./engine/decode.ts";
export type { EncodeOptions, DecodeOptions, EngineResult, EncodingConfig } from "./types/index.ts";
