import { readAgentObject } from "@/backend/agents/AgentPayload";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";
import { isAcpProvider } from "@/definition/AgentConfiguration";
import type { RemotePlanStep } from "./AgentPlanRemoteExecution";
import type {
  AgentPlanRemoteTarget,
  AgentPlanStepExecution,
} from "@/definition/AgentPlanExecution";
import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentParameterValue } from "@/definition/AgentParameters";
import type { AgentPlanJumpWait } from "@/definition/AgentPlanJump";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanTemplate } from "@/definition/AgentPlanConfiguration";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { PreparedAgentParameters } from "./AgentParameterService";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";

export type { AgentPlanTemplate } from "@/definition/AgentPlanConfiguration";

/** Model identity is pinned while credentials and permission checks remain live. */
export interface AgentPlanStepSnapshot {
  readonly step: AgentPlanStep;
  readonly remoteTarget?: AgentPlanRemoteTarget;
  readonly groupId?: string;
  /** The loop this member belongs to; the node runs once per iteration inside it. */
  readonly loopId?: string;
  readonly connectionId?: string;
  readonly connectionName?: string;
  readonly name: string;
  readonly revision: number;
  readonly template: AgentPlanTemplate;
  readonly provider: AgentProviderId;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly prepared: PreparedAgentParameters;
  readonly taskIds: readonly string[];
  readonly taskVersions: Readonly<Record<string, string>>;
}

/**
 * What a resumed run does differently for the work it runs again.
 * @remarks
 * Server-only like the rest of the snapshot. A session listed here is
 * continued through the adapter's own resume; every other retried node
 * opens a new session.
 */
export interface AgentPlanRecoveryDirective {
  readonly sourceRunId: string;
  readonly isRestart?: boolean;
  /** JSON-safe private event queues and prompts from the source run. */
  readonly branching?: unknown;
  readonly mode: "native_resume" | "new_session";
  /** Nodes that started in the earlier run and run again as a new attempt. */
  readonly retriedStepIds: readonly string[];
  /** The loop iteration each resumed loop continues. */
  readonly loopIterations: Readonly<Record<string, number>>;
  /** The native session to continue, by node or by group. */
  readonly resumeSessions: Readonly<Record<string, string>>;
  /** Prior business results and open requirements, supplied to replacement sessions. */
  readonly contextByStepId?: Readonly<Record<string, string>>;
}

/**
 * The call a run was started by, as the called run needs it.
 * @remarks
 * Server-only. The entry and the inputs decide where the run begins and which
 * values its nodes read; the rest names the call so the run can send signals
 * and hand back its returns. A run that is resumed or restarted keeps the
 * entry and the inputs; it is no longer the target of the call, which the
 * call register decides, not this record.
 */
export interface AgentPlanInvocationContext {
  readonly id: string;
  readonly entryNodeId: string;
  readonly sourcePlanId: string;
  readonly sourceRunId: string;
  readonly sourceNodeId: string;
  readonly wait: AgentPlanJumpWait;
  /** The declared inputs of the entry with their defaults, validated for this call. */
  readonly inputs: Readonly<Record<string, AgentParameterValue>>;
  /** Whether the calling run handed its workspace over to this run. */
  readonly hasHandover: boolean;
}

/** Each server-only execution basis is appended once; no basis is overwritten or sent as a run response. */
export interface AgentPlanSnapshot {
  /** All new work uses runner workers; absent only in historical snapshots. */
  readonly runnerProtocolVersion?: 1;
  /** Invalid configuration fails only when its node is reached; a corrected revision can be resumed. */
  readonly preparationFailures?: Readonly<Record<string, string>>;
  readonly remoteSteps?: readonly RemotePlanStep[];
  readonly execution?: {
    readonly schemaVersion: 1;
    readonly planId: string;
    readonly runId: string;
    readonly planRevision: number;
    readonly steps: readonly AgentPlanStepExecution[];
  };
  readonly plan: AgentPlan;
  readonly groups?: readonly AgentPlanGroup[];
  readonly steps: readonly AgentPlanStepSnapshot[];
  readonly scripts?: readonly AgentPlanScriptSnapshot[];
  /** Present only in a run that resumes an earlier one. */
  readonly recovery?: AgentPlanRecoveryDirective;
  /** Present only in a run that another plan called, or that resumes or restarts such a run. */
  readonly invocation?: AgentPlanInvocationContext;
}

/**
 * The working directory of a plan node.
 * @param step - The provider and the prepared parameters of the node.
 * @returns The workspace of the agent's explicit directory parameter, which
 * takes precedence; for an ACP agent (Codex CLI, Claude Code or OpenCode) without one
 * the workspace of the plan; otherwise `null`, and a CLI node of another
 * runner needs the parameter.
 * @remarks
 * Both workspaces were resolved through the executor's workspace rights, and
 * their path and directory identity are checked again right before the node
 * starts.
 */
export function planStepDirectory(
  step: Pick<AgentPlanStepSnapshot, "provider" | "prepared">,
): ResolvedAgentWorkspace | null {
  if (step.prepared.directory !== null) return step.prepared.directory;
  return isAcpProvider(step.provider) ? step.prepared.workspace : null;
}

/** Reads a server-written private basis, refusing an incomplete or damaged snapshot. */
export function readPlanSnapshot(input: unknown): AgentPlanSnapshot {
  const snapshot = readAgentObject(input);
  const plan = readAgentObject(snapshot.plan);
  if (
    typeof plan.id !== "string" ||
    !Array.isArray(plan.nodes) ||
    !Array.isArray(plan.edges) ||
    !Array.isArray(snapshot.steps)
  )
    throw new AgentPlanRecoveryError("checkpoint_invalid");
  // Only Pages writes these private execution bases, after validating their contracts.
  return input as AgentPlanSnapshot;
}
