import { logEvent } from "@/backend/logging/Logger";

import { endTaggedProcesses, readServerScope } from "./CliProcessScan";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type { TaggedProcessScope } from "./CliProcessScan";
import type { CliSessionExit, CliSessionProcess } from "./CliSessionProcess";

// A runner gets this long to end by itself once its input is closed.
const INPUT_CLOSE_GRACE_MS = 15_000;
const TERMINATION_WAIT_MS = 10_000;

/**
 * Ends the process of a session, then every process of it that is left.
 *
 * @param process - The runner process of the session.
 * @param instanceId - The tag every process of the session carries.
 * @param scope - The boundary captured before spawning; defaults to this server's start.
 * @param isPidNamespace - Whether the tracked process owns a PID namespace that contains all its children.
 * @returns The actual exit, how many processes outlived the runner and
 * whether none is left.
 *
 * @remarks
 * Closing the input lets a runner end on its own; after the grace period its
 * process is terminated. Legacy sessions without an owned boundary remain
 * unconfirmed because an inherited environment tag cannot prove ownership.
 * A caller may pass `isPidNamespace` only for a tracked namespace supervisor:
 * its exit tears down the namespace and every descendant, including a child
 * that left the process group. A unit-settlement failure stays unconfirmed.
 */
export async function closeCliSession(
  process: Pick<CliSessionProcess, "endInput" | "exited" | "cancel">,
  instanceId: string,
  scope?: TaggedProcessScope,
  isPidNamespace = false,
): Promise<PlanSessionClosed> {
  process.endInput();
  const exit = await waitForExit(process.exited, INPUT_CLOSE_GRACE_MS);
  if (exit === null) process.cancel("login_cancelled");
  const settled =
    exit ?? (await waitForExit(process.exited, TERMINATION_WAIT_MS));
  const cleanup = isPidNamespace
    ? { found: 0, remaining: 0 }
    : await endTaggedProcesses(instanceId, scope ?? (await readServerScope()));
  const isConfirmed =
    settled !== null &&
    settled.errorCode !== "credential_cleanup_failed" &&
    cleanup.remaining === 0;
  logEvent({
    level: settled !== null && cleanup.remaining === 0 ? "info" : "warn",
    event: "cli.session.cleanup",
    component: "CliSessionCloseout",
    message: "CLI process cleanup finished",
    metadata: {
      leftovers: cleanup.found,
      isConfirmed,
    },
  });
  return {
    exit: settled ? { code: settled.code, signal: settled.signal } : null,
    endedAt: new Date().toISOString(),
    leftovers: cleanup.found,
    isConfirmed,
    ...(isPidNamespace && isConfirmed
      ? { containment: "pid_namespace" as const }
      : {}),
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
