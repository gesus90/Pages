import { AgentError } from "@/backend/error/AgentErrors";
import {
  isActivePlanRun,
  isResumablePlanRunEnd,
} from "@/definition/AgentPlanRunState";

import { resumeRefusal } from "./AgentPlanResumeBlocks";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { AgentPlanResumeAdvisorSlot } from "./AgentPlanResumeAdvisor";
import type { PlanRunEnginePort } from "./runs/PlanRunEnginePort";

/** How long Starten waits for the open run it ended to close. */
const OPEN_RUN_POLLS = 40;
const OPEN_RUN_POLL_MILLISECONDS = 500;

/** The parts of the plan service that Fortsetzen, Stop and Starten on an open run need. */
export interface EndedRunPorts {
  readonly advisor: AgentPlanResumeAdvisorSlot | undefined;
  readonly engine: Pick<PlanRunEnginePort, "isActive">;
  readonly findRun: (id: string) => Promise<AgentPlanRun | null>;
  readonly readRun: (userId: string, id: string) => Promise<AgentPlanRun>;
  readonly control: (
    userId: string,
    planId: string,
  ) => Promise<AgentPlanControl>;
  /** Waits; replaced in a stand-in run so ending an open run needs no real time. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
}

function realSleep(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Continues, stops and replaces a run that is not finished, whatever state it is in.
 *
 * @remarks
 * The plan service keeps the paused and running paths; this class adds the
 * runs that ended unfinished and the runs a stop cannot close by itself. The
 * recovery does the technical work; this class only decides which way a
 * request takes and what it refuses with.
 */
export class AgentPlanEndedRuns {
  private readonly ports: EndedRunPorts;

  public constructor(ports: EndedRunPorts) {
    this.ports = ports;
  }

  /**
   * Continues a run that ended unfinished as a new linked run at its last safe state.
   *
   * @param userId - The executor of the run.
   * @param run - The ended run.
   * @param plan - The plan with the saved revision the continuation adopts.
   * @param journal - Records the caller's command with the new run.
   * @returns The new run.
   * @throws {AgentError} The reason of the control when the run cannot be continued now.
   *
   * @remarks
   * The control of the plan decides first, so a refusal names the same reason
   * the interface shows. Finished steps are taken over and never run again.
   */
  public async resume(
    userId: string,
    run: AgentPlanRun,
    plan: AgentPlanView,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    const advisor = this.ports.advisor?.current;
    if (!advisor) throw new AgentError("plan_run_unavailable");
    const control = await this.ports.control(userId, run.planId);
    if (control.runId !== run.id || !control.canResume)
      throw resumeRefusal(control);
    const result = await advisor.resumeEnded(
      userId,
      run.id,
      plan.revision,
      journal,
    );
    if (!result.runId) throw new AgentError("plan_run_unavailable");
    return this.ports.readRun(userId, result.runId);
  }

  /**
   * Settles a run that ended at a failure as stopped.
   *
   * @returns Whether the run was such a run; the caller stops every other run itself.
   */
  public async settleEnded(
    userId: string,
    run: AgentPlanRun,
    journal?: AgentPlanRunJournal,
  ): Promise<boolean> {
    const advisor = this.ports.advisor?.current;
    if (!advisor || !isResumablePlanRunEnd(run.status)) return false;
    await advisor.stopRun(userId, run.id, journal);
    return true;
  }

  /**
   * Ends the own processes of a run whose stop is stuck or that no engine drives anymore.
   *
   * @remarks
   * The first Stop is graceful. A second one, on a run that still stops, or one
   * on a run nobody drives, ends the processes by force.
   */
  public async forceStuck(userId: string, run: AgentPlanRun): Promise<void> {
    const advisor = this.ports.advisor?.current;
    if (!advisor) return;
    if (
      run.status === "stopping" ||
      (await this.ports.engine.isActive(run.id)) === false
    )
      await advisor.stopRun(userId, run.id);
  }

  /**
   * Ends the open run of a plan so a new run can start.
   *
   * @param userId - The executor of the run.
   * @param runId - The open run.
   * @param stop - The graceful stop of the plan service.
   * @throws {AgentError} `plan_running` when the run does not close in time.
   */
  public async endOpenRun(
    userId: string,
    runId: string,
    stop: () => Promise<unknown>,
  ): Promise<void> {
    await stop();
    await this.ports.advisor?.current?.stopRun(userId, runId);
    const sleep = this.ports.sleep ?? realSleep;
    for (let attempt = 0; attempt < OPEN_RUN_POLLS; attempt += 1) {
      const run = await this.ports.findRun(runId);
      if (!run || !isActivePlanRun(run.status)) return;
      await sleep(OPEN_RUN_POLL_MILLISECONDS);
    }
    throw new AgentError("plan_running");
  }
}
