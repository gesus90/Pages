import { logEvent } from "@/backend/logging/Logger";

import { endTaggedProcesses, readServerScope } from "./CliProcessScan";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type { CliSessionExit, CliSessionProcess } from "./CliSessionProcess";

// A runner gets this long to end by itself once its input is closed.
const INPUT_CLOSE_GRACE_MS = 15_000;
const TERMINATION_WAIT_MS = 10_000;

/**
 * Ends the process of a session, then every process of it that is left.
 *
 * @param process - The runner process of the session.
 * @param instanceId - The tag every process of the session carries.
 * @returns The actual exit, how many processes outlived the runner and
 * whether none is left.
 *
 * @remarks
 * Closing the input lets a runner end on its own; after the grace period its
 * whole process group is terminated. Helpers that left the group, such as an
 * MCP server, are found by their tag and ended as well. The session was
 * started by this server process, so no older process can carry its tag.
 */
export async function closeCliSession(
  process: Pick<CliSessionProcess, "endInput" | "exited" | "cancel">,
  instanceId: string,
): Promise<PlanSessionClosed> {
  process.endInput();
  const exit = await waitForExit(process.exited, INPUT_CLOSE_GRACE_MS);
  if (exit === null) process.cancel("login_cancelled");
  const settled =
    exit ?? (await waitForExit(process.exited, TERMINATION_WAIT_MS));
  const cleanup = await endTaggedProcesses(instanceId, await readServerScope());
  logEvent({
    level: settled !== null && cleanup.remaining === 0 ? "info" : "warn",
    event: "cli.session.cleanup",
    component: "CliSessionCloseout",
    message: "CLI process cleanup finished",
    metadata: {
      leftovers: cleanup.found,
      isConfirmed: settled !== null && cleanup.remaining === 0,
    },
  });
  return {
    exit: settled ? { code: settled.code, signal: settled.signal } : null,
    endedAt: new Date().toISOString(),
    leftovers: cleanup.found,
    isConfirmed: settled !== null && cleanup.remaining === 0,
  };
}

async function waitForExit(
  exited: Promise<CliSessionExit>,
  milliseconds: number,
): Promise<CliSessionExit | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      exited,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
