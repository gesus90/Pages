import { readFile, readdir } from "node:fs/promises";

import {
  endTaggedProcesses,
  findTaggedProcesses,
} from "@/backend/agents/cli/CliProcessScan";

import type { TaggedProcessScope } from "@/backend/agents/cli/CliProcessScan";

/** Signals only the fresh process group of a live, owned attempt; never a persisted PID. */
export function signalScriptGroup(
  processId: number | undefined,
  signal: NodeJS.Signals,
): boolean {
  if (!processId) return true;
  try {
    process.kill(-processId, signal);
    return true;
  } catch (error: unknown) {
    return error instanceof Error && "code" in error && error.code === "ESRCH";
  }
}

async function hasLiveGroup(processId: number): Promise<boolean> {
  for (const entry of await readdir("/proc")) {
    if (!/^\d+$/u.test(entry)) continue;
    let record: string;
    try {
      record = await readFile(`/proc/${entry}/stat`, "utf8");
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error.code === "ENOENT" || error.code === "ESRCH")
      )
        continue;
      throw error;
    }
    const fields = record.slice(record.lastIndexOf(")") + 2).split(" ");
    if (
      Number(fields[2]) === processId &&
      fields[0] !== "Z" &&
      fields[0] !== "X"
    )
      return true;
  }
  return false;
}

/** Confirms tagged descendants and the attempt's own group have ended after bounded TERM/KILL escalation. */
export async function closeScriptProcesses(input: {
  readonly processId: number | undefined;
  readonly instanceId: string;
  readonly scope: TaggedProcessScope;
}): Promise<boolean> {
  let hasSignalFailure = !signalScriptGroup(input.processId, "SIGTERM");
  const began = Date.now();
  function escalate(): void {
    const isSignalled = signalScriptGroup(input.processId, "SIGKILL");
    hasSignalFailure = hasSignalFailure || !isSignalled;
  }
  const escalation = setTimeout(escalate, 2000);
  try {
    const cleanup = await endTaggedProcesses(input.instanceId, input.scope);
    if (input.processId && (await hasLiveGroup(input.processId))) {
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.max(0, 2000 - (Date.now() - began))),
      );
      escalate();
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    }
    const tagged = await findTaggedProcesses(input.instanceId, input.scope);
    return (
      !hasSignalFailure &&
      cleanup.remaining === 0 &&
      tagged.length === 0 &&
      (input.processId === undefined || !(await hasLiveGroup(input.processId)))
    );
  } finally {
    clearTimeout(escalation);
  }
}
