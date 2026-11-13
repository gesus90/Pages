import type { AcpProviderId } from "./AgentConfiguration";
import type { AgentPlanExecutionTarget } from "./AgentPlanExecution.js";
import type {
  AgentPlanBinding,
  AgentPlanInput,
  AgentPlanPosition,
} from "./AgentPlan";

/** The most helpers one swarm node has (PAGE-313). */
export const PLAN_SWARM_WORKER_LIMIT = 10;

/** How many helper badges the card shows in one row. */
export const PLAN_SWARM_BADGES_PER_ROW = 5;

/** How often the main model may hand one subtask out again after it failed. */
export const PLAN_SWARM_REASSIGN_LIMIT = 3;

/** How long a helper waits for an ACP place before it counts as not started. */
export const PLAN_SWARM_START_TIMEOUT_MS = 120_000;

/** How long a virtual lock or scope lives without being renewed by a living helper. */
export const PLAN_SWARM_LEASE_MS = 120_000;

/** The time limit of a new swarm node and the bounds of the setting, in minutes. */
export const PLAN_SWARM_TIMEOUT_MINUTES = {
  initial: 60,
  minimum: 1,
  maximum: 1440,
} as const;

/** The longest task text and the longest additional instruction. */
export const PLAN_SWARM_TEXT_LENGTH = {
  task: 200_000,
  instruction: 20_000,
  name: 120,
  directory: 1024,
} as const;

/** The binding that supplies the task of a swarm whose task is a ticket. */
export const PLAN_SWARM_TASK_BINDING = "task";

/**
 * What a helper may do in the shared working directory.
 *
 * @remarks
 * ACP runners know only "Nur Lesen" and YOLO. `workspace_write` runs the CLI
 * so it can write files, but limits its Pages access to reading; `yolo` also
 * gives it every Pages operation of the executor.
 */
export const PLAN_SWARM_ACCESS_MODES = [
  "read_only",
  "workspace_write",
  "yolo",
] as const;

/** One of {@link PLAN_SWARM_ACCESS_MODES}. */
export type AgentPlanSwarmAccess = (typeof PLAN_SWARM_ACCESS_MODES)[number];

/** Connection, model and reasoning, as the model choice of an agent node names them. */
export interface AgentPlanSwarmModel {
  readonly connectionId: string;
  readonly provider: AcpProviderId;
  readonly model: string;
  readonly reasoningEffort: string | null;
}

/** The model and access of one helper, or of every helper. */
export interface AgentPlanSwarmWorker {
  /** `null` until a model is chosen; such a helper cannot start. */
  readonly model: AgentPlanSwarmModel | null;
  readonly access: AgentPlanSwarmAccess;
}

/** Whether every helper uses the same model or each its own. */
export type AgentPlanSwarmWorkerMode = "same" | "individual";

/** Where the task of the swarm comes from. */
export type AgentPlanSwarmTask =
  | { readonly source: "text"; readonly text: string }
  /** The ticket bound as {@link PLAN_SWARM_TASK_BINDING}. */
  | { readonly source: "ticket" };

/** The helpers of a swarm and how their models are chosen. */
export interface AgentPlanSwarmWorkers {
  readonly count: number;
  readonly mode: AgentPlanSwarmWorkerMode;
  /** The configuration every helper uses with `same`. */
  readonly same: AgentPlanSwarmWorker;
  /**
   * The configuration of each helper with `individual`, H1 first.
   *
   * @remarks
   * Kept when the mode is `same`, so switching back restores the choices. A
   * missing entry uses {@link same}.
   */
  readonly individual: readonly AgentPlanSwarmWorker[];
  /** A shared instruction for every helper; absent means none. */
  readonly instruction?: string;
}

/** The main model, which splits, hands out, watches and sums up. */
export interface AgentPlanSwarmMain {
  readonly model: AgentPlanSwarmModel | null;
  /** The access of the main model and the default access of new helpers. */
  readonly access: AgentPlanSwarmAccess;
  /** An additional instruction; absent means none. */
  readonly instruction?: string;
}

/**
 * A swarm node: a main model splits one task at run time among helpers (PAGE-313).
 *
 * @remarks
 * The main model runs in one session, every helper in a session of its own,
 * all in the same working directory on the Pages host. Remote execution
 * targets are refused when the plan is saved.
 */
export interface AgentPlanSwarm extends AgentPlanPosition {
  readonly id: string;
  readonly type: "swarm";
  /** Shown instead of the type name when set. */
  readonly name?: string;
  readonly task: AgentPlanSwarmTask;
  readonly main: AgentPlanSwarmMain;
  readonly workers: AgentPlanSwarmWorkers;
  /** A directory below the plan workspace; absent means its root. */
  readonly directory?: string;
  readonly timeoutMinutes: number;
  readonly executionTarget?: AgentPlanExecutionTarget;
  readonly bindings: Readonly<Record<string, AgentPlanBinding>>;
}

/** Why a swarm node cannot be saved or cannot start. */
export type AgentPlanSwarmIssue =
  | "swarm_remote_unsupported"
  | "swarm_worker_count_invalid"
  | "swarm_timeout_invalid"
  | "swarm_directory_invalid"
  | "swarm_task_missing"
  | "swarm_main_model_missing"
  | "swarm_worker_model_missing";

/** The issues that refuse a save; the others only keep the node from starting. */
export const PLAN_SWARM_SAVE_ISSUES: readonly AgentPlanSwarmIssue[] = [
  "swarm_remote_unsupported",
  "swarm_worker_count_invalid",
  "swarm_timeout_invalid",
  "swarm_directory_invalid",
];

/** The label of a helper: `H1` … `H10`. */
export function planSwarmWorkerLabel(index: number): string {
  return `H${String(index + 1)}`;
}

/** The configuration a helper runs with, by its position from 0. */
export function planSwarmWorkerAt(
  workers: AgentPlanSwarmWorkers,
  index: number,
): AgentPlanSwarmWorker {
  if (workers.mode === "same") return workers.same;
  return workers.individual[index] ?? workers.same;
}

/** The configurations of every helper, H1 first. */
export function planSwarmWorkerList(
  workers: AgentPlanSwarmWorkers,
): readonly AgentPlanSwarmWorker[] {
  return Array.from({ length: workers.count }, (_, index) =>
    planSwarmWorkerAt(workers, index),
  );
}

/**
 * Whether the swarm would run away from the Pages host.
 *
 * @param node - The swarm.
 * @param plan - The plan target a node without its own target inherits.
 */
export function isPlanSwarmRemote(
  node: Pick<AgentPlanSwarm, "executionTarget">,
  plan: Pick<AgentPlanInput, "executionTarget">,
): boolean {
  const target = node.executionTarget ?? plan.executionTarget;
  return target?.kind === "remote";
}

/** Whether a relative directory stays below the workspace: no absolute path, no `..`. */
export function isPlanSwarmDirectory(directory: string): boolean {
  if (directory.length > PLAN_SWARM_TEXT_LENGTH.directory) return false;
  if (directory.startsWith("/") || directory.includes("\\")) return false;
  if (/[\u0000-\u001f\u007f]/u.test(directory)) return false;
  return directory.split("/").every((part) => part !== "..");
}

function structureIssues(node: AgentPlanSwarm): readonly AgentPlanSwarmIssue[] {
  const { count } = node.workers;
  const { timeoutMinutes } = node;
  return [
    ...(!Number.isInteger(count) || count < 1 || count > PLAN_SWARM_WORKER_LIMIT
      ? (["swarm_worker_count_invalid"] as const)
      : []),
    ...(!Number.isInteger(timeoutMinutes) ||
    timeoutMinutes < PLAN_SWARM_TIMEOUT_MINUTES.minimum ||
    timeoutMinutes > PLAN_SWARM_TIMEOUT_MINUTES.maximum
      ? (["swarm_timeout_invalid"] as const)
      : []),
    ...(node.directory !== undefined && !isPlanSwarmDirectory(node.directory)
      ? (["swarm_directory_invalid"] as const)
      : []),
  ];
}

function readinessIssues(node: AgentPlanSwarm): readonly AgentPlanSwarmIssue[] {
  const hasTask =
    node.task.source === "text"
      ? node.task.text.trim().length > 0
      : node.bindings[PLAN_SWARM_TASK_BINDING] !== undefined;
  const isWorkerMissing = planSwarmWorkerList(node.workers).some(
    (worker) => worker.model === null,
  );
  return [
    ...(hasTask ? [] : (["swarm_task_missing"] as const)),
    ...(node.main.model ? [] : (["swarm_main_model_missing"] as const)),
    ...(isWorkerMissing ? (["swarm_worker_model_missing"] as const) : []),
  ];
}

/**
 * Lists every problem of a swarm node.
 *
 * @param node - The swarm.
 * @param plan - The plan whose target the node inherits.
 * @returns The issues; those of {@link PLAN_SWARM_SAVE_ISSUES} refuse a save.
 */
export function planSwarmIssues(
  node: AgentPlanSwarm,
  plan: Pick<AgentPlanInput, "executionTarget">,
): readonly AgentPlanSwarmIssue[] {
  return [
    ...(isPlanSwarmRemote(node, plan)
      ? (["swarm_remote_unsupported"] as const)
      : []),
    ...structureIssues(node),
    ...readinessIssues(node),
  ];
}

/** The first issue that refuses a save, or `null`. */
export function planSwarmSaveIssue(
  node: AgentPlanSwarm,
  plan: Pick<AgentPlanInput, "executionTarget">,
): AgentPlanSwarmIssue | null {
  return (
    planSwarmIssues(node, plan).find((issue) =>
      PLAN_SWARM_SAVE_ISSUES.includes(issue),
    ) ?? null
  );
}

/** A new swarm with one helper less than the badge row and no models chosen yet. */
export function newPlanSwarm(
  base: AgentPlanPosition & { readonly id: string },
): AgentPlanSwarm {
  const worker: AgentPlanSwarmWorker = { model: null, access: "read_only" };
  return {
    ...base,
    type: "swarm",
    task: { source: "text", text: "" },
    main: { model: null, access: "read_only" },
    workers: { count: 3, mode: "same", same: worker, individual: [] },
    timeoutMinutes: PLAN_SWARM_TIMEOUT_MINUTES.initial,
    bindings: {},
  };
}
