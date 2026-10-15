import { isAcpProvider } from "@/definition/AgentConfiguration";

import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentPlanTemplate } from "@/definition/AgentPlanConfiguration";

import type { ResolvedAgentWorkspace } from "@/definition/AgentWorkspace";
import type { PreparedAgentParameters } from "./AgentParameterService";

export type { AgentPlanTemplate } from "@/definition/AgentPlanConfiguration";

/** Model identity is pinned while credentials and permission checks remain live. */
export interface AgentPlanStepSnapshot {
  readonly step: AgentPlanStep;
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

/** This server-only record is persisted once and never sent as a run response. */
export interface AgentPlanSnapshot {
  readonly plan: AgentPlan;
  readonly steps: readonly AgentPlanStepSnapshot[];
}

/**
 * The working directory of a plan node.
 *
 * @param step - The provider and the prepared parameters of the node.
 * @returns The workspace of the agent's explicit directory parameter, which
 * takes precedence; for an ACP agent (Codex CLI or Claude Code) without one
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
