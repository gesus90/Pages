import type { AgentParameterValue } from "./AgentParameters";
import type {
  AgentPlanEntryInput,
  AgentPlanEntryReturn,
  AgentPlanHandoverState,
  AgentPlanInvocationState,
  AgentPlanJumpWait,
  AgentPlanJumpWorkspace,
} from "./AgentPlanJump";

/** The interface of the target entry as it was when the call was made; later edits never change it. */
export interface AgentPlanInvocationInterface {
  readonly inputs: readonly AgentPlanEntryInput[];
  readonly returns: readonly AgentPlanEntryReturn[];
}

/** What a decided call hands back to its caller: named values, never a snapshot. */
export interface AgentPlanInvocationOutcome {
  readonly values: Readonly<Record<string, AgentParameterValue>>;
}

/** Whether the run of the target was created, is still due or will never be created. */
export type AgentPlanInvocationStart = "pending" | "started" | "cancelled";

/** One call of the register. */
export interface AgentPlanInvocationRecord {
  readonly id: string;
  readonly sourcePlanId: string;
  readonly sourceRunId: string;
  readonly sourceNodeId: string;
  readonly activation: number;
  readonly iteration: number | null;
  readonly activationKey: string;
  /** The account that executes the call: the executor of the calling run. */
  readonly userId: string;
  readonly targetPlanId: string;
  readonly targetRevision: number;
  readonly entryNodeId: string;
  readonly targetRunId: string | null;
  readonly targetStatus: string | null;
  readonly inputs: Readonly<Record<string, AgentParameterValue>>;
  readonly contract: AgentPlanInvocationInterface;
  readonly wait: AgentPlanJumpWait;
  readonly signalName: string | null;
  readonly workspace: AgentPlanJumpWorkspace;
  readonly handover: AgentPlanHandoverState;
  readonly handoverKeys: readonly string[];
  readonly start: AgentPlanInvocationStart;
  /** The target no longer belongs to the caller: stopping the caller leaves it alone. */
  readonly isDetached: boolean;
  readonly deadlineAt: string | null;
  readonly state: AgentPlanInvocationState;
  readonly failureReason: string | null;
  readonly outcome: AgentPlanInvocationOutcome | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/** What a new call is made of. */
export type NewAgentPlanInvocation = Pick<
  AgentPlanInvocationRecord,
  | "id"
  | "sourcePlanId"
  | "sourceRunId"
  | "sourceNodeId"
  | "activation"
  | "iteration"
  | "activationKey"
  | "userId"
  | "targetPlanId"
  | "targetRevision"
  | "entryNodeId"
  | "inputs"
  | "contract"
  | "wait"
  | "signalName"
  | "workspace"
  | "deadlineAt"
>;

/** How a call is decided. */
export interface AgentPlanInvocationDecision {
  readonly state: Extract<
    AgentPlanInvocationState,
    "succeeded" | "failed" | "timed_out" | "cancelled" | "signalled"
  >;
  readonly reason: string | null;
  readonly outcome: AgentPlanInvocationOutcome | null;
}

/** An accepted signal of a call. */
export interface AgentPlanInvocationSignal {
  readonly name: string;
  readonly payload: AgentParameterValue | null;
  readonly acceptedAt: string;
}
