import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import {
  planFlowSequence,
  planFlowStages,
} from "@/definition/AgentPlanSequence";

import { isPlanHistoryReadFailure } from "./AgentPlanControlAccess";
import { readAuthorizedPlanRun } from "./AgentPlanRunReader";
import { readPlanSnapshot } from "./AgentPlanSnapshot";

import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanService, PlanDependencies } from "./AgentPlanService";

/** A step of the executed revision, numbered the way the plan numbers its flow. */
export interface AgentPlanActiveStep {
  readonly id: string;
  /** Position in the flow; Start is number one, so the first step is number two. */
  readonly number: number;
  readonly isLoop: boolean;
}

/**
 * A run of one person together with the structure of the plan revision it
 * executes; {@link AgentPlanActiveRunService} lists only unfinished ones.
 *
 * @remarks
 * The structure comes from the private snapshot of the run, never from the
 * plan as it is saved now, so editing the plan while the run is active
 * changes nothing here. Only node identifiers, numbers and kinds leave the snapshot.
 */
export interface AgentPlanActiveRun {
  /** The authorized view of the run; the person may read it right now. */
  readonly run: AgentPlanRun;
  /**
   * The steps grouped by their step along the flow edges, nearest to Start first;
   * steps of one group run side by side. Start and End are not steps.
   */
  readonly stages: readonly (readonly AgentPlanActiveStep[])[];
  /** Whether the person may resume the run right now; `false` unless confirmed. */
  readonly canResume: boolean;
}

/**
 * Groups the steps of a plan revision by their step along the flow.
 *
 * @param plan - The revision a run executes, read from its snapshot.
 * @returns The groups nearest to Start first; Start, End and decisions are no
 * steps. It serves active and ended runs alike.
 */
export function activeStages(
  plan: AgentPlan,
): readonly (readonly AgentPlanActiveStep[])[] {
  const numbers = new Map(
    planFlowSequence(plan).order.map((id, index) => [id, index + 1]),
  );
  const nodes = new Map(plan.nodes.map((node) => [node.id, node]));
  return planFlowStages(plan)
    .map((ids) =>
      ids.flatMap((id): AgentPlanActiveStep[] => {
        const node = nodes.get(id);
        const number = numbers.get(id);
        if (
          node === undefined ||
          number === undefined ||
          node.type === "start" ||
          node.type === "end" ||
          // A decision only reads a result and a stack only hands over an entry; neither is work a person waits for.
          node.type === "decision" ||
          node.type === "stack"
        )
          return [];
        return [{ id, number, isLoop: node.type === "loop" }];
      }),
    )
    .filter((stage) => stage.length > 0);
}

async function readCanResume(
  run: AgentPlanRun,
  readControl: (planId: string) => Promise<AgentPlanControl>,
): Promise<boolean> {
  if (run.status !== "paused") return false;
  try {
    const control = await readControl(run.planId);
    return control.runId === run.id && control.canResume;
  } catch (error: unknown) {
    if (isPlanHistoryReadFailure(error)) return false;
    throw error;
  }
}

async function readActiveRun(
  dependencies: PlanDependencies,
  userId: string,
  run: AgentPlanRun,
  readControl: (planId: string) => Promise<AgentPlanControl>,
): Promise<AgentPlanActiveRun | null> {
  let authorized: AgentPlanRun;
  try {
    authorized = await readAuthorizedPlanRun(dependencies, userId, run.id);
  } catch (error: unknown) {
    // A person who lost the right to what the run used no longer sees it.
    if (isPlanHistoryReadFailure(error)) return null;
    throw error;
  }
  if (!isActivePlanRun(authorized.status)) return null;
  return describePlanRun(dependencies, authorized, readControl);
}

/**
 * Adds the structure of the executed revision and the resume right to a run.
 *
 * @param dependencies - Reads the private snapshot of the run.
 * @param run - The authorized view of the run, active or ended.
 * @param readControl - Reads the current control state of a plan; asked only
 * for a paused run.
 * @returns The run with its stages; only node identifiers, numbers and kinds
 * leave the snapshot.
 */
export async function describePlanRun(
  dependencies: Pick<PlanDependencies, "runs">,
  run: AgentPlanRun,
  readControl: (planId: string) => Promise<AgentPlanControl>,
): Promise<AgentPlanActiveRun> {
  const { plan } = readPlanSnapshot(await dependencies.runs.snapshot(run.id));
  return {
    run,
    stages: activeStages(plan),
    canResume: await readCanResume(run, readControl),
  };
}

/**
 * Lists the unfinished runs a person started, with the structure each executes.
 *
 * @remarks
 * Every run is read through the same checks as opening it on the plan page,
 * so it appears only while the person may still read everything it used.
 * Runs of others never appear, whatever a plan shares with the person.
 */
export class AgentPlanActiveRunService {
  private readonly dependencies: PlanDependencies;
  private readonly plans: Pick<AgentPlanService, "control">;

  /**
   * Creates the service.
   *
   * @param dependencies - Run storage and the checks every read of a run needs.
   * @param plans - Reads the current control state of a plan.
   */
  public constructor(
    dependencies: PlanDependencies,
    plans: Pick<AgentPlanService, "control">,
  ) {
    this.dependencies = dependencies;
    this.plans = plans;
  }

  /**
   * Lists the unfinished runs a person started, newest first.
   *
   * @param userId - The executor; runs of others are never part of it.
   * @returns The runs the person may read right now; a run whose plan or
   * resources the person lost access to is left out.
   */
  public async list(userId: string): Promise<readonly AgentPlanActiveRun[]> {
    const active: AgentPlanActiveRun[] = [];
    for (const run of await this.dependencies.runs.active(userId)) {
      const entry = await readActiveRun(
        this.dependencies,
        userId,
        run,
        (planId) => this.plans.control(userId, planId),
      );
      if (entry !== null) active.push(entry);
    }
    return active;
  }
}
