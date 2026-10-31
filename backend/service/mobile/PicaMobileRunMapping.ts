import type {
  AgentPlanActiveRun,
  AgentPlanActiveStep,
} from "@/backend/service/agents/AgentPlanActiveRuns";
import type {
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type {
  PicaMobileDashboardRun,
  PicaMobileDashboardStage,
  PicaMobileDashboardStep,
  PicaMobileRunStatus,
  PicaMobileStepStatus,
} from "@/definition/PicaMobileProtocol";

const RUN_STATUS: Readonly<Record<AgentPlanRun["status"], PicaMobileRunStatus>> =
  {
    running: "running",
    pausing: "pausing",
    paused: "paused",
    stopping: "stopping",
    succeeded: "completed",
    failed: "failed",
    cancelled: "cancelled",
  };

const STEP_STATUS: Readonly<
  Record<AgentPlanStepResult["status"], PicaMobileStepStatus>
> = {
  waiting: "waiting",
  running: "running",
  paused: "paused",
  succeeded: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

function toStepStatus(step: AgentPlanStepResult): PicaMobileStepStatus {
  // A blocked step waits behind a failed or cancelled predecessor.
  return step.isBlocked ? "blocked" : STEP_STATUS[step.status];
}

function toStage(
  planned: readonly AgentPlanActiveStep[],
  results: ReadonlyMap<string, AgentPlanStepResult>,
): PicaMobileDashboardStage | null {
  const present = planned.flatMap((step) => {
    const result = results.get(step.id);

    return result === undefined ? [] : [{ step, result }];
  });
  const [first] = present;

  if (first === undefined) {
    return null;
  }

  return {
    id: `stage-${first.step.id}`,
    kind: stageKind(present.length, first.step.isLoop),
    steps: present.map(
      ({ step, result }): PicaMobileDashboardStep => ({
        id: step.id,
        number: step.number,
        name: result.name,
        status: toStepStatus(result),
      }),
    ),
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
 * never reports one.
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
