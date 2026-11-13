import { logEvent } from "@/backend/logging/Logger";

import { endTaggedProcesses, readServerScope } from "./CliProcessScan";
import { settleWorkerUnits } from "./CliWorkerUnit";

import type { PlanSessionClosed } from "@/backend/agents/AgentPlanExecution";
import type { TaggedProcessScope } from "./CliProcessScan";
import type { CliSessionExit, CliSessionProcess } from "./CliSessionProcess";

/**
 * What contains every process of a session, so its end proves that none is left.
 *
 * @remarks
 * `pid_namespace`: the tracked process is the init of an owned PID namespace.
 * `worker_unit`: the session runs in limited transient units of the service
 * manager whose names carry its tag, and the tracked process is the client of
 * one; its exit is reported only after that unit settled (PAGE-335, PAGE-340).
 * An unisolated YOLO chat uses this frame. `none`: nothing proves containment.
 */
export type CliSessionContainment = "pid_namespace" | "worker_unit" | "none";

// A runner gets this long to end by itself once its input is closed.
const INPUT_CLOSE_GRACE_MS = 15_000;
const TERMINATION_WAIT_MS = 10_000;

/**
 * Ends the process of a session, then every process of it that is left.
 *
 * @param process - The runner process of the session.
 * @param instanceId - The tag every process of the session carries.
 * @param scope - The boundary captured before spawning; defaults to this server's start.
 * @param containment - What contains every process of the session.
 * @returns The actual exit, how many processes outlived the runner and
 * whether none is left.
 *
 * @remarks
 * Closing the input lets a runner end on its own; after the grace period its
 * process is terminated. Legacy sessions without an owned boundary remain
 * unconfirmed because an inherited environment tag cannot prove ownership.
 * A caller may pass `pid_namespace` only for a tracked namespace supervisor:
 * its exit tears down the namespace and every descendant, including a child
 * that left the process group. `worker_unit` is for a process started in a
 * limited unit: its exit is reported after the unit stopped (PAGE-340), and
 * the closeout stops the units of the session and confirms only when none of
 * them runs any more (PAGE-335). A unit-settlement failure stays
 * unconfirmed.
 */
export async function closeCliSession(
  process: Pick<CliSessionProcess, "endInput" | "exited" | "cancel">,
  instanceId: string,
  scope?: TaggedProcessScope,
  containment: CliSessionContainment = "none",
): Promise<PlanSessionClosed> {
  process.endInput();
  const exit = await waitForExit(process.exited, INPUT_CLOSE_GRACE_MS);
  if (exit === null) process.cancel("login_cancelled");
  const settled =
    exit ?? (await waitForExit(process.exited, TERMINATION_WAIT_MS));
  const cleanup = await endContainedProcesses(instanceId, scope, containment);
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
      kind: containment,
    },
  });
  return {
    exit: settled ? { code: settled.code, signal: settled.signal } : null,
    endedAt: new Date().toISOString(),
    leftovers: cleanup.found,
    isConfirmed,
    ...(containment === "pid_namespace" && isConfirmed
      ? { containment: "pid_namespace" as const }
      : {}),
  };
}

async function endContainedProcesses(
  instanceId: string,
  scope: TaggedProcessScope | undefined,
  containment: CliSessionContainment,
): Promise<{ readonly found: number; readonly remaining: number }> {
  if (containment === "pid_namespace") return { found: 0, remaining: 0 };
  if (containment === "worker_unit") {
    const remaining = await settleWorkerUnits(instanceId);
    return { found: remaining, remaining };
  }
  return endTaggedProcesses(instanceId, scope ?? (await readServerScope()));
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
