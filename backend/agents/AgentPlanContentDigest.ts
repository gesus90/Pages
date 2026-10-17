import { createHash } from "node:crypto";

/** Hashes frozen JSON content without persisting another copy of sensitive inputs. */
export function planContentDigest(input: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(input) ?? "null")
    .digest("hex");
}
