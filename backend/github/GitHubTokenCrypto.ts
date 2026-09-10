import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const TOKEN_CIPHER = "aes-256-gcm";
const TOKEN_NONCE_BYTES = 12;

/**
 * Encrypts a GitHub token for storage in the database.
 *
 * @param plaintext - Token received from the browser, never stored directly.
 * @param key - 32-byte server-side key.
 * @returns Nonce, ciphertext, and tag as colon-separated base64 segments.
 */
export function encryptGitHubToken(plaintext: string, key: Buffer): string {
  const nonce = randomBytes(TOKEN_NONCE_BYTES);
  const cipher = createCipheriv(TOKEN_CIPHER, key, nonce);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return [nonce, ciphertext, tag]
    .map((segment) => segment.toString("base64"))
    .join(":");
}

/**
 * Decrypts a GitHub token for server-side API calls.
 *
 * @param payload - Value produced by `encryptGitHubToken`.
 * @param key - 32-byte server-side key.
 * @returns The plain token, kept inside the server process.
 */
export function decryptGitHubToken(payload: string, key: Buffer): string {
  const segments = payload.split(":");

  if (segments.length !== 3) {
    throw new Error("Stored GitHub token has an unexpected format.");
  }

  const [nonce, ciphertext, tag] = segments.map((segment) =>
    Buffer.from(segment, "base64"),
  );

  if (!nonce || nonce.length !== TOKEN_NONCE_BYTES || !ciphertext || !tag) {
    throw new Error("Stored GitHub token has an unexpected format.");
  }

  const decipher = createDecipheriv(TOKEN_CIPHER, key, nonce);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
