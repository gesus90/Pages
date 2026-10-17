import { readFile } from "node:fs/promises";

import { logCaughtError } from "@/backend/logging/Logger";

/** Reads Linux's reclaim-aware free memory in MiB; unavailable metrics never imply spare RAM. */
export async function readAcpAvailableMemory(): Promise<number | null> {
  try {
    const contents = await readFile("/proc/meminfo", "utf8");
    const match = /^MemAvailable:\s+(\d+)\s+kB$/mu.exec(contents);
    return match?.[1] ? Number(match[1]) / 1024 : null;
  } catch (caughtError: unknown) {
    logCaughtError("AcpMemory", caughtError);

    return null;
  }
}
