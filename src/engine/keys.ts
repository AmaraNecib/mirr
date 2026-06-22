/**
 * Encryption environment loader.
 *
 * Reads MIRR_PUBLIC_KEY and MIRR_PRIVATE_KEY from the environment.
 * Fails loudly with a one-line fix if the required key is missing —
 * no silent fallbacks, no key generation. The user chose env vars, so the
 * contract is: have them set, or get a clear error.
 */

import type { EncryptionKeys } from "../types/index.ts";

/** Read both keys from the environment. Either may be undefined. */
export function readKeysFromEnv(): EncryptionKeys {
  const publicKey = process.env.MIRR_PUBLIC_KEY?.trim();
  const privateKey = process.env.MIRR_PRIVATE_KEY?.trim();
  return {
    publicKey: publicKey || undefined,
    privateKey: privateKey || undefined,
  };
}

/** Throw if a public key is needed but missing or malformed. */
export function requirePublicKey(): string {
  const key = process.env.MIRR_PUBLIC_KEY?.trim();
  if (!key) {
    throw new Error(
      "MIRR_PUBLIC_KEY is not set. Generate a key pair with:\n" +
      "  openssl genrsa -out private.pem 2048\n" +
      "  openssl rsa -in private.pem -pubout -out public.pem\n" +
      "Then export MIRR_PUBLIC_KEY=\"$(cat public.pem)\" and try again."
    );
  }
  if (!key.includes("BEGIN PUBLIC KEY") && !key.includes("BEGIN RSA PUBLIC KEY")) {
    throw new Error(
      "MIRR_PUBLIC_KEY does not look like a PEM public key. " +
      "Expected '-----BEGIN PUBLIC KEY-----' header."
    );
  }
  return key;
}

/** Throw if a private key is needed but missing or malformed. */
export function requirePrivateKey(): string {
  const key = process.env.MIRR_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error(
      "Cannot decode encrypted file: MIRR_PRIVATE_KEY is not set. " +
      "The file is encrypted; the matching private key is required."
    );
  }
  if (!key.includes("BEGIN PRIVATE KEY") && !key.includes("BEGIN RSA PRIVATE KEY")) {
    throw new Error(
      "MIRR_PRIVATE_KEY does not look like a PEM private key. " +
      "Expected '-----BEGIN PRIVATE KEY-----' header."
    );
  }
  return key;
}