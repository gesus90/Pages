import type { AgentPlanConfiguration } from "./AgentPlanConfiguration";
import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentProfileChoice, AgentProfilePurpose } from "./AgentProfile";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { AgentExecutionErrorCode } from "@/backend/error/AgentExecutionErrors";

/** Availability is computed for the current executor; never stored as an agent status. */
export interface AgentAvailability {
  readonly isUsable: boolean;
  readonly reason: AgentErrorCode | AgentExecutionErrorCode | null;
  readonly personalChoices: readonly AgentProfileChoice[];
}

/** Authorized reusable content without credentials, foreign assignments or account metadata. */
export interface AgentDefinitionChoice {
  readonly modelProfileId?: string;
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly provider: AgentProviderId | null;
  readonly purposes: readonly AgentProfilePurpose[];
  readonly revision: number;
  readonly configuration: Omit<AgentConfiguration, "sharing">;
  readonly availability: AgentAvailability;
}

/** An explicit future step selection; the chosen access is never silently replaced. */
export interface AgentDefinitionSelection {
  /** Runtime copy selects an independently authorized model grant. */
  readonly configuration?: AgentPlanConfiguration;
  readonly agentId: string;
  readonly personalAgentId: string | null;
  readonly projectId: string | null;
}
