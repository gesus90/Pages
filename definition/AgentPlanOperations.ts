import type { AgentPlanTeamKind } from "./AgentPlanTeam";
import type { AgentPlanCloneAdjustment } from "./AgentPlanClone";
import type { AgentPlanSwarm } from "./AgentPlanSwarm";
import type { PlanRunCommandReceipt } from "./PagesRuns.js";
import type { AgentPlanIssueProblem } from "./AgentPlanIssueProblems.js";
import type {
  AgentPlanWriterWait,
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
} from "./AgentPlanExecution.js";
import type { AgentWorkspaceCleanup } from "./AgentWorkspaceCleanup.js";
import type { AgentPlanControl } from "./AgentPlanControl.js";
import type { AgentPlanCompletionGate } from "./AgentPlanWork.js";
import type { AgentPlanDiagnostic } from "./AgentPlanDiagnostics.js";
import type { AgentPlanSessionEvents } from "./AgentPlanSessionEvents.js";
import type { AgentPlanRemoteStatusProblem } from "./AgentPlanRemoteStatus.js";
import type { AgentPlanWorkspaceConflict } from "./AgentPlanWorkspaceConflict.js";
import type { AgentPlanRecoveryEntry } from "./AgentPlanRecoveryEntry.js";
import type {
  AgentPlanStartRejection,
  AgentPlanStartRejectionPage,
} from "./AgentPlanStartRejection.js";
import type { AgentReadChunk } from "./AgentReadChunks.js";
import type {
  AgentRunDiagnosisReadResult,
  AgentRunStarter,
  Attributed,
} from "./AgentRunDiagnosis.js";
import type {
  AgentPlanReportList,
  AgentPlanRunList,
  AgentPlanRunRead,
} from "./AgentPlanRunReads.js";
import type { AgentParameter, AgentParameterValue } from "./AgentParameters.js";
import type * as Decision from "./AgentPlanDecisionEntry.js";
import type { AgentPlanAsset, AgentPlanAssetEntry } from "./AgentPlanAsset.js";
import type { PageAgentSharingEntry } from "./PageAgentOperations.js";
import type { AgentPlanOneShotState } from "./AgentPlanOneShot.js";
import type { AgentPlanCapabilities } from "./AgentPlanCapabilities.js";

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
  "plans.run.diagnostics.read",
  "plans.run.session.events.read",
  "plans.run.checkpoint.read",
  "plans.templates.list",
  "plans.templates.read",
  "plans.control.read",
  // The diagnosis of runs for the whole team (PAGE-307).
  "plans.runs.search",
  "plans.runs.failures",
  "plans.run.timeline.read",
  "plans.run.logs.read",
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

export type {
  AgentPlanReport,
  AgentPlanReportList,
  AgentPlanRunDetail,
  AgentPlanRunList,
  AgentPlanRunRead,
  AgentPlanRunStepEntry,
} from "./AgentPlanRunReads.js";

export {
  AGENT_PLAN_ISSUE_PROBLEMS,
  type AgentPlanIssueProblem,
} from "./AgentPlanIssueProblems.js";

/** One finding of the graph check: the node and port it concerns, and what is wrong. */
export interface AgentPlanIssueEntry {
  readonly asset?: {
    readonly id: string;
    readonly name: string;
    readonly cause: string;
  };
  readonly nodeId: string | null;
  readonly port: string | null;
  readonly problem: AgentPlanIssueProblem;
}

/** Where a node input takes its value from. */
export type AgentPlanBindingEntry =
  | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
  | { readonly kind: "source"; readonly nodeId: string }
  | { readonly kind: "result"; readonly stepId: string }
  | { readonly kind: "previous"; readonly stepId: string }
  | {
      /** One data output of a stack: the entry handed over last, or the number of entries. */
      readonly kind: "stack";
      readonly stackId: string;
      readonly output: "content" | "count";
    };

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
  readonly completionGate?: AgentPlanCompletionGate;
  /** Marks the closing Git step of the plan; absent means an ordinary work step. */
  readonly role?: "closeout";
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
export interface AgentPlanGroupNodeEntry
  extends AgentPlanNodeBase, Decision.AgentPlanFrameDecisions {
  readonly type: "group";
  readonly name: string;
  readonly steps: readonly AgentPlanGroupStepEntry[];
  readonly edges?: readonly AgentPlanGroupEdgeEntry[];
  /** Retained historical inputs; current bindings name the actual value source. */
  readonly parameters: readonly (AgentParameter & { readonly id: string })[];
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/** A single named value; numbers and JSON reach text ports as text, a boolean holds the text `true` or `false`. */
export interface AgentPlanParameterNodeEntry extends AgentPlanNodeBase {
  readonly type: "parameter";
  readonly name: string;
  readonly format: "string" | "number" | "json" | "boolean";
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
  readonly outputs: readonly {
    readonly name: string;
    readonly type: "text";
    readonly policy?: "report" | "gate";
  }[];
  readonly timeoutSeconds: number;
  /** Marks the closing Git step of the plan; absent means an ordinary work step. */
  readonly role?: "closeout";
  readonly bindings: Readonly<Record<string, AgentPlanBindingEntry>>;
}

/**
 * A Git closeout node of an earlier version, read as it was saved.
 *
 * @remarks
 * The node is no longer supported (PAGE-285): it cannot be added or
 * configured, Play is refused with the issue `gitCloseoutUnsupported` while
 * the plan contains it, and `removeNode` removes it. Its fields and bindings
 * stay readable until then.
 */
export interface AgentPlanGitCloseoutNodeEntry extends AgentPlanNodeBase {
  readonly type: "git_closeout";
  readonly name: string;
  readonly role: "closeout";
  readonly checkCommand: string;
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
export interface AgentPlanLoopNodeEntry
  extends AgentPlanNodeBase, Decision.AgentPlanFrameDecisions {
  readonly type: "loop";
  readonly name: string;
  readonly steps: readonly (
    | Omit<AgentPlanAgentNodeEntry, "label">
    | Omit<AgentPlanScriptNodeEntry, "label">
    | Omit<AgentPlanGroupNodeEntry, "label">
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
  /** `count` (absent in older loops) or `while`, which checks a boolean before every iteration. */
  readonly mode?: "count" | "while";
  /** The member whose result decides the later checks of a while loop. */
  readonly while?: {
    readonly sourceNodeId: string;
    readonly outputPath: string;
  } | null;
}

/**
 * A stack: ordered entries, of which every trigger at its flow input hands over the next.
 *
 * @remarks
 * Its data outputs are read through `stack` bindings: `content`, the entry
 * handed over last, and `count`, the number of entries. A used-up stack hands
 * over nothing and starts nothing behind it; a new run starts at the first entry.
 */
export interface AgentPlanStackNodeEntry extends AgentPlanNodeBase {
  readonly type: "stack";
  readonly name: string;
  readonly entries: readonly (
    | { readonly id: string; readonly type: "task"; readonly taskId: string }
    | Omit<AgentPlanParameterNodeEntry, "label" | "x" | "y">
    | AgentPlanAssetEntry
  )[];
}

/** A node as a client reads it and writes it back in a change. */
export type AgentPlanNodeEntry =
  | AgentPlanAgentNodeEntry
  | AgentPlanScriptNodeEntry
  | AgentPlanGitCloseoutNodeEntry
  | AgentPlanGroupNodeEntry
  | AgentPlanLoopNodeEntry
  | AgentPlanStackNodeEntry
  | AgentPlanParameterNodeEntry
  // An asset source (PAGE-268); a node without a file is a draft.
  | (AgentPlanNodeBase & Pick<AgentPlanAsset, "type" | "name" | "file">)
  | Decision.AgentPlanControlNodeEntry
  // A swarm (PAGE-313): a main model splits a task among helpers at run time.
  | (AgentPlanNodeBase & Omit<AgentPlanSwarm, "id" | "x" | "y">)
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
  | "stopping"
  | "work_done_closeout_open";

/** A run of the connected account, assigned to its plan by `planId`. */
export interface AgentPlanRunSummary {
  readonly runId: string;
  readonly planId: string;
  readonly planName: string;
  /** ISO 8601 time the run started. */
  readonly startedAt: string;
  readonly status: AgentPlanRunStatus;
  /** Who started the run; every member of the team of the plan reads it (PAGE-307). */
  readonly startedBy: AgentRunStarter;
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
  /** Advisory node/field findings never change start availability. */
  readonly warnings?: readonly AgentPlanIssueEntry[];
}

/** The department whose members and leaders share a plan. */
export interface AgentPlanTeamEntry {
  readonly id: string;
  readonly name: string;
}

/** One team of a plan with its name and rights (PAGE-329). */
export interface AgentPlanTeamRightsEntry extends AgentPlanTeamEntry {
  readonly kind: AgentPlanTeamKind;
  readonly read: boolean;
  readonly edit: boolean;
  readonly run: boolean;
}

/** A visible plan without its graph. */
export interface AgentPlanSummary extends AgentPlanOneShotState {
  readonly id: string;
  readonly name: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  readonly ownerId: string;
  /**
   * Whether the connected account may change the plan: its owner, an active
   * administrator, or a member or leader of a team with the right to change.
   */
  readonly canEdit: boolean;
  /** Whether the connected account may run the plan and control its own runs. */
  readonly canRun: boolean;
  /** The rights come from the administrator role alone; the plan is somebody else's. */
  readonly adminAccess: boolean;
  /** The first department team of the plan, or `null`; kept for older clients. */
  readonly team: AgentPlanTeamEntry | null;
  /** Every team of the plan, groups and departments, with their rights. */
  readonly teams: readonly AgentPlanTeamRightsEntry[];
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
  /** The stored default target, or null when an older plan did not name one. */
  readonly executionTarget: AgentPlanExecutionTarget | null;
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
  /** Current capability facts for visible remote workspaces of this project. */
  readonly remoteStatus?: readonly {
    readonly workspaceId: string;
    readonly problem: AgentPlanRemoteStatusProblem | null;
    readonly hasPagesAccess: boolean;
    readonly hasOpenCodeAccess: boolean;
    readonly hasExactResultPayload: boolean;
  }[];
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
  | AgentRunDiagnosisReadResult
  | { readonly capabilities: AgentPlanCapabilities }
  | Attributed<{ readonly recovery: AgentPlanRecoveryEntry }>
  | Attributed<{ readonly diagnostic: AgentPlanDiagnostic }>
  | Attributed<{ readonly sessionEvents: AgentPlanSessionEvents }>
  | Attributed<{ readonly checkpoint: AgentPlanCheckpointEntry | null }>
  | { readonly templates: readonly AgentPlanTemplateEntry[] }
  | { readonly template: AgentPlanTemplateEntry }
  | { readonly control: AgentPlanControlEntry };

/** An immutable, owner-authorized checkpoint projection encoded as JSON text. */
export interface AgentPlanCheckpointEntry {
  readonly version: number;
  /**
   * Parse after reassembling any outer read chunks; process and native-session identifiers are omitted.
   *
   * @remarks
   * Absent where the reader may not see the content the run used; `hiddenFields` names it.
   */
  readonly content?: string;
  /** At least one stored text value was masked or shortened for display. */
  readonly isFiltered: boolean;
}

/** A node template; only its owner renames, replaces or deletes it. */
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
export interface AgentPlanControlEntry
  extends
    AgentPlanOneShotState,
    Pick<AgentPlanControl, "resumeKind" | "resumeBlock" | "waitReason"> {
  readonly canRestart?: boolean;
  readonly resumeAction?: "paused" | "recovery";
  readonly workspaceWait?: AgentPlanWriterWait;
  readonly cleanup?: readonly AgentWorkspaceCleanup[];
  readonly planId: string;
  readonly revision: number;
  readonly status: AgentPlanRunStatus | "idle";
  /** The requester's previous workspace refusal, not the current Play state. */
  readonly lastStartRejection?: AgentPlanStartRejection;
  /** Requested separately so routine status polling does not traverse history. */
  readonly startRejectionHistory?: AgentPlanStartRejectionPage;
  /** Whether the reader may change the plan now; never while a run executes steps. */
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
  /** The server's start check per node, for example behind `plan_invalid`; only for editors. */
  readonly issues?: readonly AgentPlanIssueEntry[];
  /** The editor's own affected nodes and targets, never the other run or owner. */
  readonly workspaceConflict?: AgentPlanWorkspaceConflict;
  readonly runId?: string;
  readonly planRevision?: number;
  readonly continuationVersion?: number;
}

/** Explicit commands, separate from graph edits and parameter aliases. */
export const AGENT_PLAN_COMMAND_OPERATIONS = [
  "plans.clone",
  "plans.delete",
  "plans.keep",
  "plans.play",
  "plans.pause",
  "plans.resume",
  "plans.stop",
  "plans.templates.save",
  "plans.templates.update",
  "plans.templates.delete",
] as const;
export type AgentPlanCommandOperation =
  (typeof AGENT_PLAN_COMMAND_OPERATIONS)[number];

/** The commands that change or delete a stored node template instead of a plan. */
export type AgentPlanTemplateCommandOperation = Extract<
  AgentPlanCommandOperation,
  "plans.templates.update" | "plans.templates.delete"
>;

/**
 * Acknowledges a change of a node template; a repeated call with the same operation ID returns it again.
 *
 * @remarks
 * Copies already inserted into plans are independent nodes and stay as they are.
 */
export interface AgentPlanTemplateCommandResult {
  readonly action: AgentPlanTemplateCommandOperation;
  readonly templateId: string;
  /** The template as stored after a change; absent after a deletion. */
  readonly template?: AgentPlanTemplateEntry;
  readonly deleted?: boolean;
}

/** Explicit recovery decisions use the existing recovery journal. */
export const AGENT_PLAN_RECOVERY_COMMAND_OPERATIONS = [
  "plans.run.recovery.release",
  "plans.run.recovery.restart",
  "plans.run.recovery.resume",
] as const;
export type AgentPlanRecoveryCommandOperation =
  (typeof AGENT_PLAN_RECOVERY_COMMAND_OPERATIONS)[number];

/** A journaled decision; the revision belongs to the source run's recovery history. */
interface AgentPlanRecoveryCommandIdentity {
  readonly planId: string;
  readonly runId: string;
  readonly commandId: string;
  readonly recoveryRevision: number;
}

/** A release never starts a run; a restart or continuation names its new run. */
export type AgentPlanRecoveryCommandResult = AgentPlanRecoveryCommandIdentity &
  (
    | { readonly outcome: "released" }
    | {
        readonly outcome: "reset";
        readonly action: "restart";
        readonly issue?: string;
      }
    | {
        readonly outcome: "started";
        readonly action: "restart" | "resume";
        readonly startedRunId: string;
      }
  );

/** Journaled command acknowledgement; run contents always require a fresh private read. */
export interface AgentPlanCommandResult {
  readonly adjustments?: readonly AgentPlanCloneAdjustment[];
  /** Committed request, separate from the asynchronously observed run status. */
  readonly command?: PlanRunCommandReceipt;
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
