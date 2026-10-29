import { readFile } from "node:fs/promises";

import { logCaughtError } from "@/backend/logging/Logger";

import { stopWorkerUnits } from "./CliWorkerUnit";

/** The legacy session tag, retained for child configuration and diagnostics. */
export const RUN_INSTANCE_VARIABLE = "PAGES_RUN_INSTANCE";

const PROCESS_ROOT = "/proc";
// Linux counts process start times in USER_HZ, which its ABI fixes at 100 on
// every architecture Node.js runs on.
const TICKS_PER_SECOND = 100;
// The start time is field 22 of `/proc/<pid>/stat`, the 20th after the name.
const START_TIME_FIELD = 19;
// A recorded start is wall-clock time; this absorbs clock corrections since.
const RECORDED_START_TOLERANCE_SECONDS = 60;

/** What a closeout found and left. */
export interface TaggedProcessCleanup {
  /** Processes of the session that still ran after the runner ended. */
  readonly found: number;
  /** Processes that could not be ended; a confirmed closeout needs 0. */
  readonly remaining: number;
}

/**
 * A legacy time bound retained for existing callers; it is not ownership proof.
 */
export interface TaggedProcessScope {
  /** Clock ticks after boot; a process that started earlier cannot carry the tag. */
  readonly earliestStart: number;
}

/**
 * A legacy time bound captured from this server's process start.
 *
 * @param root - The process file system; Linux keeps it at `/proc`.
 * @returns The start of this server process.
 */
export async function readServerScope(
  root = PROCESS_ROOT,
): Promise<TaggedProcessScope> {
  const start = await readProcessStart(`${root}/self`);
  if (start === null) throw new Error("The server process has no start time");
  return { earliestStart: start };
}

/**
 * Captures a legacy monotonic time bound before creating a child.
 */
export async function readSpawnScope(
  root = PROCESS_ROOT,
): Promise<TaggedProcessScope> {
  return {
    earliestStart: Math.floor((await readUptime(root)) * TICKS_PER_SECOND),
  };
}

/**
 * The scope of a session that began at a recorded time, possibly in an earlier
 * server process or before the last boot.
 *
 * @param startedAt - When the session began, as an ISO timestamp taken before its runner started.
 * @param root - The process file system; Linux keeps it at `/proc`.
 * @throws When the timestamp or the uptime of the system is unreadable.
 */
export async function readScopeSince(
  startedAt: string,
  root = PROCESS_ROOT,
): Promise<TaggedProcessScope> {
  const began = Date.parse(startedAt);
  if (!Number.isFinite(began)) throw new Error("Invalid session start");
  const uptime = await readUptime(root);
  const age = (Date.now() - began) / 1000;
  // A start in the future means the clock went back; nothing can be ruled out.
  if (age < 0) return { earliestStart: 0 };
  const startAfterBoot = uptime - age;
  // Every process of a session from an earlier boot ended with that boot.
  if (startAfterBoot < -RECORDED_START_TOLERANCE_SECONDS)
    return { earliestStart: Number.POSITIVE_INFINITY };
  return {
    earliestStart: Math.max(
      0,
      (startAfterBoot - RECORDED_START_TOLERANCE_SECONDS) * TICKS_PER_SECOND,
    ),
  };
}

/** Refuses legacy marker discovery: an inherited environment is not ownership evidence. */
export async function findTaggedProcesses(
  ...parameters: [tag: string, scope?: TaggedProcessScope | null, root?: string]
): Promise<readonly number[]> {
  throw new Error(
    `Process ownership is unverified for legacy session ${parameters[0]}`,
  );
}

/** Stops any owned named units but retains uncertainty without durable containment evidence. */
export async function endTaggedProcesses(
  tag: string,
  scope: TaggedProcessScope | null = null,
): Promise<TaggedProcessCleanup> {
  // A worker unit holds its whole cgroup; stopping it by its owned name comes before any PID.
  await stopWorkerUnits(tag).catch((caughtError: unknown) => {
    logCaughtError("CliProcessScan", caughtError);
  });
  await findTaggedProcesses(tag, scope);
  throw new Error("Process ownership is unverified for this legacy session");
}

function isVanished(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

/** The start of a process in clock ticks after boot, or `null` once it ended. */
async function readProcessStart(directory: string): Promise<number | null> {
  let line: string;
  try {
    line = await readFile(`${directory}/stat`, "utf8");
  } catch (error: unknown) {
    if (isVanished(error)) return null;
    logCaughtError("CliProcessScan", error);
    throw error;
  }
  // The name in parentheses may contain spaces; the fields after it are numbers.
  const fields = line.slice(line.lastIndexOf(")") + 2).split(" ");
  const start = Number(fields[START_TIME_FIELD]);
  if (!Number.isSafeInteger(start) || start < 0)
    throw new Error("Unreadable process start time");
  return start;
}

async function readUptime(root: string): Promise<number> {
  const uptime = Number(
    (await readFile(`${root}/uptime`, "utf8")).split(" ")[0],
  );
  if (!Number.isFinite(uptime) || uptime < 0)
    throw new Error("Unreadable system uptime");
  return uptime;
}
