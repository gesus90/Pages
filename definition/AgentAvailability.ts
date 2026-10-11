import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentProfileChoice, AgentProfilePurpose } from "./AgentProfile";
import type { AgentErrorCode } from "@/backend/error/AgentErrors";
import type { TextAssistantErrorCode } from "@/backend/error/TextAssistantErrors";

/** Availability is computed for the current executor; never stored as an agent status. */
export interface AgentAvailability {
  readonly isUsable: boolean;
  readonly reason: AgentErrorCode | TextAssistantErrorCode | null;
  readonly personalChoices: readonly AgentProfileChoice[];
}

/** Authorized reusable content without credentials, foreign assignments or account metadata. */
export interface AgentDefinitionChoice {
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
  readonly agentId: string;
  readonly personalAgentId: string | null;
  readonly projectId: string | null;
}
