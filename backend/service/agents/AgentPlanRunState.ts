import { isAcpProvider } from "@/definition/AgentConfiguration";

import { withGroupResults } from "./AgentPlanGroupResults";
import { hasPlanPath } from "./AgentPlanGraph";

import type {
  AgentPlanRun,
  AgentPlanNode,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";

/** Live scheduler state; only the engine mutates it under its serial queue. */
export interface ActivePlanRun {
  groupCloseout: "open" | "closing" | "closed";
  hasPersistenceFailure: boolean;
  view: AgentPlanRun;
  snapshot: AgentPlanSnapshot;
  readonly dispatched: Set<string>;
  readonly controllers: Map<string, AbortController>;
  /** The nodes of this run that are executing, so a caller can wait for exactly this run. */
  readonly executions: Set<Promise<void>>;
  releaseDefinition?: () => Promise<void>;
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
}

/** Stop irreversibly closes the dispatch gate before any abort signal. */
export function requestCancellation(active: ActivePlanRun): void {
  active.view = { ...active.view, status: "stopping", stopRequested: true };
  for (const step of active.view.steps) {
    if (step.status === "waiting" || step.status === "paused")
      patchStep(active, step.id, {
        status: "cancelled",
        cancellation: "not_started",
        isBlocked: false,
      });
    if (step.status === "running")
      patchStep(active, step.id, { cancellation: "requested" });
  }
}

/** Marks dependencies whose required work failed. */
export function updateBlocked(active: ActivePlanRun): void {
  for (const step of active.view.steps) {
    if (step.status !== "waiting" && step.status !== "paused") continue;
    const hasFailedDependency = active.view.steps.some(
      (entry) =>
        (entry.status === "failed" || entry.status === "cancelled") &&
        hasPlanPath(active.snapshot.plan.edges, entry.id, step.id),
    );
    if (hasFailedDependency)
      patchStep(active, step.id, {
        isBlocked: true,
        error: "plan_dependency_failed",
      });
  }
}

/** Returns the complete ready frontier, independent of canvas positions. */
export function readySteps(active: ActivePlanRun): readonly AgentPlanNode[] {
  return active.snapshot.plan.nodes.filter((node) => {
    const step = active.view.steps.find((entry) => entry.id === node.id);
    return (
      step?.status === "waiting" &&
      !step.isBlocked &&
      active.snapshot.plan.edges
        .filter((edge) => edge.to === step.id)
        .every(
          (edge) =>
            active.view.steps.find((entry) => entry.id === edge.from)
              ?.status === "succeeded",
        )
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

/** Stable pauses keep their live sessions and reservations. */
export function canFinalize(active: ActivePlanRun): boolean {
  return (
    !active.hasPersistenceFailure &&
    active.controllers.size === 0 &&
    active.groupCloseout === "closed" &&
    readySteps(active).length === 0 &&
    (active.view.status !== "paused" || active.view.stopRequested)
  );
}

/** ACP capacity is separately managed. */
export function isAcpStep(active: ActivePlanRun, id: string): boolean {
  const step = active.snapshot.steps.find((entry) => entry.step.id === id);
  return step !== undefined && isAcpProvider(step.provider);
}

/** API requests retain their existing concurrency limit independently of ACP capacity. */
export function countRunningPlanRequests(
  runs: Iterable<ActivePlanRun>,
): number {
  return [...runs].reduce(
    (count, active) =>
      count +
      [...active.controllers.keys()].filter((id) => !isAcpStep(active, id))
        .length,
    0,
  );
}

/** Settles pause only when every branch is quiet, preserving failures and real completion. */
export function settlePlanPause(active: ActivePlanRun): void {
  if (active.view.status !== "pausing" || active.controllers.size !== 0) return;
  const pending = active.view.steps.filter((step) => step.status === "paused");
  const hasFailure = active.view.steps.some(
    (step) => step.status === "failed" || step.isBlocked,
  );
  if (hasFailure || active.view.controlError || pending.length === 0) return;
  const completed = active.view.steps
    .filter((step) => step.status === "succeeded")
    .map((step) => step.id);
  const frontier = active.snapshot.plan.nodes
    .filter(
      (node) =>
        pending.some((step) => step.id === node.id) &&
        active.snapshot.plan.edges
          .filter((edge) => edge.to === node.id)
          .every((edge) => completed.includes(edge.from)),
    )
    .map((node) => node.id);
  if (frontier.length === 0) return;
  active.view = withGroupResults(
    {
      ...active.view,
      status: "paused",
      pauseBoundary: {
        pausedAt: new Date().toISOString(),
        completedStepIds: completed,
        pendingStepIds: pending.map((step) => step.id),
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
  return hasFailure || active.view.controlError ? "failed" : "succeeded";
}

/** Failed session cleanup keeps the run's definitions and working copies reserved. */
export function hasUnconfirmedCloseout(active: ActivePlanRun): boolean {
  return active.view.steps.some((step) => step.session?.closeout === "failed");
}

/** Stamps the actual terminal decision without estimating an older run's end. */
export function endedPlanRun(
  run: AgentPlanRun,
  status: AgentPlanRun["status"],
): AgentPlanRun {
  return { ...run, status, endedAt: new Date().toISOString() };
}
