import { createHash, randomBytes } from "node:crypto";

/** Creates a high-entropy opaque credential whose clear text is returned once. */
export function createAgentCredential(): string {
  return randomBytes(32).toString("base64url");
}

/** Produces the only persisted representation of an agent credential. */
export function hashAgentCredential(credential: string): string {
  return createHash("sha256").update(credential).digest("hex");
}
