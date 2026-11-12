import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type {
  AgentPlanRecoveryOption,
  AgentPlanRecoveryResult,
} from "@/definition/AgentPlanRecovery";

/**
 * What the plan service asks of the recovery for a run that ended unfinished.
 *
 * @remarks
 * The recovery needs the plan service to read runs, and the plan service needs
 * the recovery to continue and stop them. The slot closes that circle once at
 * composition, so both sides keep one-way imports.
 */
export interface AgentPlanResumeAdvisor {
  /** Whether the run can be continued now, and the one reason when it cannot. */
  readonly resumeAvailability: (
    userId: string,
    runId: string,
  ) => Promise<AgentPlanRecoveryOption>;
  /** Continues the run as a new linked run at its last safe state. */
  readonly resumeEnded: (
    userId: string,
    runId: string,
    planRevision: number,
    journal?: AgentPlanRunJournal,
  ) => Promise<AgentPlanRecoveryResult>;
  /** Ends the run's own processes and settles its record as stopped. */
  readonly stopRun: (
    userId: string,
    runId: string,
    journal?: AgentPlanRunJournal,
  ) => Promise<void>;
}

/** Set once by the composition; absent, a run that ended cannot be continued or settled by Stop. */
export interface AgentPlanResumeAdvisorSlot {
  current: AgentPlanResumeAdvisor | null;
}
