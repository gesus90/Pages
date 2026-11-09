import type {
  AgentPlanActiveRun,
  AgentPlanActiveStep,
} from "@/backend/service/agents/AgentPlanActiveRuns";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { PicaMobileNotificationRunStatus } from "@/definition/PicaMobileNotifications";
import type {
  PicaMobileDashboardRun,
  PicaMobileDashboardStage,
  PicaMobileDashboardStep,
  PicaMobileFlowStatus,
  PicaMobileRunStatus,
  PicaMobileStepStatus,
} from "@/definition/PicaMobileProtocol";

const RUN_STATUS: Readonly<
  Record<AgentPlanRun["status"], Exclude<PicaMobileRunStatus, "blocked">>
> = {
  running: "running",
  pausing: "pausing",
  paused: "paused",
  stopping: "stopping",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
  // Pica Mobile refuses a whole answer with a state it does not know; the error code names this one.
  work_done_closeout_open: "failed",
};

/**
 * Names a Pages run state the way the protocol does.
 *
 * @param status - The stored state of the run.
 * @returns The protocol state; Pages has no `blocked` run, so it never returns it.
 */
export function toPicaMobileRunStatus(
  status: AgentPlanRun["status"],
): Exclude<PicaMobileRunStatus, "blocked"> {
  return RUN_STATUS[status];
}

/**
 * Names a Pages run state the way a notification does.
 *
 * @param status - The stored state of the run.
 * @returns The state itself, or `failed` for the one state Pica Mobile does not know.
 */
export function toPicaMobileNotificationRunStatus(
  status: AgentPlanRun["status"],
): PicaMobileNotificationRunStatus {
  return status === "work_done_closeout_open" ? "failed" : status;
}

const STEP_STATUS: Readonly<
  Record<
    Exclude<AgentPlanStepResult["status"], "skipped">,
    PicaMobileStepStatus
  >
> = {
  waiting: "waiting",
  running: "running",
  paused: "paused",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

function toStepStatus(
  step: AgentPlanStepResult & {
    readonly status: Exclude<AgentPlanStepResult["status"], "skipped">;
  },
): PicaMobileStepStatus {
  // A blocked step waits behind a failed or cancelled predecessor.
  return step.isBlocked ? "blocked" : STEP_STATUS[step.status];
}

/**
 * Names the state of a node the way `plans.flow.v1` does.
 *
 * @param result - The state of a node, a loop iteration or a node in it.
 * @returns `skipped` for a node on a branch a decision did not take,
 * `blocked` for one waiting behind a failed or cancelled predecessor, and
 * otherwise the state of `plans.v1`.
 */
export function toPicaMobileFlowStatus(
  result: Pick<AgentPlanStepResult, "status"> & {
    readonly isBlocked?: boolean;
  },
): PicaMobileFlowStatus {
  if (result.status === "skipped") return "skipped";

  return result.isBlocked === true ? "blocked" : STEP_STATUS[result.status];
}

function toStage(
  planned: readonly AgentPlanActiveStep[],
  results: ReadonlyMap<string, AgentPlanStepResult>,
): PicaMobileDashboardStage | null {
  // A node on a branch a decision did not take never ran; the protocol has no state for it.
  const present = planned.flatMap((step) => {
    const result = results.get(step.id);

    if (result === undefined || result.status === "skipped") return [];
    return [{ step, result: { ...result, status: result.status } }];
  });
  const [first] = present;

  if (first === undefined) {
    return null;
  }

  return {
    id: `stage-${first.step.id}`,
    kind: stageKind(present.length, first.step.isLoop),
    steps: present.map(({ step, result }): PicaMobileDashboardStep => ({
      id: step.id,
      number: step.number,
      name: result.name,
      status: toStepStatus(result),
    })),
  };
}

function toStages(entry: AgentPlanActiveRun): PicaMobileDashboardStage[] {
  const results = new Map(entry.run.steps.map((step) => [step.id, step]));

  return entry.stages.flatMap((planned) => {
    const stage = toStage(planned, results);

    return stage === null ? [] : [stage];
  });
}

function stageKind(
  stepCount: number,
  isLoop: boolean,
): PicaMobileDashboardStage["kind"] {
  if (stepCount > 1) {
    return "parallel";
  }

  return isLoop ? "loop" : "step";
}

/** The one ticket every step of the run works on; none when the run has no ticket or several. */
function singleTicketKey(run: AgentPlanRun): string | undefined {
  const keys = new Set(
    run.steps.flatMap(
      (step) => step.progress?.tickets?.map((ticket) => ticket.key) ?? [],
    ),
  );
  const [only] = keys;

  return keys.size === 1 ? only : undefined;
}

/**
 * Maps an active run of the signed-in account onto the dashboard contract.
 *
 * @param entry - The authorized run with the structure of its executed revision.
 * @returns Names, numbers and states only; results, sessions, prompts, agent
 * parameters and paths of the run never enter the mapping.
 *
 * @remarks
 * A stage holds the steps on the same step of the flow; several make it
 * `parallel`, and a lone loop node makes it `loop` with the loop as its one
 * step. Start and End are no steps. Pages has no run state `blocked`, so it
 * never reports one. The complete structure, Start, End, decisions,
 * skipped nodes and loop iterations included, is the opt-in `flow` of
 * `plans.flow.v1`; `stages` keeps its form for every older client.
 */
export function toDashboardRun(
  entry: AgentPlanActiveRun,
): PicaMobileDashboardRun {
  const ticket = singleTicketKey(entry.run);

  return {
    id: entry.run.id,
    planId: entry.run.planId,
    name: entry.run.planName,
    ...(ticket === undefined ? {} : { ticket }),
    startedByAccountId: entry.run.userId,
    status: RUN_STATUS[entry.run.status],
    canResume: entry.canResume,
    stages: toStages(entry),
  };
}
