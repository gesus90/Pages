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
import type { AgentPlanRecoveryReason } from "./AgentPlanRecovery";

/** Plan sources and execution dependencies are deliberately separate contracts. */
export type AgentPlanBinding =
  | { readonly kind: "literal"; readonly value: AgentParameterValue | null }
  | { readonly kind: "source"; readonly nodeId: string }
  | { readonly kind: "result"; readonly stepId: string };

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
  /** Absent only in plans saved before independent node configurations. */
  readonly configuration?: AgentPlanConfiguration;
  /** Absent means `report`, the completion of every node before this field existed. */
  readonly completion?: AgentPlanCompletion;
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
  | AgentPlanGroup
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
  readonly globals: Readonly<Record<string, string>>;
  readonly nodes: readonly AgentPlanNode[];
  readonly edges: readonly AgentPlanEdge[];
  readonly revision?: number;
}

export interface AgentPlan extends AgentPlanInput {
  readonly id: string;
  readonly ownerId: string;
  readonly projectId: string;
  readonly revision: number;
}

/** Current links are derived on read, rather than copied into editable fields. */
export interface AgentPlanView extends AgentPlan {
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
}

export interface AgentPlanSources {
  readonly models?: readonly PageAgentModel[];
  readonly agents: readonly AgentDefinitionChoice[];
  readonly tasks: readonly AgentPlanTask[];
}

export interface AgentPlanPage {
  readonly userId: string;
  readonly plans: readonly AgentPlanView[];
  readonly workspaces: readonly AgentWorkspaceChoice[];
  readonly selected: AgentPlanView | null;
  readonly sources: AgentPlanSources;
  readonly runs: readonly AgentPlanRun[];
  readonly directory: AgentProfileDirectory;
}

export type AgentPlanStepStatus =
  "waiting" | "running" | "succeeded" | "failed" | "cancelled" | "paused";

/** Blocked waiting steps and confirmed cancellations remain distinguishable. */
export interface AgentPlanStepResult {
  readonly id: string;
  readonly groupId?: string;
  readonly failedStepId?: string;
  readonly name: string;
  readonly status: AgentPlanStepStatus;
  readonly isBlocked: boolean;
  readonly cancellation: "none" | "requested" | "confirmed" | "not_started";
  readonly output: string | null;
  readonly error: string | null;
  /** Runner, session, process, contract, acceptance and result of an agent node. */
  readonly session?: AgentPlanSessionRecord | null;
}

/** Only the executor may read this sanitized view or request its stop. */
export interface AgentPlanRun {
  readonly id: string;
  readonly planId: string;
  readonly planName: string;
  readonly planRevision: number;
  readonly userId: string;
  readonly startedAt: string;
  readonly status: "running" | "succeeded" | "failed" | "cancelled" | "paused";
  readonly stopRequested: boolean;
  /** Absent in old failed records, which remain terminal; this never authorizes replay. */
  readonly recovery?: AgentPlanRecoveryReason;
  readonly steps: readonly AgentPlanStepResult[];
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
