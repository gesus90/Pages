import { readFile } from "node:fs/promises";

import { logCaughtError } from "@/backend/logging/Logger";

import type {
  AcpResourceOptions,
  AcpWaitReason,
} from "@/definition/AcpResource";

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

/** Narrows a scheduler memory probe and preserves the conservative result on failure. */
export async function readScheduledAcpMemory(
  read: () => Promise<number | null>,
): Promise<number | null> {
  try {
    const available = await read();
    return available !== null && Number.isFinite(available) && available >= 0
      ? available
      : null;
  } catch (error: unknown) {
    logCaughtError("AcpResourceScheduler", error);
    return null;
  }
}

/**
 * Why memory-aware admission holds a request back, or `null` when memory allows it.
 *
 * @param options - The admission options of the scheduler.
 * @param availableMemory - The last probe in MiB; `null` when unknown.
 */
export function acpMemoryWaitReason(
  options: AcpResourceOptions,
  availableMemory: number | null,
): AcpWaitReason | null {
  if (!options.memoryAwareScheduling) return null;
  if (availableMemory === null) return "memory_unknown";
  return availableMemory < options.minimumAvailableMemory ? "memory" : null;
}
