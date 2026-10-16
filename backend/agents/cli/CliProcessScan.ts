import { readdir, readFile, stat } from "node:fs/promises";

/** The variable that tags every process of one plan session. */
export const RUN_INSTANCE_VARIABLE = "PAGES_RUN_INSTANCE";

const TERMINATION_WAIT_MS = 2_000;
const KILL_WAIT_MS = 500;

/** What a closeout found and left. */
export interface TaggedProcessCleanup {
  /** Processes of the session that still ran after the runner ended. */
  readonly found: number;
  /** Processes that could not be ended; a confirmed closeout needs 0. */
  readonly remaining: number;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function signalProcess(processId: number, signal: NodeJS.Signals): void {
  try {
    process.kill(processId, signal);
  } catch {
    // The process ended between the scan and the signal.
  }
}

/**
 * Finds the live processes of this account that carry the tag of one session.
 *
 * @param tag - The instance identifier of the session.
 * @param root - The process file system; Linux keeps it at `/proc`.
 * @returns The process identifiers.
 * @throws When absence cannot be proved because the scan is unavailable.
 *
 * @remarks
 * Every process of a session inherits the tag, also helpers that left the
 * process group of the runner, such as an MCP server. Processes of other
 * accounts and ended processes are skipped. Unreadable processes owned by
 * this account leave the cleanup unconfirmed.
 */
export async function findTaggedProcesses(
  tag: string,
  root = "/proc",
): Promise<readonly number[]> {
  const entries = await readdir(root);
  const marker = `${RUN_INSTANCE_VARIABLE}=${tag}`;
  const found: number[] = [];
  for (const entry of entries) {
    if (!/^\d+$/u.test(entry) || Number(entry) === process.pid) continue;
    try {
      const environment = await readFile(`${root}/${entry}/environ`, "utf8");
      if (environment.split("\0").includes(marker)) found.push(Number(entry));
    } catch (error: unknown) {
      if (isVanished(error)) continue;
      if (await isForeignOrVanished(`${root}/${entry}`)) continue;
      throw error;
    }
  }
  return found;
}

/**
 * Ends every remaining process of one session and confirms that none is left.
 *
 * @param tag - The instance identifier of the session.
 * @returns How many processes were still running and how many could not be ended.
 */
export async function endTaggedProcesses(
  tag: string,
): Promise<TaggedProcessCleanup> {
  const found = await findTaggedProcesses(tag);
  if (found.length === 0) return { found: 0, remaining: 0 };
  for (const processId of found) signalProcess(processId, "SIGTERM");
  await delay(TERMINATION_WAIT_MS);
  const lingering = await findTaggedProcesses(tag);
  for (const processId of lingering) signalProcess(processId, "SIGKILL");
  if (lingering.length > 0) await delay(KILL_WAIT_MS);
  const remaining = await findTaggedProcesses(tag);
  return { found: found.length, remaining: remaining.length };
}

function isVanished(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

async function isForeignOrVanished(directory: string): Promise<boolean> {
  try {
    const metadata = await stat(directory);
    return process.getuid !== undefined && metadata.uid !== process.getuid();
  } catch (error: unknown) {
    if (isVanished(error)) return true;
    throw error;
  }
}
