import type { AgentReadChunk } from "./AgentReadChunks.js";
import type {
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
  AgentPlanStepExecution,
} from "./AgentPlanExecution.js";
import type { AgentParameter, AgentParameterValue } from "./AgentParameters.js";
import type { PageAgentSharingEntry } from "./PageAgentOperations.js";

/**
 * Reads of agent plans and of the runs of the connected account.
 *
 * @remarks
 * Pages applies the rules of the plan page: a plan is visible while its
 * workspace is visible and its share admits the account; runs are private to
 * the person who started them.
 */
export const AGENT_PLAN_READ_OPERATIONS = [
  "plans.list",
  "plans.read",
  "plans.sources.read",
  "plans.runs.list",
  "plans.run.read",
  "plans.run.reports.read",
] as const;

/** Additional personal-client resource reads; existing plan/chat reads keep their original registry. */
export const AGENT_PLAN_RESOURCE_READ_OPERATIONS = [
  "plans.capabilities.read",
  "plans.run.recovery.read",
  "plans.templates.list",
  "plans.templates.read",
  "plans.control.read",
] as const;

/** Changes of agent plans; the owner and the team change a plan, as on the plan page. */
export const AGENT_PLAN_WRITE_OPERATIONS = [
  "plans.create",
  "plans.update",
  "plans.parameter.create",
  "plans.parameter.update",
  "plans.parameter.remove",
] as const;

export type AgentPlanReadOperation =
  | (typeof AGENT_PLAN_READ_OPERATIONS)[number]
  | (typeof AGENT_PLAN_RESOURCE_READ_OPERATIONS)[number];
export type AgentPlanWriteOperation =
  (typeof AGENT_PLAN_WRITE_OPERATIONS)[number];

/**
 * Why the graph check refused a plan, as the plan page names it.
 *
 * @remarks
 * Declared here because the MCP package type-checks this file on its own; the
 * graph check of Pages uses exactly these names.
 */
export const AGENT_PLAN_ISSUE_PROBLEMS = [
  "remoteModel",
  "remoteInterpreter",
  "remoteContainer",
  "remoteOffline",
  "remoteIdentity",
  "remoteCatalog",
  "remoteWorkspace",
  "remoteToolMissing",
  "remoteLogin",
  "remoteLoginUnknown",
  "remoteOptions",
  "groupSize",
  "groupProvider",
  "groupConfiguration",
  "groupOrder",
  "groupBoundary",
  "groupBinding",
  "loopSize",
  "loopBoundary",
  "loopRuns",
  "loopCondition",
  "loopPrevious",
  "loopProvider",
  "unsupportedRunNotes",
  "duplicateNode",
  "port",
  "duplicate",
  "cycle",
  "type",
  "ticketHandoff",
  "resultSource",
  "resultOrder",
  "resultMissing",
  "resultAmbiguous",
  "source",
  "required",
  "start",
  "end",
  "flowIn",
  "flowOut",
  "unreachable",
  "agent",
  "name",
  "json",
  "number",
  "scriptUnavailable",
  "scriptConfiguration",
  "loopScriptUnsupported",
] as const;

export type AgentPlanIssueProblem = (typeof AGENT_PLAN_ISSUE_PROBLEMS)[number];

/** One finding of the graph check: the node and port it concerns, and what is wrong. */
export interface AgentPlanIssueEntry {
  readonly nodeId: string | null;
  readonly port: string | null;
  readonly problem: AgentPlanIssueProblem;
}

/** Where a node input takes its value from. */
export type AgentPlanBindingEntry =
  | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
  | { readonly kind: "source"; readonly nodeId: string }
  | { readonly kind: "result"; readonly stepId: string }
  | { readonly kind: "previous"; readonly stepId: string };

interface AgentPlanNodeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** What the plan page shows for the node: agent name, ticket key and title, or parameter name. */
  readonly label: string;
}

/** Secret-free pinned configuration; mutations accept patches, never a replacement graph or credentials. */
export interface AgentPlanConfigurationEntry {
  readonly name: string;
  readonly revision: number;
  readonly modelProfileId: string;
  readonly connectionId?: string;
  readonly model: string;
  readonly provider: string | null;
  readonly reasoningEffort: string | null;
  readonly template: {
    readonly markdown: string;
    readonly parameters: readonly AgentParameter[];
    readonly directoryParameter: string | null;
    readonly run?: {
      readonly access: "read_only" | "workspace_write" | "yolo";
      readonly shell: boolean;
      readonly web: boolean;
      readonly timeoutMinutes: number;
      readonly browser?: boolean;
    };
  };
}

/** An agent step with its own work order and the sources of its parameters. */
export interface AgentPlanAgentNodeEntry extends AgentPlanNodeBase {
  readonly type: "agent";
  /** Empty when the agent was deleted and none was assigned again. */
  readonly agentId: string;
  /** `null` for automatic model access, empty when an explicit one was removed. */
  readonly personalAgentId: string | null;
  readonly instruction: string;
  readonly executionTarget?: AgentPlanExecutionTarget;
  /** Progress scope only; neither mode gates execution. Absent means `report`. */
  readonly completion?: "report" | "todos";
  readonly configuration?: AgentPlanConfigurationEntry;
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** An agent step inside a group; its position counts from the group's member area. */
export type AgentPlanGroupStepEntry = Omit<AgentPlanAgentNodeEntry, "label">;

/** A flow edge between two members of the same group. */
export interface AgentPlanGroupEdgeEntry {
  readonly from: string;
  readonly to: string;
  readonly fromPort: string;
  readonly toPort: string;
}

/**
 * A portless ACP session container with retained legacy input metadata.
 *
 * Explicit internal and external agent edges determine dependencies. Ready
 * members share a serial session per run. Missing `edges` marks a historical
 * ordered group; its former chain is made explicit on read.
 *
 * @remarks
 * Declared here instead of importing the group of the plan model, because the
 * MCP package type-checks this file on its own.
 */
export interface AgentPlanGroupNodeEntry extends AgentPlanNodeBase {
  readonly type: "group";
  readonly name: string;
  readonly steps: readonly AgentPlanGroupStepEntry[];
  readonly edges?: readonly AgentPlanGroupEdgeEntry[];
  /** Retained historical inputs; current bindings name the actual value source. */
  readonly parameters: readonly (AgentParameter & { readonly id: string })[];
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** A single named value; numbers and JSON reach text ports as text. */
export interface AgentPlanParameterNodeEntry extends AgentPlanNodeBase {
  readonly type: "parameter";
  readonly name: string;
  readonly format: "string" | "number" | "json";
  readonly value: AgentParameterValue;
}

/**
 * A script step: its content, interpreter profile and declared text inputs and output.
 *
 * @remarks
 * Explicit authorized runs execute the selected interpreter in the resolved
 * plan workspace. Declared text inputs arrive as one JSON object on stdin;
 * stdout is the optional single text result, stderr is diagnostic.
 */
export interface AgentPlanScriptNodeEntry extends AgentPlanNodeBase {
  readonly type: "script";
  readonly name: string;
  readonly executionTarget?: AgentPlanExecutionTarget;
  /** The stable identifier of an interpreter profile, not its display name. */
  readonly interpreterProfileId: string;
  readonly content: string;
  readonly inputs: readonly {
    readonly name: string;
    readonly type: "text";
    readonly isRequired: boolean;
  }[];
  readonly outputs: readonly { readonly name: string; readonly type: "text" }[];
  readonly timeoutSeconds: number;
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/**
 * A loop as a client reads it and edits through targeted fields and membership changes.
 *
 * @remarks
 * Declared here for the same reason as the group: the MCP package checks this
 * file on its own. The loop's own settings are listed as the plan stores them.
 */
export interface AgentPlanLoopNodeEntry extends AgentPlanNodeBase {
  readonly type: "loop";
  readonly name: string;
  readonly steps: readonly (
    | Omit<AgentPlanAgentNodeEntry, "label">
    | Omit<AgentPlanScriptNodeEntry, "label">
  )[];
  readonly edges: readonly AgentPlanGroupEdgeEntry[];
  readonly runs: number;
  readonly runsSource: "value" | "parameter";
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
  readonly countMode: "max" | "expected";
  readonly sessionPolicy: "reuse" | "fresh";
  readonly condition: {
    readonly isEnabled: boolean;
    readonly sourceNodeId: string;
    readonly outputPath: string;
    readonly operator: "equals";
    readonly expected:
      | { readonly type: "boolean"; readonly value: boolean }
      | { readonly type: "number"; readonly value: number }
      | { readonly type: "string"; readonly value: string }
      | { readonly type: "null" };
  } | null;
}

/** A node as a client reads it and writes it back in a change. */
export type AgentPlanNodeEntry =
  | AgentPlanAgentNodeEntry
  | AgentPlanScriptNodeEntry
  | AgentPlanGroupNodeEntry
  | AgentPlanLoopNodeEntry
  | AgentPlanParameterNodeEntry
  | (AgentPlanNodeBase & { readonly type: "start" | "end" })
  | (AgentPlanNodeBase & { readonly type: "task"; readonly taskId: string })
  | (AgentPlanNodeBase & { readonly type: "variable"; readonly name: string });

/** A flow connection: the target starts after the source has finished. */
export interface AgentPlanEdgeEntry {
  readonly from: string;
  readonly to: string;
  readonly fromPort: string;
  readonly toPort: string;
}

export type AgentPlanRunStatus =
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused"
  | "pausing"
  | "stopping";

/** A run of the connected account, assigned to its plan by `planId`. */
export interface AgentPlanRunSummary {
  readonly runId: string;
  readonly planId: string;
  readonly planName: string;
  /** ISO 8601 time the run started. */
  readonly startedAt: string;
  readonly status: AgentPlanRunStatus;
}

/**
 * What a plan is doing for the connected account.
 *
 * @remarks
 * `state` follows the account's own runs: `running`, `pausing`, `paused` or `stopping` while one of
 * them is active, `idle` otherwise. `isRunnable` and `issues` are the checks
 * the plan page runs before Play, with the agents the account may use now.
 */
export interface AgentPlanStatusEntry {
  readonly state: "idle" | "running" | "paused" | "pausing" | "stopping";
  readonly runCount: number;
  readonly latestRun: AgentPlanRunSummary | null;
  readonly isRunnable: boolean;
  readonly issues: readonly AgentPlanIssueEntry[];
}

/** The department whose members and leaders share a plan. */
export interface AgentPlanTeamEntry {
  readonly id: string;
  readonly name: string;
}

/** A visible plan without its graph. */
export interface AgentPlanSummary {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  /**
   * Whether the connected account may change and run the plan: its owner, or
   * a member or leader of its team who can open the project.
   */
  readonly canEdit: boolean;
  /** The team of the plan, or `null` when only its owner works with it. */
  readonly team: AgentPlanTeamEntry | null;
  /** The read-only usage share; it never lets anyone change the plan. */
  readonly sharing: PageAgentSharingEntry;
  /** Value to pass as `expectedRevision` to a change. */
  readonly revision: number;
  readonly nodeCount: number;
  readonly state: AgentPlanStatusEntry["state"];
  readonly latestRun: AgentPlanRunSummary | null;
}

/** A visible plan with its graph and status. */
export interface AgentPlanDetail extends Omit<
  AgentPlanSummary,
  "state" | "latestRun"
> {
  readonly nodes: readonly AgentPlanNodeEntry[];
  readonly edges: readonly AgentPlanEdgeEntry[];
  /** Text values of older plans, which `variable` nodes refer to. */
  readonly globals: Readonly<Record<string, string>>;
  readonly status: AgentPlanStatusEntry;
}

export interface AgentPlanList {
  readonly plans: readonly AgentPlanSummary[];
  readonly total: number;
  readonly nextCursor: string | null;
}

export interface AgentPlanRead {
  readonly plan: AgentPlanDetail;
}

/** A workspace a plan can be created in. */
export interface AgentPlanWorkspaceEntry {
  /** Absent means local; remote contexts require the corresponding explicit execution target. */
  readonly kind?: "local" | "remote";
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly isUsable: boolean;
}

/** An agent a node of a plan in the workspace can run, with the inputs it declares. */
export interface AgentPlanAgentEntry {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly isUsable: boolean;
  readonly configuration: AgentPlanConfigurationEntry;
  readonly directoryParameter: string | null;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: AgentParameterValue["type"];
    readonly description: string;
    readonly isRequired: boolean;
  }[];
}

/**
 * An interpreter profile a script node can name, without its program path.
 *
 * @remarks
 * `unchecked` means no check of the configured program has finished yet.
 */
export interface AgentPlanInterpreterEntry {
  readonly id: string;
  readonly name: string;
  readonly status: "ok" | "error" | "unchecked";
  readonly version: string | null;
}

/** What a plan can be built from: workspaces, and the agents and interpreter profiles of one of them. */
export interface AgentPlanSourceList {
  readonly remoteTargets?: readonly AgentPlanRemoteTarget[];
  readonly workspaces: readonly AgentPlanWorkspaceEntry[];
  /** Empty unless a workspace was named. */
  readonly agents: readonly AgentPlanAgentEntry[];
  /** The profiles script nodes name by id; present when a workspace was named. */
  readonly models?: readonly {
    readonly id: string;
    readonly name: string;
    readonly model: string;
    readonly provider: string;
    readonly reasoning: string;
    readonly reasoningEfforts: readonly string[];
    readonly catalogDefaultReasoningEffort: string | null;
    readonly reasoningEffort: string | null;
  }[];
  readonly limits?: {
    readonly nodes: number;
    readonly edges: number;
    readonly groupMembers: number;
    readonly coordinateMinimum: number;
    readonly coordinateMaximum: number;
    readonly changes: number;
    readonly timeoutMinutes: readonly number[];
  };
  readonly interpreters?: readonly AgentPlanInterpreterEntry[];
}

/** One page of the runs of a plan, in the requested order of their start. */
export interface AgentPlanRunList {
  readonly planId: string;
  readonly order: "newest" | "oldest";
  readonly runs: readonly AgentPlanRunSummary[];
  readonly total: number;
  readonly nextCursor: string | null;
}

/** The state of one node in a run. */
export interface AgentPlanRunStepEntry {
  readonly execution?: AgentPlanStepExecution;
  readonly attemptId?: string;
  readonly stepId: string;
  readonly name: string;
  readonly status: "waiting" | AgentPlanRunStatus;
  readonly isBlocked: boolean;
  readonly error: string | null;
  /** Diagnostic progress, independent of execution status; `rejected` is historical. */
  readonly verdict: "accepted" | "open" | "rejected" | null;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /** Whether {@link AgentPlanReport} has something for this node. */
  readonly hasReport: boolean;
}

/** One run with the state of its nodes. */
export interface AgentPlanRunDetail extends AgentPlanRunSummary {
  readonly planRevision: number;
  /** ISO 8601 time the last node ended, `null` while the run is active. */
  readonly endedAt: string | null;
  readonly stopRequested: boolean;
  readonly steps: readonly AgentPlanRunStepEntry[];
  readonly continuationVersion?: number;
  readonly appliedPlanRevision?: number;
  readonly loops?: readonly {
    readonly loopId: string;
    readonly status: string;
    readonly completion: string | null;
    readonly cleanup: string;
    readonly iterations: readonly {
      readonly iteration: number;
      readonly status: string;
      readonly steps: readonly AgentPlanRunStepEntry[];
    }[];
  }[];
}

export interface AgentPlanRunRead {
  readonly run: AgentPlanRunDetail;
}

/** The report of one node of a run; `runId` and `stepId` name exactly where it belongs. */
export interface AgentPlanReport {
  readonly loopId?: string;
  readonly iteration?: number;
  readonly runId: string;
  readonly planId: string;
  readonly stepId: string;
  readonly name: string;
  readonly status: AgentPlanRunStepEntry["status"];
  readonly startedAt: string | null;
  readonly endedAt: string | null;
  /** The final, redacted result text of the node. */
  readonly output: string | null;
  readonly error: string | null;
  readonly verdict: "accepted" | "open" | "rejected" | null;
  readonly summary: string | null;
  readonly todos: readonly {
    readonly id: string;
    readonly text: string;
    readonly status: "done" | "open" | "missing";
  }[];
  readonly criteria: readonly {
    readonly id: string;
    readonly text: string;
    readonly met: boolean;
    readonly evidence: string;
  }[];
  readonly decisions: readonly string[];
  readonly issues: readonly string[];
}

/** The reports of a run, all assigned to it. */
export interface AgentPlanReportList {
  readonly run: AgentPlanRunSummary;
  readonly reports: readonly AgentPlanReport[];
}

/** Result of a change; a repeated call with the same operation ID returns the same result. */
export interface AgentPlanChanged {
  readonly planId: string;
  /** `false` when the request matched the stored plan and nothing was written. */
  readonly changed: boolean;
  /** Revision after the change. */
  readonly revision: number;
  /** Identifiers of the nodes the change added, in the order they were requested. */
  readonly createdNodeIds: readonly string[];
}

export type AgentPlanReadResult =
  | AgentReadChunk
  | AgentPlanList
  | AgentPlanRead
  | AgentPlanSourceList
  | AgentPlanRunList
  | AgentPlanRunRead
  | AgentPlanReportList
  | { readonly capabilities: AgentPlanCapabilities }
  | { readonly recovery: AgentPlanRecoveryEntry }
  | { readonly templates: readonly AgentPlanTemplateEntry[] }
  | { readonly template: AgentPlanTemplateEntry }
  | { readonly control: AgentPlanControlEntry };

/** Additive contract revision, independently observable from a client's MCP bundle version. */
export const AGENT_PLAN_CONTRACT_VERSION = 2;

/** Implementation discovery never substitutes for current per-plan access and availability. */
export interface AgentPlanCapabilities {
  readonly contractVersion: number;
  readonly operations: readonly (
    AgentPlanReadOperation | AgentPlanWriteOperation | AgentPlanCommandOperation
  )[];
  readonly cloneSharing: "create_default";
  readonly resume: "durable_pause_boundary";
  /** Human provenance supported by each transport of this implementation. */
  readonly deletionConfirmation: {
    readonly stdio: "client_form";
    readonly http: "unavailable";
    readonly pica: "target_bound_message";
  };
}

/** Existing recovery availability, projected without checkpoints, prompts or provider-session identifiers. */
export interface AgentPlanRecoveryEntry {
  readonly planId: string;
  readonly runId: string;
  readonly revision: number;
  readonly planRevision: number;
  readonly currentPlanRevision: number;
  readonly state: string;
  readonly restart: {
    readonly available: boolean;
    readonly reason: string | null;
  };
  readonly resume: {
    readonly available: boolean;
    readonly reason: string | null;
    readonly modes: readonly {
      readonly mode: string;
      readonly available: boolean;
    }[];
  };
  readonly blockers: readonly string[];
  /** Recovery commands remain on the existing editor workflow; pause/resume never stand in for them. */
  readonly commandSurface: "editor";
}

/** Existing editor templates are append-only; update/delete are not product operations. */
export interface AgentPlanTemplateEntry {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly isShared: boolean;
  readonly createdAt: string;
  readonly node:
    | Omit<AgentPlanAgentNodeEntry, "label">
    | Omit<AgentPlanScriptNodeEntry, "label">
    | Omit<AgentPlanGroupNodeEntry, "label">
    | Omit<AgentPlanParameterNodeEntry, "label">;
}

/** Available saved-plan controls, without another executor's results. */
export interface AgentPlanControlEntry {
  readonly planId: string;
  readonly revision: number;
  readonly status: AgentPlanRunStatus | "idle";
  readonly canEdit: boolean;
  readonly canDelete: boolean;
  readonly canPlay: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
  readonly issue: string | null;
  readonly blockers: Readonly<
    Record<"delete" | "play" | "pause" | "resume" | "stop", string | null>
  >;
  readonly runId?: string;
  readonly planRevision?: number;
  readonly continuationVersion?: number;
}

/** Explicit commands, separate from graph edits and parameter aliases. */
export const AGENT_PLAN_COMMAND_OPERATIONS = [
  "plans.clone",
  "plans.delete",
  "plans.play",
  "plans.pause",
  "plans.resume",
  "plans.stop",
  "plans.templates.save",
] as const;
export type AgentPlanCommandOperation =
  (typeof AGENT_PLAN_COMMAND_OPERATIONS)[number];

/** Journaled command acknowledgement; run contents always require a fresh private read. */
export interface AgentPlanCommandResult {
  readonly planId: string;
  readonly revision: number;
  readonly runId?: string;
  readonly templateId?: string;
  readonly deleted?: boolean;
  readonly sourcePlanId?: string;
  readonly sourceRevision?: number;
  readonly workspaceId?: string;
  readonly action?: AgentPlanCommandOperation;
  /** Freshly read state, rather than the state at the time an operation was journaled. */
  readonly status?: AgentPlanRunStatus | "idle" | "deleted";
  readonly planRevision?: number;
  readonly control?: AgentPlanControlEntry;
}
