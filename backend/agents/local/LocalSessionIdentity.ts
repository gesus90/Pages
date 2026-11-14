import { createHash } from "node:crypto";
import path from "node:path";

/** Identifies the Pages instance that owns native sessions. */
export function localInstanceKey(tokenKey: Buffer, configPath: string): string {
  return createHash("sha256")
    .update(tokenKey)
    .update(path.resolve(configPath))
    .digest("hex");
}
