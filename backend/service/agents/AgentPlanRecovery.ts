import {
  endTaggedProcesses,
  findTaggedProcesses,
  readScopeSince,
} from "@/backend/agents/cli/CliProcessScan";
import { isAcpProvider } from "@/definition/AgentConfiguration";

import type { TaggedProcessScope } from "@/backend/agents/cli/CliProcessScan";
import type { AcpResourceOwner } from "@/definition/AcpResource";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

/** No session of a run started before the run. */
async function runScope(
  runStartedAt: string,
): Promise<TaggedProcessScope | null> {
  try {
    return await readScopeSince(runStartedAt);
  } catch {
    // Without a readable start the scan stays unbounded, and therefore strict.
    return null;
  }
}

/**
 * Ends what an interrupted node left behind: its processes and its MCP access.
 *
 * @param step - The node of the interrupted run.
 * @param runStartedAt - When its run began, before any of its sessions.
 *
 * @remarks
 * A server stop can leave a runner and its helpers running in their own
 * process group. Every process of a session carries its instance tag, so the
 * restarted server finds and ends them before it reports the node as failed.
 * Unreadable processes of this account that started before the run, such as
 * its service manager, cannot carry the tag.
 */
export async function endInterruptedSession(
  step: AgentPlanStepResult,
  runStartedAt: string,
): Promise<AgentPlanStepResult> {
  const session = step.session;
  if (!session || session.closeout !== "pending") return step;
  const cleanup = await endTaggedProcesses(
    session.instanceId,
    await runScope(runStartedAt),
  ).catch(() => ({ found: 0, remaining: 1 }));
  return {
    ...step,
    session: {
      ...session,
      endedAt: new Date().toISOString(),
      closeout: cleanup.remaining === 0 ? "confirmed" : "failed",
      leftoverProcesses: cleanup.found,
      resultCode: -1,
    },
  };
}

/**
 * Whether no process of any session of the run is alive any more.
 *
 * @remarks
 * A node stores its session record before its runner starts, so a node
 * without one never started a process. The start of the run bounds the scan
 * like that of {@link endInterruptedSession}.
 */
export async function hasNoSessionProcesses(
  run: AgentPlanRun,
): Promise<boolean> {
  const scope = await runScope(run.startedAt);
  const scans = await Promise.all(
    run.steps.flatMap((step) =>
      step.session
        ? [findTaggedProcesses(step.session.instanceId, scope).catch(() => [0])]
        : [],
    ),
  );
  return scans.every((processes) => processes.length === 0);
}

/** Adopts older interrupted sessions that predate the durable ACP capacity journal. */
export function interruptedAcpOwners(
  runs: readonly AgentPlanRun[],
): readonly AcpResourceOwner[] {
  return runs.flatMap((run) =>
    run.steps.flatMap((step) => {
      const session = step.session;
      if (
        !session ||
        (session.closeout !== "pending" && session.closeout !== "failed") ||
        session.runner === "api" ||
        !isAcpProvider(session.runner) ||
        session.mode !== "interactive"
      )
        return [];
      return [
        {
          instanceId: session.instanceId,
          userId: run.userId,
          provider: session.runner,
          runId: run.id,
          stepId: step.id,
        },
      ];
    }),
  );
}
