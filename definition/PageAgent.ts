import type { RunnerModelRoute } from "./RunnerExecution.js";
import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentAvailability } from "./AgentAvailability";
import type {
  AgentConnectionLocation,
  AgentProviderId,
} from "./AgentConnection";
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
  readonly runnerRoute?: RunnerModelRoute;
  readonly id: string;
  /** Exact connection for direct choices; absent only on legacy profile projections. */
  readonly connectionId?: string;
  /** Providers without a catalog expose their explicitly configured model ID. */
  readonly isManual?: boolean;
  readonly name: string;
  /** The model's catalog name alone; absent only on legacy profile projections. */
  readonly modelName?: string;
  /** The administrators' name of the connection; absent only on legacy profile projections. */
  readonly connectionName?: string;
  /** Where the connection runs; absent only on legacy profile projections. */
  readonly location?: AgentConnectionLocation;
  readonly model: string;
  /** The context size the provider states for the model; `null` or absent when it does not. */
  readonly contextWindow?: number | null;
  /** The output limit the provider states for the model; `null` or absent when it does not. */
  readonly maxOutputTokens?: number | null;
  readonly reasoning: AgentReasoningSupport;
  readonly reasoningEfforts: readonly string[];
  /** The default the catalog names for the model. */
  readonly catalogDefaultReasoningEffort: string | null;
  /** The effort the administrator saved with the model assignment. */
  readonly reasoningEffort: string | null;
  /** The provider of the model connection, such as `codex_cli`; never the connection itself. */
  readonly provider: AgentProviderId;
  /** What the CLI's picker resolves to this model, such as `sonnet`; absent where the catalog does not say. */
  readonly aliases?: readonly string[];
  /** Whether the catalog states a price of zero; absent where it states no price. */
  readonly isFree?: boolean;
  /** Whether the model calls tools; absent where the catalog does not say. */
  readonly isToolCapable?: boolean;
  /**
   * `false` when the catalog's stated modalities or tool calls rule out chatting.
   *
   * @remarks
   * The model choice hides such a model; a saved assignment to it stays and
   * is shown as unavailable. Absent where the catalog states nothing.
   */
  readonly isChatCapable?: boolean;
  /** Text-only decisions may use a text model even when it cannot call tools. */
  readonly isTextCapable?: boolean;
  /**
   * `true` for a model that recognizes speech (PAGE-273): its catalog states
   * audio input and text output alone, or Pages documents it as a
   * recognition model. Set only in the model choice of speech recognition.
   */
  readonly isSpeechCapable?: boolean;
  /**
   * `true` for a model that speaks text aloud (PAGE-300): its catalog states
   * `speech` among the outputs. Only the speech output takes such a model;
   * Pica, agents and plan nodes refuse it.
   */
  readonly isSpeechOutputCapable?: boolean;
  /**
   * `true` for a transcription model (PAGE-302): its catalog states audio
   * input and `transcription` output. Only speech recognition takes such a
   * model; Pica, agents and plan nodes refuse it.
   */
  readonly isTranscriptionOnly?: boolean;
  /**
   * `true` when the last server refresh of the model's catalog failed.
   *
   * @remarks
   * The model choice then warns that the list may be outdated (PAGE-248);
   * absent while the catalog is current.
   */
  readonly isCatalogFailed?: boolean;
  /** For a remote OpenCode model: the connection and workspace it runs on, such as "homeNAS / pageNAS". */
  readonly targetName?: string;
  /**
   * `true` for the model of the agent simulation (PAGE-268); the model choice
   * names it as Simulation. Absent for every real model.
   */
  readonly isSimulation?: boolean;
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
