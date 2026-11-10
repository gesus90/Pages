import { isAcpProvider } from "@/definition/AgentConfiguration";
import {
  allPlanRunResults,
  hasUnconfirmedLoopCloseout,
} from "@/definition/AgentPlanLoopResults";
import { isRemoteCloseoutUnconfirmed } from "@/definition/AgentPlanRemoteCloseout";

import { withGroupResults } from "./AgentPlanGroupResults";
import { bindPlanBranchState } from "./branching/AgentPlanBranchPersistence";
import { hasPlanPath } from "./AgentPlanGraph";
import { planReadiness } from "./branching/AgentPlanBranchEdges";
import { planDecisionMode } from "@/definition/AgentPlanDecision";

import type {
  AgentPlanRun,
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { PlanBranchingState } from "./branching/AgentPlanBranchState";
import type { LogContext } from "@/backend/logging/Logger";

/** Live scheduler state; only the engine mutates it under its serial queue. */
export interface ActivePlanRun {
  /** Frozen trigger facts: another run's scheduler pump must not replace this trace. */
  readonly logContext?: LogContext;
  groupCloseout: "open" | "closing" | "closed";
  hasPersistenceFailure: boolean;
  view: AgentPlanRun;
  snapshot: AgentPlanSnapshot;
  readonly dispatched: Set<string>;
  readonly controllers: Map<string, AbortController>;
  /** The nodes of this run that are executing, so a caller can wait for exactly this run. */
  readonly executions: Set<Promise<void>>;
  releaseDefinition?: () => Promise<void>;
  /** A server shutdown, not a person, ended the run; it closes as interrupted and can be resumed. */
  isInterrupted?: boolean;
  /** Decisions, skipped branches and returning events; absent until a plan with them needs it. */
  branching?: PlanBranchingState;
}

/** Updates one result and derives group summaries. */
export function patchStep(
  active: ActivePlanRun,
  id: string,
  changes: Partial<AgentPlanStepResult>,
): void {
  active.view = withGroupResults(
    {
      ...active.view,
      steps: active.view.steps.map((step) =>
        step.id === id ? { ...step, ...changes } : step,
      ),
    },
    active.snapshot,
  );
  bindPlanBranchState(active);
}

/** Stop irreversibly closes the dispatch gate before any abort signal. */
export function requestCancellation(active: ActivePlanRun): void {
  active.view = {
    ...active.view,
    status: "stopping",
    stopRequested: true,
    isWaitingForWorkspace: undefined,
    workspaceWait: undefined,
  };
  for (const step of active.view.steps) {
    if (step.status === "waiting" || step.status === "paused")
      patchStep(active, step.id, {
        status: "cancelled",
        cancellation: "not_started",
        isBlocked: false,
        blockedByStepId: undefined,
        // A paused wait has no running attempt left to cancel its stored deadline.
        ...(step.session?.retry
          ? {
              session: {
                ...step.session,
                retry: {
                  ...step.session.retry,
                  state: "cancelled",
                  nextAttemptAt: null,
                },
              },
            }
          : {}),
      });
    if (step.status === "running")
      patchStep(active, step.id, { cancellation: "requested" });
  }
}

/** Marks dependencies whose required work failed. */
export function updateBlocked(active: ActivePlanRun): void {
  for (const step of active.view.steps) {
    if (step.status !== "waiting" && step.status !== "paused") continue;
    const failedDependency = active.view.steps.find(
      (entry) =>
        (entry.status === "failed" || entry.status === "cancelled") &&
        hasPlanPath(active.snapshot.plan.edges, entry.id, step.id),
    );
    if (failedDependency)
      patchStep(active, step.id, {
        isBlocked: true,
        error: "plan_dependency_failed",
        blockedByStepId: failedDependency.failedStepId ?? failedDependency.id,
      });
  }
}

/**
 * Returns the complete ready frontier, independent of canvas positions.
 *
 * @remarks
 * A boolean decision is no work for a provider: the scheduler evaluates it
 * itself when its value has arrived, so it never appears here. A model
 * decision asks a model in a session of its own and is dispatched like a
 * script (PAGE-286).
 */
export function readySteps(active: ActivePlanRun): readonly AgentPlanNode[] {
  const results = new Map(active.view.steps.map((step) => [step.id, step]));
  return active.snapshot.plan.nodes.filter((node) => {
    const step = results.get(node.id);
    return (
      !(node.type === "decision" && planDecisionMode(node) === "boolean") &&
      step?.status === "waiting" &&
      !step.isBlocked &&
      planReadiness(active.snapshot.plan, results, node.id) === "ready"
    );
  });
}

/** Only running admits work. */
export function canSchedule(active: ActivePlanRun): boolean {
  return (
    !active.view.stopRequested &&
    active.view.status === "running" &&
    !active.view.controlError &&
    !active.hasPersistenceFailure
  );
}

/** Stable pauses keep their live sessions and reservations; an interrupted run leaves pending work waiting. */
export function canFinalize(active: ActivePlanRun): boolean {
  return (
    !active.hasPersistenceFailure &&
    active.controllers.size === 0 &&
    active.groupCloseout === "closed" &&
    (readySteps(active).length === 0 || active.isInterrupted === true) &&
    // A result that still waits to start its target is work, unless the run is not going on.
    ((active.branching?.pending.length ?? 0) === 0 || !canSchedule(active)) &&
    (active.view.status !== "paused" ||
      active.view.stopRequested ||
      active.isInterrupted === true)
  );
}

/** A node a shutdown aborted failed as interrupted; one it never started waits again. */
function interruptedStep(step: AgentPlanStepResult): AgentPlanStepResult {
  if (step.status !== "cancelled" && step.status !== "running") return step;
  if (step.cancellation === "not_started")
    return { ...step, status: "waiting", cancellation: "none", error: null };
  return {
    ...step,
    status: "failed",
    cancellation: "none",
    error: step.script ? "plan_script_interrupted" : "plan_interrupted",
  };
}

/**
 * The end of a run that a server shutdown interrupted.
 *
 * @remarks
 * Unlike an explicit stop, nobody decided to end the run: it is recorded as
 * an interrupted failure that its executor can resume or restart. Nothing
 * runs again by itself.
 */
export function interruptedPlanRun(run: AgentPlanRun): AgentPlanRun {
  return {
    ...run,
    status: "failed",
    isWaitingForWorkspace: undefined,
    workspaceWait: undefined,
    recovery: {
      state: "interrupted",
      requiresReconciliation: true,
      automaticResume: { state: "pending" },
    },
    steps: run.steps.map(interruptedStep),
    ...(run.loops
      ? {
          loops: run.loops.map((loop) => ({
            ...loop,
            iterations: loop.iterations.map((iteration) => ({
              ...iteration,
              nodes: iteration.nodes.map(interruptedStep),
            })),
          })),
        }
      : {}),
  };
}

function detachedStopStep(step: AgentPlanStepResult): AgentPlanStepResult {
  if (step.status === "waiting" || step.status === "paused")
    return {
      ...step,
      status: "cancelled",
      cancellation: "not_started",
      isBlocked: false,
      blockedByStepId: undefined,
    };
  if (step.status !== "running") return step;
  // Only a remote job outlives the process that started it; its runner reports its end.
  if (step.execution?.target.kind === "remote")
    return { ...step, cancellation: "requested" };
  return {
    ...step,
    status: "failed",
    cancellation: "requested",
    error: "plan_interrupted",
  };
}

/**
 * The stop of a run that no engine of this process drives anymore.
 *
 * @remarks
 * Such a run outlived a Pages restart because a remote job still owned
 * work. Nothing schedules it again, so its open nodes end without starting.
 * The run closes as cancelled once no remote job runs; otherwise it stays
 * stopping until the runner reports the end of each targeted attempt.
 */
export function detachedStopRun(run: AgentPlanRun): AgentPlanRun {
  const steps = run.steps.map(detachedStopStep);
  return settleDetachedRun({
    ...run,
    stopRequested: true,
    status: "stopping",
    isWaitingForWorkspace: undefined,
    workspaceWait: undefined,
    steps,
  });
}

/** Whether any step or loop of the run has an unconfirmed or failed closeout. */
export function hasUnconfirmedRunCloseout(run: AgentPlanRun): boolean {
  return (
    hasUnconfirmedLoopCloseout(run) ||
    allPlanRunResults(run).some(
      (step) =>
        isRemoteCloseoutUnconfirmed(step) ||
        step.remote?.closeout === "pending" ||
        step.remote?.closeout === "failed" ||
        step.session?.closeout === "pending" ||
        step.session?.closeout === "failed" ||
        step.script?.closeout === "pending" ||
        step.script?.closeout === "failed",
    )
  );
}

/** A loop is done when it succeeded with every iteration, or when its branch was never taken. */
function isCompletedLoop(
  loop: NonNullable<AgentPlanRun["loops"]>[number],
): boolean {
  return (
    loop.status === "skipped" ||
    (loop.status === "succeeded" &&
      !loop.error &&
      loop.iterations.every(
        (iteration) =>
          iteration.status === "succeeded" &&
          !iteration.error &&
          // A node a decision skipped in this iteration is settled as well (PAGE-286).
          iteration.nodes.every(isCompletedPlanStep),
      ))
  );
}

/** A step that durably succeeded, or whose branch was never taken. */
function isCompletedPlanStep(step: AgentPlanStepResult): boolean {
  return (
    step.status === "skipped" ||
    (step.status === "succeeded" &&
      !step.isBlocked &&
      !step.error &&
      step.session?.resultCode !== -1 &&
      // A boolean result of false is an answer, not an unaccepted node.
      (step.passed === false ||
        !step.session?.acceptance ||
        step.session.acceptance.verdict === "accepted"))
  );
}

/** Whether every step and loop of a run has durably succeeded and confirmed closeout. */
export function isCompletedPlanRun(run: AgentPlanRun): boolean {
  if (run.stopRequested || run.controlError || run.steps.length === 0)
    return false;
  if (hasUnconfirmedRunCloseout(run)) return false;
  // A paused cycle whose only work left is a result on its way back has every node done, yet the run is not.
  if ((run.pauseBoundary?.pendingStepIds.length ?? 0) > 0) return false;
  if (!run.steps.every(isCompletedPlanStep)) return false;
  if (run.loops && !run.loops.every(isCompletedLoop)) return false;
  return true;
}

/** A step that never started because a failed closeout step comes before it. */
function waitsBehindCloseout(
  step: AgentPlanStepResult,
  run: AgentPlanRun,
  closeoutIds: ReadonlySet<string>,
): boolean {
  if (
    (step.status !== "waiting" && step.status !== "paused") ||
    !step.isBlocked
  )
    return false;
  if (step.blockedByStepId !== undefined)
    return closeoutIds.has(step.blockedByStepId);
  // A group summary names no predecessor; its members do.
  const members = run.steps.filter((entry) => entry.groupId === step.id);
  return (
    members.length > 0 &&
    members.every((member) => waitsBehindCloseout(member, run, closeoutIds))
  );
}

/**
 * Whether only steps the plan marks as closeout keep the run from having succeeded.
 *
 * @remarks
 * Every other step completed, or never started because it follows the failed
 * closeout, like the step that moves the ticket after the push. Such a step is
 * no failed work, and a resume starts it for the first time. Unconfirmed
 * process cleanup, an explicit stop and a control error stay what they were.
 *
 * @param run - The view of the run; the roles come from its own results.
 * @returns `false` for every run without a step marked as closeout.
 */
export function isWorkDoneCloseoutOpen(run: AgentPlanRun): boolean {
  if (run.stopRequested || run.controlError || hasUnconfirmedRunCloseout(run))
    return false;
  const failed = run.steps.filter((step) => step.status === "failed");
  if (failed.length === 0 || failed.some((step) => step.role !== "closeout"))
    return false;
  const closeoutIds = new Set(failed.map((step) => step.id));
  const isSettled = (step: AgentPlanStepResult): boolean =>
    closeoutIds.has(step.id) ||
    isCompletedPlanStep(step) ||
    waitsBehindCloseout(step, run, closeoutIds);
  return (
    run.steps.every(isSettled) &&
    (run.loops ?? []).every(
      (loop) =>
        isCompletedLoop(loop) ||
        run.steps.some(
          (step) =>
            step.id === loop.id && waitsBehindCloseout(step, run, closeoutIds),
        ),
    )
  );
}

/**
 * Closes a run that no engine drives once none of its steps runs anymore.
 *
 * @remarks
 * Such a run outlived a Pages restart because a remote job still owned work.
 * An explicit stop ends it as cancelled. A shutdown or crash ends it the way
 * the engine ends an interrupted run, so its executor can resume or restart
 * it; nothing starts again by itself. A pausing run and a run with a running
 * step are returned unchanged.
 *
 * @param run - The stored run.
 * @returns The settled run, or `run` itself when nothing changes.
 */
export function settleDetachedRun(run: AgentPlanRun): AgentPlanRun {
  if (run.steps.some((step) => step.status === "running")) return run;
  if (run.status === "stopping" && run.stopRequested)
    return endedPlanRun(
      run,
      hasUnconfirmedRunCloseout(run) ? "failed" : "cancelled",
    );
  if (
    (run.status === "running" || run.status === "pausing") &&
    isCompletedPlanRun(run)
  )
    return {
      ...endedPlanRun(run, "succeeded"),
      recovery: undefined,
    };
  if (
    (run.status === "running" || run.status === "pausing") &&
    isWorkDoneCloseoutOpen(run)
  )
    return {
      ...endedPlanRun(run, "work_done_closeout_open"),
      recovery: undefined,
    };
  if (run.status === "stopping" || run.status === "running")
    return interruptedPlanRun(endedPlanRun(run, "failed"));
  return run;
}

/**
 * Direct scripts and request agents share the existing two execution slots; ACP has its own admission.
 *
 * @remarks
 * Remote steps run on their runner host, which admits and queues them with a
 * visible reason. Holding Pages slots for them let two long remote runs keep
 * every other remote run waiting without any reason.
 */
export function isRequestStep(active: ActivePlanRun, id: string): boolean {
  if (active.snapshot.remoteSteps?.some((entry) => entry.step.id === id))
    return false;
  const step = active.snapshot.steps.find((entry) => entry.step.id === id);
  return (
    (step !== undefined && !isAcpProvider(step.provider)) ||
    active.snapshot.plan.nodes.some(
      (node) =>
        node.id === id &&
        (node.type === "script" || node.type === "git_closeout"),
    )
  );
}

/** Requests and direct scripts share the existing limit independently of ACP capacity. */
export function countRunningPlanRequests(
  runs: Iterable<ActivePlanRun>,
): number {
  return [...runs].reduce(
    (count, active) =>
      count +
      [...active.controllers.keys()].filter((id) => isRequestStep(active, id))
        .length,
    0,
  );
}

/** Settles pause only when every branch is quiet, preserving failures and real completion. */
export function settlePlanPause(active: ActivePlanRun): void {
  if (active.view.status !== "pausing" || active.controllers.size !== 0) return;
  const pending = active.view.steps.filter((step) => step.status === "paused");
  // A result on its way back to an agent is work that waits, though no node is paused for it.
  const returning = [
    ...new Set(active.branching?.pending.map((event) => event.targetId)),
  ];
  const hasFailure = active.view.steps.some(
    (step) => step.status === "failed" || step.isBlocked,
  );
  if (
    hasFailure ||
    active.view.controlError ||
    (pending.length === 0 && returning.length === 0)
  )
    return;
  const completed = active.view.steps
    .filter((step) => step.status === "succeeded")
    .map((step) => step.id);
  const results = new Map(active.view.steps.map((step) => [step.id, step]));
  const frontier = [
    ...active.snapshot.plan.nodes
      .filter(
        (node) =>
          pending.some((step) => step.id === node.id) &&
          planReadiness(active.snapshot.plan, results, node.id) === "ready",
      )
      .map((node) => node.id),
    ...returning,
  ];
  if (frontier.length === 0) return;
  active.view = withGroupResults(
    {
      ...active.view,
      status: "paused",
      isWaitingForWorkspace: undefined,
      workspaceWait: undefined,
      pauseBoundary: {
        pausedAt: new Date().toISOString(),
        completedStepIds: completed,
        pendingStepIds: [
          ...pending.map((step) => step.id),
          ...returning.filter((id) => !pending.some((step) => step.id === id)),
        ],
        frontierStepIds: frontier,
      },
    },
    active.snapshot,
  );
}

/** Unconfirmed closeout is a failure even when Stop was accepted. */
export function finalPlanStatus(
  active: ActivePlanRun,
  hasFailure: boolean,
): AgentPlanRun["status"] {
  if (hasUnconfirmedCloseout(active)) return "failed";
  if (active.view.stopRequested) return "cancelled";
  if (isWorkDoneCloseoutOpen(active.view)) return "work_done_closeout_open";
  return hasFailure || active.view.controlError ? "failed" : "succeeded";
}

/** Failed session cleanup keeps the run's definitions and working copies reserved. */
export function hasUnconfirmedCloseout(active: ActivePlanRun): boolean {
  return hasUnconfirmedRunCloseout(active.view);
}

/** Stamps the actual terminal decision without estimating an older run's end. */
export function endedPlanRun(
  run: AgentPlanRun,
  status: AgentPlanRun["status"],
): AgentPlanRun {
  return {
    ...run,
    status,
    endedAt: run.endedAt ?? new Date().toISOString(),
    isWaitingForWorkspace: undefined,
    workspaceWait: undefined,
  };
}
