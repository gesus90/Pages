import type { AgentParameter } from "./AgentParameters.js";

/** Reads of the user agents the account may see, and of the models it may give them. */
export const PAGE_AGENT_READ_OPERATIONS = [
  "agents.list",
  "agents.read",
  "agents.models.list",
] as const;

/** Changes of user agents; the owner is always the connected account. */
export const PAGE_AGENT_WRITE_OPERATIONS = [
  "agents.create",
  "agents.update",
] as const;

export type PageAgentReadOperation =
  (typeof PAGE_AGENT_READ_OPERATIONS)[number];
export type PageAgentWriteOperation =
  (typeof PAGE_AGENT_WRITE_OPERATIONS)[number];

/** Who may use an agent: only its owner, everyone, or members of groups and departments. */
export const PAGE_AGENT_SHARING_SCOPES = [
  "private",
  "global",
  "restricted",
] as const;
export type PageAgentSharingScope = (typeof PAGE_AGENT_SHARING_SCOPES)[number];

/** How a restricted share matches: one target is enough (`or`) or every target is needed (`and`). */
export const PAGE_AGENT_SHARING_OPERATORS = ["or", "and"] as const;
export type PageAgentSharingOperator =
  (typeof PAGE_AGENT_SHARING_OPERATORS)[number];

/**
 * How a runner may work in a workspace; MCP clients read it and never set it.
 *
 * @remarks
 * Structurally the run options of an agent configuration; they are declared
 * here because the MCP package type-checks this file on its own.
 */
export interface PageAgentRunOptions {
  readonly access: "workspace_write" | "read_only";
  readonly shell: boolean;
  readonly web: boolean;
  readonly timeoutMinutes: number;
}

/** How the model catalog describes reasoning control for a model. */
export type PageAgentReasoningSupport =
  "levels" | "automatic" | "none" | "unknown";

/** A group or department by its identifier and current name. */
export interface PageAgentTarget {
  readonly id: string;
  readonly name: string;
}

/** The usage share of an agent; it never grants editing, connections or projects. */
export interface PageAgentSharingEntry {
  readonly scope: PageAgentSharingScope;
  /** Present for a restricted share only. */
  readonly operator: PageAgentSharingOperator | null;
  readonly groups: readonly PageAgentTarget[];
  readonly departments: readonly PageAgentTarget[];
}

/** A user agent as an MCP client reads it; no credential, connection or file path is part of it. */
export interface PageAgentEntry {
  readonly id: string;
  readonly name: string;
  /** Markdown instruction of the agent, with `{{parameter}}` placeholders. */
  readonly instruction: string;
  readonly parameters: readonly AgentParameter[];
  readonly directoryParameter: string | null;
  /** How a runner may work in a workspace; MCP reads it and never changes it. */
  readonly run: PageAgentRunOptions;
  readonly modelProfileId: string;
  readonly model: string;
  readonly reasoningEffort: string | null;
  readonly sharing: PageAgentSharingEntry;
  readonly ownerId: string;
  /** Whether the connected account owns the agent and may change it. */
  readonly canEdit: boolean;
  /** Whether a run could start for this account right now. */
  readonly isUsable: boolean;
  /** The share names a group or department that is gone; changing the share needs an explicit `sharing`. */
  readonly hasDeletedTargets: boolean;
  /** Value to pass as `expectedRevision` to a change. */
  readonly revision: number;
}

/** One page of the visible user agents. */
export interface PageAgentList {
  readonly agents: readonly PageAgentEntry[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** A single visible user agent. */
export interface PageAgentRead {
  readonly agent: PageAgentEntry;
}

/** A model the account may give an agent, with what the catalog reports for reasoning. */
export interface PageAgentModelEntry {
  /** Pass as `modelProfileId`. */
  readonly modelProfileId: string;
  readonly name: string;
  readonly model: string;
  readonly reasoning: PageAgentReasoningSupport;
  /** The levels the catalog lists for the model; empty when it lists none. */
  readonly reasoningEfforts: readonly string[];
  /** The default the catalog names for the model; `null` when it names none. */
  readonly catalogDefaultReasoningEffort: string | null;
  /** The level applied when `reasoningEffort` is omitted on create; `null` leaves it to the provider. */
  readonly defaultReasoningEffort: string | null;
  /** Whether this is the model applied when `modelProfileId` is omitted on create. */
  readonly isDefault: boolean;
}

export interface PageAgentModelList {
  readonly models: readonly PageAgentModelEntry[];
}

/** Result of a create or update; a repeated call with the same operation ID returns the same result. */
export interface PageAgentChanged {
  readonly id: string;
  /** `false` when the request matched the stored agent and nothing was written. */
  readonly changed: boolean;
  /** Revision after the change. */
  readonly revision: number;
}

export type PageAgentReadResult =
  PageAgentList | PageAgentRead | PageAgentModelList;
