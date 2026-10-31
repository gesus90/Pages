import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanRetry } from "@/definition/AgentPlanRetry";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { PlanInstructionWork } from "./AgentPlanInstructionControl";
import type { LoopSessionTerms } from "./loop/AgentPlanLoopSession";
import type {
  AgentPlanSnapshot,
  AgentPlanStepSnapshot,
} from "./AgentPlanSnapshot";

/** How a running node reports its record and learns about a stop. */
export interface StepRunControl {
  readonly signal: AbortSignal;
  /** Claims dispatch only while the engine gate remains open. */
  readonly claimStart?: () => void;
  /** Explicitly identifies preparation/admission work that has not dispatched yet. */
  readonly awaitDispatch?: () => void;
  /** Keeps additional console turns inside the engine drain and stop boundary. */
  readonly runInstruction?: (
    work: PlanInstructionWork,
  ) => Promise<PlanSessionTurn>;
  /** Persists the newest record of the node; never throws. */
  readonly save: (session: AgentPlanSessionRecord) => Promise<void>;
  /** The iteration of a loop member, which decides how its session is named and kept. */
  readonly iteration?: number;
}

/** One node from its start to its result; `record` always holds the newest state. */
export interface NodeRun {
  readonly run: AgentPlanRun;
  snapshot: AgentPlanSnapshot;
  step: AgentPlanStepSnapshot;
  control: StepRunControl;
  record: AgentPlanSessionRecord | null;
  hasStarted: boolean;
  retry: AgentPlanRetry | null;
  /** The native session this retry continues, or `null` for a fresh one. */
  retryResumeSessionId: string | null;
  /** Counts from 1 for the first attempt of the current retry sequence. */
  retryAttemptNumber: number;
  /** The shared session position to continue when this retry resumes one. */
  retryGroup: { readonly creatorStepId: string; readonly turn: number } | null;
  /** The loop and iteration of a loop member. */
  readonly loop: LoopSessionTerms | null;
  /** The session container of the node: its group, or the loop's session of its agent. */
  readonly sessionGroup: string | undefined;
}
