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

/** Changes of agent plans; only the owner changes a plan, as on the plan page. */
export const AGENT_PLAN_WRITE_OPERATIONS = [
  "plans.create",
  "plans.update",
  "plans.parameter.create",
  "plans.parameter.update",
  "plans.parameter.remove",
] as const;

export type AgentPlanReadOperation =
  (typeof AGENT_PLAN_READ_OPERATIONS)[number];
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
  "groupSize",
  "groupProvider",
  "groupConfiguration",
  "duplicateNode",
  "port",
  "duplicate",
  "cycle",
  "type",
  "ticketHandoff",
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
  | { readonly kind: "result"; readonly stepId: string };

interface AgentPlanNodeBase {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** What the plan page shows for the node: agent name, ticket key and title, or parameter name. */
  readonly label: string;
}

/** An agent step with its own work order and the sources of its parameters. */
export interface AgentPlanAgentNodeEntry extends AgentPlanNodeBase {
  readonly type: "agent";
  /** Empty when the agent was deleted and none was assigned again. */
  readonly agentId: string;
  /** `null` for automatic model access, empty when an explicit one was removed. */
  readonly personalAgentId: string | null;
  readonly instruction: string;
  /** `todos` follows only the ticket's todo list and never gates the run; absent means `report`. */
  readonly completion?: "report" | "todos";
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** An agent step inside a group; its order in the group is its execution order. */
export type AgentPlanGroupStepEntry = Omit<AgentPlanAgentNodeEntry, "label">;

/**
 * A sequential group of agent steps with the inputs at its boundary.
 *
 * @remarks
 * Declared here instead of importing the group of the plan model, because the
 * MCP package type-checks this file on its own.
 */
export interface AgentPlanGroupNodeEntry extends AgentPlanNodeBase {
  readonly type: "group";
  readonly name: string;
  readonly steps: readonly AgentPlanGroupStepEntry[];
  /** The inputs of the group; each has a stable `id` that step bindings refer to. */
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

/** A node as a client reads it and writes it back in a change. */
export type AgentPlanNodeEntry =
  | AgentPlanAgentNodeEntry
  | AgentPlanGroupNodeEntry
  | AgentPlanParameterNodeEntry
  | (AgentPlanNodeBase & { readonly type: "start" | "end" })
  | (AgentPlanNodeBase & { readonly type: "task"; readonly taskId: string })
  | (AgentPlanNodeBase & { readonly type: "variable"; readonly name: string });

/** A flow connection: the target starts after the source has finished. */
export interface AgentPlanEdgeEntry {
  readonly from: string;
  readonly to: string;
}

export type AgentPlanRunStatus =
  "running" | "succeeded" | "failed" | "cancelled" | "paused";

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
 * `state` follows the account's own runs: `running` or `paused` while one of
 * them is active, `idle` otherwise. `isRunnable` and `issues` are the checks
 * the plan page runs before Play, with the agents the account may use now.
 */
export interface AgentPlanStatusEntry {
  readonly state: "idle" | "running" | "paused";
  readonly runCount: number;
  readonly latestRun: AgentPlanRunSummary | null;
  readonly isRunnable: boolean;
  readonly issues: readonly AgentPlanIssueEntry[];
}

/** A visible plan without its graph. */
export interface AgentPlanSummary {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  /** Whether the connected account owns the plan and may change it. */
  readonly canEdit: boolean;
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
  readonly directoryParameter: string | null;
  readonly parameters: readonly {
    readonly name: string;
    readonly type: AgentParameterValue["type"];
    readonly description: string;
    readonly isRequired: boolean;
  }[];
}

/** What a plan can be built from: workspaces, and the agents of one of them. */
export interface AgentPlanSourceList {
  readonly workspaces: readonly AgentPlanWorkspaceEntry[];
  /** Empty unless a workspace was named. */
  readonly agents: readonly AgentPlanAgentEntry[];
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
  readonly stepId: string;
  readonly name: string;
  readonly status: "waiting" | AgentPlanRunStatus;
  readonly isBlocked: boolean;
  readonly error: string | null;
  /** The business acceptance of an agent step; `null` before its report or without one. */
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
}

export interface AgentPlanRunRead {
  readonly run: AgentPlanRunDetail;
}

/** The report of one node of a run; `runId` and `stepId` name exactly where it belongs. */
export interface AgentPlanReport {
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
  | AgentPlanList
  | AgentPlanRead
  | AgentPlanSourceList
  | AgentPlanRunList
  | AgentPlanRunRead
  | AgentPlanReportList;
