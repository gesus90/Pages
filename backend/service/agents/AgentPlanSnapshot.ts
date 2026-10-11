import type { AgentPlan, AgentPlanStep } from "@/definition/AgentPlan";
import type { AgentProviderId } from "@/definition/AgentConnection";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";
import type { PreparedAgentParameters } from "./AgentParameterService";

/** Secrets and usage grants are excluded from frozen execution configuration. */
export type AgentPlanTemplate = Pick<
  AgentConfiguration,
  "markdown" | "parameters" | "directoryParameter"
>;

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
