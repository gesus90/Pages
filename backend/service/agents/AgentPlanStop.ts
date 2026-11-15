import { AgentError } from "@/backend/error/AgentErrors";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";

import { logCaughtError } from "@/backend/logging/Logger";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { controlPlanProcesses } from "./AgentPlanProcessControl";
import { forgetPlanPauseGate } from "./AgentPlanPauseGate";
import { endedPlanRun } from "./AgentPlanRunState";
import { settleStoppedScripts } from "./AgentPlanStoppedScripts";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { SerialQueue } from "@/backend/concurrency/SerialQueue";

function stoppedStep(step: AgentPlanStepResult): AgentPlanStepResult {
  if (!["running", "waiting", "paused"].includes(step.status)) return step;
  return {
    ...step,
    status: "cancelled",
    isBlocked: false,
    cancellation:
      step.status === "running" ||
      step.session?.startedAt ||
      step.script?.processId
        ? "requested"
        : "not_started",
  };
}

/** Permanently fences dispatch while retaining completed results and cleanup evidence. */
export function stoppedPlanRun(run: AgentPlanRun): AgentPlanRun {
  return {
    ...endedPlanRun(run, "cancelled"),
    stopRequested: true,
    steps: run.steps.map(stoppedStep),
    loops: run.loops?.map((loop) => ({
      ...loop,
      status: ["running", "waiting", "paused"].includes(loop.status)
        ? "cancelled"
        : loop.status,
      iterations: loop.iterations.map((iteration) => ({
        ...iteration,
        status: ["running", "waiting", "paused"].includes(iteration.status)
          ? "cancelled"
          : iteration.status,
        nodes: iteration.nodes.map(stoppedStep),
      })),
    })),
  };
}

async function boundedCleanup(work: Promise<unknown>[]): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(work).then((results) =>
        results.every((result) => result.status === "fulfilled"),
      ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 7000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

type StopContext = Omit<EngineDependencies, "localSessions"> & {
  readonly active: Map<string, ActivePlanRun>;
  readonly writes: SerialQueue;
};

/** Ends owned processes and remote work, and waits apart for the dispatching work of this process. */
async function stopCleanup(
  run: AgentPlanRun,
  context: StopContext,
  owner: ActivePlanRun | undefined,
): Promise<{
  readonly isConfirmed: boolean;
  readonly haveExecutionsEnded: boolean;
}> {
  const [isConfirmed, haveExecutionsEnded] = await Promise.all([
    boundedCleanup([
      controlPlanProcesses(run, "stop"),
      context.resources?.controlRun?.(run.id, "stop") ?? Promise.resolve(),
      context.remoteExecution?.stop(run) ?? Promise.resolve(),
      (async () => {
        await context.steps.closeGroups(run.id);
        await context.steps.finishPlanRun?.(run.id, "cancelled");
      })(),
    ]),
    boundedCleanup(owner ? [...owner.executions] : []),
  ]);
  return { isConfirmed, haveExecutionsEnded };
}

/** Ends the business run on the first click; unconfirmed cleanup is a separate, non-blocking fact. */
export async function stopPlanRun(
  id: string,
  context: StopContext,
  journal?: AgentPlanRunJournal,
): Promise<void> {
  let stopped: AgentPlanRun | undefined;
  let owner: ActivePlanRun | undefined;
  await context.writes.run(async () => {
    owner = context.active.get(id);
    const previous = owner?.view ?? (await context.runs.find(id));
    if (!previous) return;
    if (!isActivePlanRun(previous.status) && previous.status !== "cancelled")
      throw new AgentError("plan_run_unavailable");
    stopped = stoppedPlanRun(previous);
    await context.runs.update(stopped, undefined, undefined, journal);
    if (owner) {
      owner.view = stopped;
      context.active.delete(id);
      for (const controller of owner.controllers.values()) controller.abort();
    }
    forgetPlanPauseGate(id);
  });
  if (!stopped) return;
  const run = stopped;
  const cleanup = await stopCleanup(run, context, owner);
  await owner
    ?.releaseDefinition?.()
    .catch((error: unknown) => logCaughtError("AgentPlanStop", error));
  context.resources?.resumeRun(id);
  // Only after the dispatching work ended can no script process still appear.
  const settled = cleanup.haveExecutionsEnded
    ? await settleStoppedScripts(run)
    : run;
  const hasRemotePending = allPlanRunResults(run).some(
    isRemoteCloseoutUnconfirmed,
  );
  if (!cleanup.isConfirmed || !cleanup.haveExecutionsEnded || hasRemotePending)
    await context.runs.update({
      ...settled,
      controlError: "plan_stop_unconfirmed",
    });
  else if (settled !== run) await context.runs.update(settled);
}
