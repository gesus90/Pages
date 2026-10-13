import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentAvailability } from "./AgentAvailability";
import type { AgentProfileDirectory } from "./AgentProfile";
import type { AgentWorkspaceChoice } from "./AgentWorkspace";

/** A reusable user definition selects an admin grant, never credentials or a connection. */
export interface PageAgentInput {
  readonly name: string;
  readonly modelProfileId: string;
  readonly reasoningEffort: string | null;
  readonly configuration: AgentConfiguration;
  readonly revision?: number;
}

export interface PageAgent extends PageAgentInput {
  readonly id: string;
  readonly ownerId: string;
  readonly model: string;
  readonly canEdit: boolean;
  readonly availability: AgentAvailability;
}

/** Only models assigned by administrators and verified for the requesting executor appear here. */
export interface PageAgentModel {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly reasoningEfforts: readonly string[];
  readonly reasoningEffort: string | null;
}

export interface PageAgentPage {
  readonly agents: readonly PageAgent[];
  readonly models: readonly PageAgentModel[];
  readonly directory: AgentProfileDirectory;
  readonly workspaces: readonly AgentWorkspaceChoice[];
}

/** One terminal agent invocation, including invocations within a multi-step plan. */
export interface PageAgentRunRecord {
  readonly agentId: string;
  readonly runId: string;
  readonly planRunId: string;
  readonly userId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: "succeeded" | "failed" | "cancelled" | "timeout";
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly input: string;
  readonly result: string;
}
