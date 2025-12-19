import type { EncryptionKeys } from "../types/index.ts";

/** RSA encryption using Web Crypto API */
export class EncryptionService {
  private publicKey: CryptoKey | null = null;
  private privateKey: CryptoKey | null = null;
  
  /** Load RSA keys from PEM strings */
  async loadKeys(keys: EncryptionKeys): Promise<void> {
    if (keys.publicKey) {
      this.publicKey = await this.importPublicKey(keys.publicKey);
    }
    if (keys.privateKey) {
      this.privateKey = await this.importPrivateKey(keys.privateKey);
    }
  }
  
  /** Encrypt data using RSA-OAEP (for small data) or hybrid encryption */
  async encrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.publicKey) {
      throw new Error("Public key not loaded");
    }
    
    // For large data, use hybrid encryption: AES + RSA
    // Generate random AES key
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
    
    // Generate random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    // Encrypt data with AES
    const encryptedData = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aesKey,
      data.buffer as ArrayBuffer
    );
    
    // Export AES key
    const exportedKey = await crypto.subtle.exportKey("raw", aesKey);
    
    // Encrypt AES key with RSA
    const encryptedKey = await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      this.publicKey,
      exportedKey
    );
    
    // Combine: [encryptedKeyLength(4)][encryptedKey][iv(12)][encryptedData]
    const result = new Uint8Array(
      4 + encryptedKey.byteLength + 12 + encryptedData.byteLength
    );
    const view = new DataView(result.buffer);
    
    view.setUint32(0, encryptedKey.byteLength, false);
    result.set(new Uint8Array(encryptedKey), 4);
    result.set(iv, 4 + encryptedKey.byteLength);
    result.set(new Uint8Array(encryptedData), 4 + encryptedKey.byteLength + 12);
    
    return result;
  }
  
  /** Decrypt data */
  async decrypt(data: Uint8Array): Promise<Uint8Array> {
    if (!this.privateKey) {
      throw new Error("Private key not loaded");
    }
    
    const view = new DataView(data.buffer, data.byteOffset);
    
    // Read encrypted key length
    const encryptedKeyLength = view.getUint32(0, false);
    
    // Extract components
    const encryptedKey = data.slice(4, 4 + encryptedKeyLength);
    const iv = data.slice(4 + encryptedKeyLength, 4 + encryptedKeyLength + 12);
    const encryptedData = data.slice(4 + encryptedKeyLength + 12);
    
    // Decrypt AES key with RSA
    const decryptedKey = await crypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      this.privateKey,
      encryptedKey
    );
    
    // Import AES key
    const aesKey = await crypto.subtle.importKey(
      "raw",
      decryptedKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    
    // Decrypt data with AES
    const decryptedData = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      aesKey,
      encryptedData
    );
    
    return new Uint8Array(decryptedData);
  }
  
  /** Import public key from PEM */
  private async importPublicKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
      .replace(/-----BEGIN PUBLIC KEY-----/, "")
      .replace(/-----END PUBLIC KEY-----/, "")
      .replace(/\s/g, "");
    
    const binaryDer = this.base64ToArrayBuffer(pemContents);
    
    return await crypto.subtle.importKey(
      "spki",
      binaryDer,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"]
    );
  }
  
  /** Import private key from PEM */
  private async importPrivateKey(pem: string): Promise<CryptoKey> {
    const pemContents = pem
      .replace(/-----BEGIN PRIVATE KEY-----/, "")
      .replace(/-----END PRIVATE KEY-----/, "")
      .replace(/-----BEGIN RSA PRIVATE KEY-----/, "")
      .replace(/-----END RSA PRIVATE KEY-----/, "")
      .replace(/\s/g, "");
    
    const binaryDer = this.base64ToArrayBuffer(pemContents);
    
    return await crypto.subtle.importKey(
      "pkcs8",
      binaryDer,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["decrypt"]
    );
  }
  
  /** Convert base64 to ArrayBuffer */
  private base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }
}

/** Create encryption service instance */
export function createEncryptionService(): EncryptionService {
  return new EncryptionService();
}
