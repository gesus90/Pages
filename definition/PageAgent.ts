import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentAvailability } from "./AgentAvailability";
import type { AgentProviderId } from "./AgentConnection";
import type { AgentReasoningSupport } from "./AgentModelCatalog";
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
  /** The share still names a group or department that no longer exists; the list above leaves it out. */
  readonly hasDeletedTargets: boolean;
  readonly availability: AgentAvailability;
  /** The provider of the model connection; `null` when the model is gone. It decides which run options apply. */
  readonly provider: AgentProviderId | null;
}

/** Only models assigned by administrators and verified for the requesting executor appear here. */
export interface PageAgentModel {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly reasoning: AgentReasoningSupport;
  readonly reasoningEfforts: readonly string[];
  /** The default the catalog names for the model. */
  readonly catalogDefaultReasoningEffort: string | null;
  /** The effort the administrator saved with the model assignment. */
  readonly reasoningEffort: string | null;
  /** The provider of the model connection, such as `codex_cli`; never the connection itself. */
  readonly provider: AgentProviderId;
}

export interface PageAgentPage {
  /** Offers the link to the central agent administration. */
  readonly isAdministrator: boolean;
  readonly agents: readonly PageAgent[];
  readonly models: readonly PageAgentModel[];
  readonly directory: AgentProfileDirectory;
  readonly workspaces: readonly AgentWorkspaceChoice[];
}

/** How a run that started ended; a step that never started has no record. */
export const PAGE_AGENT_RUN_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
  "timeout",
] as const;
export type PageAgentRunStatus = (typeof PAGE_AGENT_RUN_STATUSES)[number];

/** Narrows a stored status before it reaches a record. */
export function isPageAgentRunStatus(
  input: unknown,
): input is PageAgentRunStatus {
  return PAGE_AGENT_RUN_STATUSES.some((status) => status === input);
}

/** One terminal agent invocation, including invocations within a multi-step plan. */
export interface PageAgentRunRecord {
  readonly agentId: string;
  readonly runId: string;
  readonly planRunId: string;
  readonly userId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly status: PageAgentRunStatus;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly input: string;
  readonly result: string;
}
