import type { PlanRunCommandReceipt } from "./PagesRuns";
import type {
  AgentPlanWriterWait,
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
  AgentPlanStepExecution,
  AgentPlanRemoteProgress,
} from "./AgentPlanExecution";
import type { AgentPlanCompletionGate } from "./AgentPlanWork";
import type { AgentPlanProgress } from "./AgentPlanProgress";
import type { AgentPlanAgentTodoList } from "./AgentPlanAgentTodos";
import type { PlanRemoteAccess } from "./AgentPlanRemoteAccess";
import type { AgentPlanControl } from "./AgentPlanControl";
import type {
  AgentPlanContinuation,
  AgentPlanPauseBoundary,
} from "./AgentPlanContinuation";
import type { AgentPlanConfiguration } from "./AgentPlanConfiguration";
import type { PageAgentModel } from "./PageAgent";
import type { AgentDefinitionChoice } from "./AgentAvailability";
import type { AgentParameterValue } from "./AgentParameters";
import type { AgentConfiguration } from "./AgentConfiguration";
import type { AgentProfileDirectory } from "./AgentProfile";
import type {
  AgentPlanCompletion,
  AgentPlanSessionRecord,
} from "./AgentPlanSession";
import type { AgentWorkspaceChoice, WorkspaceGitHub } from "./AgentWorkspace";
import type { AgentPlanGroup } from "./AgentPlanGroup";
import type { AgentPlanLoop } from "./AgentPlanLoop";
import type { AgentPlanLoopRun } from "./AgentPlanLoopRun";
import type { AgentPlanBranch } from "./AgentPlanBranching";
import type {
  AgentPlanDecisionCase,
  AgentPlanDecisionMode,
  AgentPlanDecisionModel,
  AgentPlanDecisionOutput,
  AgentPlanDecisionVerdict,
} from "./AgentPlanDecision";
import type { AgentPlanFailureStop } from "./AgentPlanRetry";
import type {
  AgentPlanStack,
  AgentPlanStackHandover,
  AgentPlanStackOutput,
  AgentPlanStackRun,
} from "./AgentPlanStack";
import type {
  AgentPlanRemoteStatus,
  AgentPlanRemoteChoice,
} from "./AgentPlanTarget";
import type {
  AgentPlanInterpreter,
  AgentPlanScript,
  AgentPlanScriptRun,
} from "./AgentPlanScript";
import type { AgentPlanGitCloseout } from "./AgentPlanGitCloseout";
import type { AgentPlanAsset } from "./AgentPlanAsset";
import type { AgentPlanScriptAssessment } from "./AgentPlanScriptReport";
import type {
  AgentPlanRecoveryReason,
  AgentPlanRunOrigin,
} from "./AgentPlanRecovery";

/**
 * Plan sources and execution dependencies are deliberately separate contracts.
 *
 * @remarks
 * `previous` is only valid on a member of a loop: it hands the result a member
 * had in the previous iteration to an input. The first iteration has no such
 * result, so the input must then have a default value of its own.
 *
 * `stack` reads one of the two data outputs of a stack node: the entry its
 * newest trigger handed over, or the number of its entries. Reading never
 * triggers the stack and never consumes an entry.
 */
export type AgentPlanBinding =
  | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
  | { readonly kind: "source"; readonly nodeId: string }
  | { readonly kind: "result"; readonly stepId: string }
  | { readonly kind: "previous"; readonly stepId: string }
  | {
      readonly kind: "stack";
      readonly stackId: string;
      readonly output: AgentPlanStackOutput;
    };

export interface AgentPlanPosition {
  readonly x: number;
  readonly y: number;
}

/**
 * What a step means to the end of its run, as the plan declares it.
 *
 * @remarks
 * `closeout` marks the closing Git step: when only such a step fails, the work
 * of the run counts as done and the run ends as `work_done_closeout_open`.
 */
export type AgentPlanStepRole = "closeout";

/** Each agent instance has its own identifier and parameter values. */
export interface AgentPlanStep extends AgentPlanPosition {
  readonly id: string;
  readonly type: "agent";
  /** Empty after deletion until an agent is explicitly assigned again. */
  readonly agentId: string;
  /** null chooses automatic access; an empty string marks a removed explicit assignment. */
  readonly personalAgentId: string | null;
  readonly instruction: string;
  readonly executionTarget?: AgentPlanExecutionTarget;
  /** Absent only in plans saved before independent node configurations. */
  readonly configuration?: AgentPlanConfiguration;
  /** Absent means `report`, the completion of every node before this field existed. */
  readonly completion?: AgentPlanCompletion;
  /** Standalone-node opt-in for current ticket scope, required checks and successor gating. */
  readonly completionGate?: AgentPlanCompletionGate;
  /** Only on a node of the flow itself; absent means an ordinary work step. */
  readonly role?: AgentPlanStepRole;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/**
 * One named value; numbers retain their numeric type while JSON uses a text port.
 *
 * @remarks
 * `boolean` holds the text `true` or `false` (PAGE-286); `false` is a value,
 * not a missing one. Only a boolean parameter feeds the input of a boolean
 * decision.
 */
export interface AgentPlanParameter extends AgentPlanPosition {
  readonly id: string;
  readonly type: "parameter";
  readonly name: string;
  readonly format: "string" | "number" | "json" | "boolean";
  readonly value: AgentParameterValue;
}

/**
 * A decision: decides once per activation and activates exactly one of its outputs.
 *
 * @remarks
 * The sequence input (`flow-in`) decides when it decides; the data input
 * (`condition-in`) supplies what it decides on. In the `boolean` mode
 * (default) the data input is the boolean result of an agent, connected as an
 * edge from its `passed-out`, or a boolean parameter bound as `input`; no
 * model is called. In the `model` mode the bound `input` is a ticket or the
 * text result of an agent or script, and a model of an ACP connection answers
 * the question in a short session of its own (PAGE-286). Every activation
 * decides anew; an earlier decision is never a lasting choice. The settings
 * beyond `name` are absent in decisions saved before PAGE-286.
 */
export interface AgentPlanDecision extends AgentPlanPosition {
  readonly id: string;
  readonly type: "decision";
  /** Shown instead of the type name when set. */
  readonly name?: string;
  /** Absent means `boolean`. */
  readonly mode?: AgentPlanDecisionMode;
  /** The question a model decision asks about its source. */
  readonly question?: string;
  /** The model a model decision asks. */
  readonly model?: AgentPlanDecisionModel;
  /** Absent means yes or no. */
  readonly output?: AgentPlanDecisionOutput;
  /** The values of a classification, each with an output of its own. */
  readonly cases?: readonly AgentPlanDecisionCase[];
  /**
   * The bound data input: a boolean parameter, a ticket or a text result.
   *
   * @remarks
   * The boolean result of an agent arrives as an edge to `condition-in`
   * instead, as before PAGE-286. A decision has at most one of the two.
   */
  readonly input?: AgentPlanBinding;
}

/** Source nodes provide input; they never create an execution dependency. */
export type AgentPlanNode =
  | AgentPlanStep
  | AgentPlanScript
  | AgentPlanGitCloseout
  | AgentPlanGroup
  | AgentPlanLoop
  | AgentPlanDecision
  | AgentPlanStack
  | AgentPlanParameter
  | AgentPlanAsset
  | (AgentPlanPosition & { readonly id: string; readonly type: "end" })
  | (AgentPlanPosition & {
      readonly id: string;
      readonly type: "start";
    })
  | (AgentPlanPosition & {
      readonly id: string;
      readonly type: "task";
      readonly taskId: string;
    })
  | (AgentPlanPosition & {
      readonly id: string;
      readonly type: "variable";
      readonly name: string;
    });

export interface AgentPlanEdge {
  readonly from: string;
  readonly to: string;
  readonly fromPort: string;
  readonly toPort: string;
}

/** Workspace sharing follows live project access; it never delegates credentials. */
export interface AgentPlanInput {
  readonly name: string;
  readonly workspaceId: string;
  readonly usage: "private" | "workspace";
  /** Absent only in older plans, where workspace usage meant every project member. */
  readonly sharing?: AgentConfiguration["sharing"];
  readonly projectId?: string;
  /**
   * Where the agent and script nodes run unless a node names its own target.
   *
   * @remarks
   * Absent means the Pages host, as in plans saved before plan targets. A
   * remote target names a registered remote workspace of the plan's project,
   * whose directory is the working directory of inheriting nodes; the plan
   * keeps a local workspace of the project as its anchor all the same.
   */
  readonly executionTarget?: AgentPlanExecutionTarget;
  /**
   * Marks a one-time plan (PAGE-309).
   *
   * @remarks
   * Pages deletes the plan with its runs five minutes after a run ends as
   * `succeeded`. Absent means a normal plan.
   */
  readonly oneShot?: boolean;
  readonly globals: Readonly<Record<string, string>>;
  readonly nodes: readonly AgentPlanNode[];
  readonly edges: readonly AgentPlanEdge[];
  readonly revision?: number;
}

export interface AgentPlan extends AgentPlanInput {
  readonly id: string;
  /** The creator; saving by another person never changes it. */
  readonly ownerId: string;
  readonly projectId: string;
  readonly revision: number;
  /**
   * The department whose members and leaders share the plan, set when the plan is created.
   *
   * @remarks
   * Together with the access to the project it decides who reads, changes and
   * runs the plan besides its owner. Absent or `null` for a plan without a
   * team: one stored before teams, or created by a person with no or several
   * departments. Saving never derives it again.
   */
  readonly departmentId?: string | null;
  /**
   * When Pages deletes this one-time plan, as an ISO 8601 UTC time.
   *
   * @remarks
   * Set only between the successful end of a run and the deletion. It is read
   * from its own column and never stored in the plan graph.
   */
  readonly scheduledDeletionAt?: string | null;
}

/** Current links are derived on read, rather than copied into editable fields. */
export interface AgentPlanView extends AgentPlan {
  /** The registration is gone; the graph remains editable but cannot start until reassigned. */
  readonly isWorkspaceMissing?: boolean;
  /** Whether the person changes and runs the plan: its owner, or a member or leader of its team. */
  readonly canEdit: boolean;
  readonly projectName: string;
  readonly github: WorkspaceGitHub | null;
}

/**
 * A plan as lists and name checks need it: who owns it, where it belongs and
 * whether the person changes it, without its graph.
 *
 * @remarks
 * The editor page carries one summary for every plan the person may read and
 * the whole {@link AgentPlanView} only for the plan it shows.
 */
export interface AgentPlanSummary {
  readonly id: string;
  readonly name: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly workspaceId: string;
  readonly departmentId?: string | null;
  readonly usage: AgentPlanInput["usage"];
  readonly revision: number;
  /** Whether the plan is a one-time plan that Pages deletes after a successful run. */
  readonly oneShot?: boolean;
  /** When Pages deletes the one-time plan, once its run succeeded. */
  readonly scheduledDeletionAt?: string | null;
  /** The registration is gone; the plan remains editable but cannot start until reassigned. */
  readonly isWorkspaceMissing?: boolean;
  readonly canEdit: boolean;
}

/** The source set exposes only readable task metadata, including subtasks. */
export interface AgentPlanTask {
  readonly id: string;
  readonly key: string;
  readonly title: string;
  readonly type: "task" | "subtask";
  readonly parentId: string | null;
  readonly statusKey: string;
  readonly statusName: string;
  /** Whether the ticket's current workflow status counts as done. */
  readonly isDone: boolean;
  /** When the ticket was created, as stored: `YYYY-MM-DD HH:MM:SS` in UTC. */
  readonly createdAt: string;
  /** When the ticket last changed, in the same form as `createdAt`. */
  readonly updatedAt: string;
}

/** A column of the project's Kanban workflow, which the ticket choice filters by. */
export interface AgentPlanPhase {
  /** The stable status key, such as `in_progress`; tickets name it as `statusKey`. */
  readonly key: string;
  readonly name: string;
  readonly isDone: boolean;
}

export interface AgentPlanSources {
  readonly remoteTargets?: readonly AgentPlanRemoteTarget[];
  readonly remoteStatus?: readonly AgentPlanRemoteStatus[];
  readonly models?: readonly PageAgentModel[];
  readonly agents: readonly AgentDefinitionChoice[];
  readonly tasks: readonly AgentPlanTask[];
  /** The workflow of the plan's project in board order; absent before a workspace is chosen. */
  readonly phases?: readonly AgentPlanPhase[];
  /** The configured interpreter profiles of script nodes; absent before a workspace is chosen. */
  readonly interpreters?: readonly AgentPlanInterpreter[];
}

export interface AgentPlanPage {
  readonly userId: string;
  /** The department a plan created now would belong to; `null` when the person has none or several. */
  readonly teamDepartmentId?: string | null;
  readonly control?: AgentPlanControl;
  readonly plans: readonly AgentPlanSummary[];
  readonly workspaces: readonly AgentWorkspaceChoice[];
  /** The remote workspaces the person may see, the remote choices of a plan target. */
  readonly remoteWorkspaces?: readonly AgentPlanRemoteChoice[];
  readonly selected: AgentPlanView | null;
  readonly sources: AgentPlanSources;
  /**
   * The newest run of the person in full, or none.
   *
   * @remarks
   * The further history is listed as {@link AgentPlanRunSummary} entries by
   * its own read endpoint; a run of it is read in full when it is chosen.
   */
  readonly runs: readonly AgentPlanRun[];
  readonly directory: AgentProfileDirectory;
}

/**
 * The state of a node in a run.
 *
 * @remarks
 * `skipped` marks a node on a branch a decision did not activate; it never
 * ran and nothing waits for it.
 */
export type AgentPlanStepStatus =
  | "waiting"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "paused"
  | "skipped";

/** One start of a node whose result an event carried. */
export interface AgentPlanActivationSource {
  readonly stepId: string;
  /** Which start of the node delivered the result. */
  readonly activation: number;
}

/**
 * What started a node again: results of other nodes arrived at its event input.
 *
 * @remarks
 * The prompt is made of those results, which the run already shows; the
 * trigger names the nodes and starts it was made of, and its size. Results
 * that arrive together start the node once, not once each.
 */
export interface AgentPlanActivationTrigger {
  readonly kind: "event";
  readonly sources: readonly AgentPlanActivationSource[];
  readonly promptLength: number;
}

/**
 * The boolean a decision evaluated: the result of one start of one agent, or a boolean parameter.
 *
 * @remarks
 * `sourceKind` is absent for an agent, as in every record before PAGE-286. A
 * parameter is read from the snapshot of the run; its `sourceActivation` is 1.
 */
export interface AgentPlanDecisionInput {
  readonly sourceStepId: string;
  /** Which start of the agent delivered the value. */
  readonly sourceActivation: number;
  readonly value: boolean;
  readonly sourceKind?: "parameter";
}

/** An earlier start of a node that ran again, kept so the rounds of a cycle stay readable. */
export interface AgentPlanStepActivation {
  /** Counts from 1. */
  readonly activation: number;
  readonly status: AgentPlanStepStatus;
  readonly output: string | null;
  readonly error: string | null;
  readonly passed?: boolean;
  readonly branch?: AgentPlanBranch;
  readonly condition?: AgentPlanDecisionInput;
  readonly verdict?: AgentPlanDecisionVerdict;
  readonly trigger?: AgentPlanActivationTrigger;
  readonly startedAt: string | null;
  readonly endedAt: string | null;
}

/** Blocked waiting steps and confirmed cancellations remain distinguishable. */
export interface AgentPlanStepResult {
  readonly assetFailure?: {
    readonly id: string;
    readonly name: string;
    readonly cause: string;
  };
  readonly resourceAccess?: PlanRemoteAccess;
  readonly execution?: AgentPlanStepExecution;
  readonly remote?: AgentPlanRemoteProgress;
  readonly id: string;
  readonly groupId?: string;
  /** Copied from the node when the run starts, so the stored run alone decides its end. */
  readonly role?: AgentPlanStepRole;
  readonly failedStepId?: string;
  /** A failed or cancelled predecessor that prevented this waiting node from running. */
  readonly blockedByStepId?: string;
  readonly name: string;
  readonly status: AgentPlanStepStatus;
  /** A disabled script skipped this step; it succeeded without a process. */
  readonly skipped?: boolean;
  readonly isBlocked: boolean;
  readonly cancellation: "none" | "requested" | "confirmed" | "not_started";
  readonly output: string | null;
  readonly error: string | null;
  /** Why a failed node stopped: the class of its failure and its attempts. */
  readonly failureStop?: AgentPlanFailureStop;
  /** Read-only UI projection indicates that displayed text was filtered or shortened. */
  readonly isDisplayFiltered?: boolean;
  /** Runner, session, process, contract, acceptance and result of an agent node. */
  readonly session?: AgentPlanSessionRecord | null;
  /** A script is an ordinary process, never an agent session. */
  readonly script?: AgentPlanScriptRun;
  /** A declared script report, separate from process exit and the original output. */
  readonly report?: AgentPlanScriptAssessment;
  /** Authorized read-time projection, separate from persisted acceptance. */
  readonly progress?: AgentPlanProgress;
  /**
   * The TODO list the CLI reported as a structured plan in this attempt (PAGE-306).
   *
   * @remarks
   * Absent when the CLI reported none. It is read-only information and never
   * decides the step: `completion` and `completionGate` keep their meaning.
   */
  readonly agentTodos?: AgentPlanAgentTodoList;
  /**
   * Which start of the node this result belongs to, counting from 1.
   *
   * @remarks
   * Absent in runs without a decision or retrigger, where every node ran at
   * most once. Whatever settles a node is accepted only for the start it
   * belongs to, so a late answer of an earlier round never replaces a newer
   * result.
   */
  readonly activation?: number;
  /**
   * The boolean result of an agent a decision reads: `true` when its closing
   * report showed every todo done and every criterion met, `false` when the
   * report was valid but showed unmet work.
   */
  readonly passed?: boolean;
  /** The output a decision activated in this start. */
  readonly branch?: AgentPlanBranch;
  /** The boolean result a decision evaluated in this start, and the start of the agent it came from. */
  readonly condition?: AgentPlanDecisionInput;
  /** What the model of a model decision answered in this start, and why. */
  readonly verdict?: AgentPlanDecisionVerdict;
  /** What started this node again; absent for its first start. */
  readonly trigger?: AgentPlanActivationTrigger;
  /** The earlier starts of the node, oldest first. */
  readonly history?: readonly AgentPlanStepActivation[];
  /** What a stack node handed over in this start; `entryId: null` when it was used up. */
  readonly stack?: AgentPlanStackHandover;
}

/** Only the executor may read this sanitized view or request its stop. */
export interface AgentPlanRun {
  /** Durable command acknowledgement; execution state may still be unchanged. */
  readonly command?: PlanRunCommandReceipt;
  readonly id: string;
  readonly planId: string;
  readonly planName: string;
  readonly planRevision: number;
  readonly userId: string;
  readonly startedAt: string;
  /** Actual terminal decision time; absent in older records without one. */
  readonly endedAt?: string;
  readonly status:
    | "running"
    | "pausing"
    | "paused"
    | "stopping"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "work_done_closeout_open";
  readonly pauseBoundary?: AgentPlanPauseBoundary;
  readonly continuation?: AgentPlanContinuation;
  readonly stopRequested: boolean;
  /** Safe failure of an additional session turn, separate from completed graph results. */
  readonly controlError?: "plan_step_failed";
  /** A running, non-stopped run currently awaits concrete writer admission; other states have no live wait. */
  readonly isWaitingForWorkspace?: boolean;
  readonly workspaceWait?: AgentPlanWriterWait;
  /** Absent in old failed records, which remain terminal; this never authorizes replay. */
  readonly recovery?: AgentPlanRecoveryReason;
  /** The earlier run an explicit restart or resume came from. */
  readonly origin?: AgentPlanRunOrigin;
  /** When somebody first typed into a terminal of the run: the run was intervened in manually (PAGE-265). */
  readonly manualInputAt?: string;
  readonly steps: readonly AgentPlanStepResult[];
  /** The iterations and sessions of the loops of the plan; absent in runs without a loop. */
  readonly loops?: readonly AgentPlanLoopRun[];
  /** What each stack of the plan handed over so far; absent in runs without a stack. */
  readonly stacks?: readonly AgentPlanStackRun[];
}

/** A run of the history list by its start and status, without its snapshot or results. */
export type AgentPlanRunSummary = Pick<
  AgentPlanRun,
  "id" | "startedAt" | "status" | "manualInputAt"
>;

/** Creates an unsaved plan without guessing a workspace or granting other users access. */
export function emptyAgentPlan(): AgentPlanInput {
  return {
    name: "",
    workspaceId: "",
    usage: "private",
    sharing: { isGlobal: false, targets: [], operator: "or" },
    projectId: "",
    globals: {},
    nodes: [],
    edges: [],
  };
}
