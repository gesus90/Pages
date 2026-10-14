import { endTaggedProcesses } from "./CliProcessScan";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type { CliSessionProcess } from "./CliSessionProcess";

// A runner gets this long to end by itself once its input is closed.
const INPUT_CLOSE_GRACE_MS = 15_000;

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
 * MCP server, are found by their tag and ended as well.
 */
export async function closeCliSession(
  process: Pick<CliSessionProcess, "endInput" | "exited" | "cancel">,
  instanceId: string,
): Promise<PlanSessionClosed> {
  process.endInput();
  let grace: ReturnType<typeof setTimeout> | undefined;
  const exit = await Promise.race([
    process.exited,
    new Promise<null>((resolve) => {
      grace = setTimeout(() => resolve(null), INPUT_CLOSE_GRACE_MS);
    }),
  ]);
  clearTimeout(grace);
  if (exit === null) process.cancel("login_cancelled");
  const settled = await process.exited;
  const cleanup = await endTaggedProcesses(instanceId);
  return {
    exit: { code: settled.code, signal: settled.signal },
    endedAt: new Date().toISOString(),
    leftovers: cleanup.found,
    isConfirmed: cleanup.remaining === 0,
  };
}
