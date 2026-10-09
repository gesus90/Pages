import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

import { AgentError } from "@/backend/error/AgentErrors";

const CIPHER = "aes-256-gcm";
const PAYLOAD_PATTERN =
  /^v1\.([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{22})$/;

/** Encrypts connection secrets with a purpose-derived key and connection-bound AAD. */
export class InstanceSecretCipher {
  private readonly key: Buffer;

  public constructor(instanceKey: Buffer) {
    this.key = Buffer.from(
      hkdfSync(
        "sha256",
        instanceKey,
        "",
        "pages:agent-connection-secret:v1",
        32,
      ),
    );
  }

  /** Produces a versioned payload; equal secrets always receive fresh nonces. */
  public encrypt(connectionId: string, plaintext: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(CIPHER, this.key, nonce);
    cipher.setAAD(Buffer.from(`agent-connection:${connectionId}`));
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  /** Rejects unknown versions, relocation, malformed payloads and tampering safely. */
  public decrypt(connectionId: string, payload: string): string {
    try {
      const match = PAYLOAD_PATTERN.exec(payload);
      if (!match) throw new AgentError("secret_unavailable");
      const decipher = createDecipheriv(
        CIPHER,
        this.key,
        Buffer.from(match[1], "base64url"),
      );
      decipher.setAAD(Buffer.from(`agent-connection:${connectionId}`));
      decipher.setAuthTag(Buffer.from(match[3], "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(match[2], "base64url")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new AgentError("secret_unavailable");
    }
  }
}
