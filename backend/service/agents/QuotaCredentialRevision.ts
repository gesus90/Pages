import { createHash } from "node:crypto";

/**
 * Names the stored credential of a connection, so a reading never outlives the key it was read with.
 * @param id - The connection.
 * @param encrypted - The stored, encrypted credential.
 * @returns The connection with a fingerprint of the encrypted credential.
 */
export function credentialRevision(id: string, encrypted: string): string {
  const fingerprint = createHash("sha256").update(encrypted).digest("hex");
  return `${id}:${fingerprint}`;
}
