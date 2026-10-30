import type { AgentPlanWriterWait } from "./AgentPlanExecution";
import type { AgentPlanCompletionGate } from "./AgentPlanWork";
import type {
  AgentPlanExecutionTarget,
  AgentPlanRemoteTarget,
  AgentPlanStepExecution,
  AgentPlanRemoteProgress,
} from "./AgentPlanExecution";
import type { AgentPlanProgress } from "./AgentPlanProgress";
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
import type {
  AgentPlanRemoteStatus,
  AgentPlanRemoteChoice,
} from "./AgentPlanTarget";
import type {
  AgentPlanInterpreter,
  AgentPlanScript,
  AgentPlanScriptRun,
} from "./AgentPlanScript";
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
 */
export type AgentPlanBinding =
  | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
  | { readonly kind: "source"; readonly nodeId: string }
  | { readonly kind: "result"; readonly stepId: string }
  | { readonly kind: "previous"; readonly stepId: string };

export interface AgentPlanPosition {
  readonly x: number;
  readonly y: number;
}

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
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** One named value; numbers retain their numeric type while JSON uses a text port. */
export interface AgentPlanParameter extends AgentPlanPosition {
  readonly id: string;
  readonly type: "parameter";
  readonly name: string;
  readonly format: "string" | "number" | "json";
  readonly value: AgentParameterValue;
}

/** Source nodes provide input; they never create an execution dependency. */
export type AgentPlanNode =
  | AgentPlanStep
  | AgentPlanScript
  | AgentPlanGroup
  | AgentPlanLoop
  | AgentPlanParameter
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
  readonly plans: readonly AgentPlanView[];
  readonly workspaces: readonly AgentWorkspaceChoice[];
  /** The remote workspaces the person may see, the remote choices of a plan target. */
  readonly remoteWorkspaces?: readonly AgentPlanRemoteChoice[];
  readonly selected: AgentPlanView | null;
  readonly sources: AgentPlanSources;
  readonly runs: readonly AgentPlanRun[];
  readonly directory: AgentProfileDirectory;
}

export type AgentPlanStepStatus =
  "waiting" | "running" | "succeeded" | "failed" | "cancelled" | "paused";

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
  readonly failedStepId?: string;
  /** A failed or cancelled predecessor that prevented this waiting node from running. */
  readonly blockedByStepId?: string;
  readonly name: string;
  readonly status: AgentPlanStepStatus;
  readonly isBlocked: boolean;
  readonly cancellation: "none" | "requested" | "confirmed" | "not_started";
  readonly output: string | null;
  readonly error: string | null;
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
}

/** Only the executor may read this sanitized view or request its stop. */
export interface AgentPlanRun {
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
    | "cancelled";
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
  readonly steps: readonly AgentPlanStepResult[];
  /** The iterations and sessions of the loops of the plan; absent in runs without a loop. */
  readonly loops?: readonly AgentPlanLoopRun[];
}

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
