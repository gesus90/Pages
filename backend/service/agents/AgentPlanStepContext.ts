import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
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
  /** Judges the result of one attempt beyond its own acceptance, so a failed gate can be repaired in the step. */
  readonly settle?: (
    result: Partial<AgentPlanStepResult>,
  ) => Promise<Partial<AgentPlanStepResult>>;
  /** Persists the newest record of the node; never throws. */
  readonly save: (session: AgentPlanSessionRecord) => Promise<void>;
  /** The iteration of a loop member, which decides how its session is named and kept. */
  readonly iteration?: number;
  /** Set when results of other nodes started this node again through its event input. */
  readonly event?: StepEventStart;
}

/** The event that started a node again: the prompt to hand to its session and where it came from. */
export interface StepEventStart {
  readonly prompt: string;
  /** Which start of the node this is, from 2. */
  readonly activation: number;
  readonly sourceStepIds: readonly string[];
}

/** One node from its start to its result; `record` always holds the newest state. */
export interface NodeRun {
  readonly run: AgentPlanRun;
  snapshot: AgentPlanSnapshot;
  step: AgentPlanStepSnapshot;
  control: StepRunControl;
  record: AgentPlanSessionRecord | null;
  hasStarted: boolean;
  /** Corrective TODO turns in this iteration, retained after pause or reattachment. */
  todoReturns?: number;
  retry: AgentPlanRetry | null;
  /** The native session this retry continues, or `null` for a fresh one. */
  retryResumeSessionId: string | null;
  /** Counts from 1 for the first attempt of the current retry sequence. */
  retryAttemptNumber: number;
  /** The shared session position to continue when this retry resumes one. */
  retryGroup: { readonly creatorStepId: string; readonly turn: number } | null;
  /** The loop and iteration of a loop member. */
  readonly loop: LoopSessionTerms | null;
  /** The session container of the node: its group, the loop's session of its agent, or its own session when it receives events. */
  readonly sessionGroup: string | undefined;
  /** The event that started this node again; `null` for a regular start. */
  readonly event: StepEventStart | null;
  /** How this start relates to the node's session once the runner knows whether it is open. */
  eventMode: "continued" | "recovered" | null;
  /** Whether another node can send an event to this agent, which keeps its session open. */
  readonly receivesEvents: boolean;
  /** Whether a decision reads the boolean result of this agent. */
  readonly reportsPassed: boolean;
}
