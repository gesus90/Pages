import { isAcpProvider } from "@/definition/AgentConfiguration";

import type { AgentPlanGroup } from "@/definition/AgentPlanGroup";
import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanTemplate } from "@/definition/AgentPlanConfiguration";
import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { PreparedAgentParameters } from "./AgentParameterService";
import type { AgentPlanScriptSnapshot } from "./AgentPlanScriptPreparation";

export type { AgentPlanTemplate } from "@/definition/AgentPlanConfiguration";

/** Model identity is pinned while credentials and permission checks remain live. */
export interface AgentPlanStepSnapshot {
  readonly step: AgentPlanStep;
  readonly groupId?: string;
  /** The loop this member belongs to; the node runs once per iteration inside it. */
  readonly loopId?: string;
  readonly connectionId?: string;
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
 *
 * @remarks
 * Server-only like the rest of the snapshot. A session listed here is
 * continued through the adapter's own resume; every other retried node
 * opens a new session.
 */
export interface AgentPlanRecoveryDirective {
  readonly sourceRunId: string;
  readonly mode: "native_resume" | "new_session";
  /** Nodes that started in the earlier run and run again as a new attempt. */
  readonly retriedStepIds: readonly string[];
  /** The loop iteration each resumed loop continues. */
  readonly loopIterations: Readonly<Record<string, number>>;
  /** The native session to continue, by node or by group. */
  readonly resumeSessions: Readonly<Record<string, string>>;
}

/** Each server-only execution basis is appended once; no basis is overwritten or sent as a run response. */
export interface AgentPlanSnapshot {
  readonly plan: AgentPlan;
  readonly groups?: readonly AgentPlanGroup[];
  readonly steps: readonly AgentPlanStepSnapshot[];
  readonly scripts?: readonly AgentPlanScriptSnapshot[];
  /** Present only in a run that resumes an earlier one. */
  readonly recovery?: AgentPlanRecoveryDirective;
}

/**
 * The working directory of a plan node.
 *
 * @param step - The provider and the prepared parameters of the node.
 * @returns The workspace of the agent's explicit directory parameter, which
 * takes precedence; for an ACP agent (Codex CLI, Claude Code or OpenCode) without one
 * the workspace of the plan; otherwise `null`, and a CLI node of another
 * runner needs the parameter.
 *
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
