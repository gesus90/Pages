import { readdir, readFile, stat } from "node:fs/promises";

import { logCaughtError } from "@/backend/logging/Logger";

/** The variable that tags every process of one plan session. */
export const RUN_INSTANCE_VARIABLE = "PAGES_RUN_INSTANCE";

const PROCESS_ROOT = "/proc";
const TERMINATION_WAIT_MS = 2_000;
const KILL_WAIT_MS = 500;
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
 * The earliest start of a process that can carry the tag of one session.
 *
 * @remarks
 * A process gets the tag only from the runner of the session or one of its
 * descendants, so none started before the session. This rules out processes
 * of this account whose environment the kernel withholds, such as the
 * service manager of the account or an SSH agent.
 */
export interface TaggedProcessScope {
  /** Clock ticks after boot; a process that started earlier cannot carry the tag. */
  readonly earliestStart: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function signalProcess(processId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(processId, signal);
  } catch (caughtError: unknown) {
    // The process ended between the scan and the signal.
    if (!isVanished(caughtError)) logCaughtError("CliProcessScan", caughtError);
  }
}

/**
 * The scope of a session that this server process started.
 *
 * @param root - The process file system; Linux keeps it at `/proc`.
 * @returns The start of this server process; no older process descends from it.
 */
export async function readServerScope(
  root = PROCESS_ROOT,
): Promise<TaggedProcessScope> {
  const start = await readProcessStart(`${root}/self`);
  if (start === null) throw new Error("The server process has no start time");
  return { earliestStart: start };
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

/**
 * Finds the live processes of this account that carry the tag of one session.
 *
 * @param tag - The instance identifier of the session.
 * @param scope - When the session began; without it no unreadable process is ruled out.
 * @param root - The process file system; Linux keeps it at `/proc`.
 * @returns The process identifiers.
 * @throws When absence cannot be proved because the scan is unavailable.
 *
 * @remarks
 * Every process of a session inherits the tag, also helpers that left the
 * process group of the runner, such as an MCP server. Processes of other
 * accounts and ended processes are skipped, and so are unreadable processes
 * of this account that started before the scope. Any other unreadable
 * process of this account leaves the cleanup unconfirmed.
 */
export async function findTaggedProcesses(
  tag: string,
  scope: TaggedProcessScope | null = null,
  root = PROCESS_ROOT,
): Promise<readonly number[]> {
  const entries = await readdir(root);
  const marker = `${RUN_INSTANCE_VARIABLE}=${tag}`;
  const found: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/u.test(entry) || Number(entry) === process.pid) continue;
    const directory = `${root}/${entry}`;
    try {
      const environment = await readFile(`${directory}/environ`, "utf8");
      if (environment.split("\0").includes(marker)) found.push(Number(entry));
    } catch (error: unknown) {
      if (await cannotCarryTag(error, directory, scope)) continue;
      logCaughtError("CliProcessScan", error);
      throw error;
    }
  }
  return found;
}

/**
 * Ends every remaining process of one session and confirms that none is left.
 *
 * @param tag - The instance identifier of the session.
 * @param scope - When the session began; without it no unreadable process is ruled out.
 * @returns How many processes were still running and how many could not be ended.
 */
export async function endTaggedProcesses(
  tag: string,
  scope: TaggedProcessScope | null = null,
): Promise<TaggedProcessCleanup> {
  const found = await findTaggedProcesses(tag, scope);
  if (found.length === 0) return { found: 0, remaining: 0 };
  for (const processId of found) signalProcess(processId, "SIGTERM");
  await delay(TERMINATION_WAIT_MS);
  const lingering = await findTaggedProcesses(tag, scope);
  for (const processId of lingering) signalProcess(processId, "SIGKILL");
  if (lingering.length > 0) await delay(KILL_WAIT_MS);
  const remaining = await findTaggedProcesses(tag, scope);
  return { found: found.length, remaining: remaining.length };
}

function isVanished(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

function isAccessDenied(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EACCES" || error.code === "EPERM")
  );
}

/** Whether a process whose environment could not be read is ended, foreign or older than the session. */
async function cannotCarryTag(
  error: unknown,
  directory: string,
  scope: TaggedProcessScope | null,
): Promise<boolean> {
  if (isVanished(error) || (await isForeignOrVanished(directory))) return true;
  if (scope === null || !isAccessDenied(error)) return false;
  const start = await readProcessStart(directory);
  return start === null || start < scope.earliestStart;
}

async function isForeignOrVanished(directory: string): Promise<boolean> {
  try {
    const metadata = await stat(directory);
    return process.getuid !== undefined && metadata.uid !== process.getuid();
  } catch (error: unknown) {
    if (isVanished(error)) return true;
    logCaughtError("CliProcessScan", error);
    throw error;
  }
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
