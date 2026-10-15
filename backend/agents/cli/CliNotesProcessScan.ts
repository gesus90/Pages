import { readdir, readFile, stat } from "node:fs/promises";

import { RUN_INSTANCE_VARIABLE } from "./CliProcessScan";

function hasExited(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

async function processIsGone(
  processId: string,
  markers: ReadonlySet<string>,
): Promise<boolean> {
  try {
    const metadata = await stat(`/proc/${processId}`);
    if (metadata.uid !== process.getuid?.()) return true;
    const environment = await readFile(`/proc/${processId}/environ`, "utf8");
    return !environment.split("\0").some((entry) => markers.has(entry));
  } catch (error: unknown) {
    if (hasExited(error)) return true;
    console.error(
      "Pages could not confirm an own process state for run notes cleanup.",
      error,
    );
    return false;
  }
}

/** Unlike best-effort diagnostics, an unavailable /proc or unreadable own process means unknown. */
export async function areTaggedProcessesGone(
  tags: readonly string[],
): Promise<boolean> {
  try {
    const entries = await readdir("/proc");
    const markers = new Set(
      tags.map((tag) => `${RUN_INSTANCE_VARIABLE}=${tag}`),
    );
    for (const entry of entries) {
      if (!/^\d+$/u.test(entry) || Number(entry) === process.pid) continue;
      if (!(await processIsGone(entry, markers))) return false;
    }
    return true;
  } catch (error: unknown) {
    console.error(
      "Pages could not confirm process exit for orphaned run notes.",
      error,
    );
    return false;
  }
}
