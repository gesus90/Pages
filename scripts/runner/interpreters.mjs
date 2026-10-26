import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";

/** Discovers fixed paths; a failed probe never reports an authoritative empty catalog. */
export async function interpreterCatalog() {
  const profiles = [];
  let isComplete = true;
  for (const [id, name, path] of [
    ["bash", "Bash", "/usr/bin/bash"],
    ["python3", "Python 3", "/usr/bin/python3"],
    ["node", "Node.js", process.execPath],
  ]) {
    try {
      const metadata = await stat(path);
      if (!metadata.isFile() || !(metadata.mode & 0o111)) {
        isComplete = false;
        continue;
      }
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      const digest = hash.digest("hex");
      profiles.push({
        id,
        name,
        path,
        digest,
        version: `${name} · ${digest.slice(0, 12)}`,
      });
    } catch (error) {
      if (error.code !== "ENOENT") isComplete = false;
    }
  }
  return { interpreters: profiles, isComplete };
}

/** Worker-side verification always probes the exact executable again before start. */
export async function interpreters() {
  return (await interpreterCatalog()).interpreters;
}
