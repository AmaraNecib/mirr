/**
 * Example: Encoding with RSA Encryption
 * 
 * This example shows how to encode a file with encryption enabled.
 * You can use environment variables or generate keys programmatically.
 */

// Option 1: Using environment variables (recommended for production)
// Set these in your .env file or shell:
// export RSA_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----..."
// export RSA_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----..."
// export ENABLE_ENCRYPTION=true

// Then run:
// bun run encode input/secret.txt output --encryption

// Option 2: Generate keys programmatically
import { generateKeyPairSync } from "crypto";

const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
        type: "spki",
        format: "pem",
    },
    privateKeyEncoding: {
        type: "pkcs8",
        format: "pem",
    },
});

console.log("Generated RSA Keys:\n");
console.log("Public Key:");
console.log(publicKey);
console.log("\nPrivate Key:");
console.log(privateKey);

console.log("\n\nTo use these keys:");
console.log("1. Save them to environment variables:");
console.log('   export RSA_PUBLIC_KEY="' + publicKey.replace(/\n/g, '\\n') + '"');
console.log('   export RSA_PRIVATE_KEY="' + privateKey.replace(/\n/g, '\\n') + '"');
console.log("\n2. Encode with encryption:");
console.log("   bun run encode input/secret.txt output --encryption");
console.log("\n3. Decode (requires private key):");
console.log("   bun run decode output result.txt");
