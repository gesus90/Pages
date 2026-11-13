import { z } from "zod";

import {
  AGENT_TODO_LIMIT,
  AGENT_TODO_STATUSES,
  AGENT_TODO_TEXT_LENGTH,
} from "./AgentPlanAgentTodos";
import {
  PLAN_SWARM_ACCESS_MODES,
  PLAN_SWARM_WORKER_LIMIT,
} from "./AgentPlanSwarm";
import {
  PLAN_SWARM_PATH_LENGTH,
  PLAN_SWARM_SCOPE_PATHS,
} from "./AgentPlanSwarmScope";

/** The most subtasks one swarm run keeps. */
export const PLAN_SWARM_TASK_LIMIT = 200;

/** The most violations one swarm run keeps; older ones are dropped first. */
export const PLAN_SWARM_VIOLATION_LIMIT = 100;

/** The most files one violation names. */
export const PLAN_SWARM_VIOLATION_FILES = 200;

/** The longest text of a subtask, a result or a summary that a run keeps. */
export const PLAN_SWARM_RUN_TEXT = 20_000;

/**
 * Where a helper stands.
 *
 * @remarks
 * `idle` is free for the next subtask, `starting` waits for its session,
 * `busy` works on a subtask. `not_started` could not get a session, for
 * instance for lack of ACP capacity; it never fails the node.
 */
export const PLAN_SWARM_WORKER_STATUSES = [
  "idle",
  "starting",
  "busy",
  "done",
  "failed",
  "not_started",
] as const;

/** One of {@link PLAN_SWARM_WORKER_STATUSES}. */
export type AgentPlanSwarmWorkerStatus =
  (typeof PLAN_SWARM_WORKER_STATUSES)[number];

/** Where one subtask of the board stands. */
export const PLAN_SWARM_TASK_STATUSES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
] as const;

/** One of {@link PLAN_SWARM_TASK_STATUSES}. */
export type AgentPlanSwarmTaskStatus =
  (typeof PLAN_SWARM_TASK_STATUSES)[number];

const text = (maximum: number): z.ZodString => z.string().max(maximum);
const workerId = z.string().regex(/^H(?:[1-9]|10)$/u);
const paths = z.array(text(PLAN_SWARM_PATH_LENGTH)).max(PLAN_SWARM_SCOPE_PATHS);

const todoSchema = z.strictObject({
  id: text(20),
  text: text(AGENT_TODO_TEXT_LENGTH),
  status: z.enum(AGENT_TODO_STATUSES),
  updatedAt: text(40),
});

const todosSchema = z.array(todoSchema).max(AGENT_TODO_LIMIT);

/** One subtask on the board of a swarm run. */
export const planSwarmTaskSchema = z.strictObject({
  id: text(40),
  /** The helper working on it now, or the last one that did. */
  workerId: workerId.nullable(),
  /** The helper the main model asked for; `null` means the next free one. */
  requestedWorkerId: workerId.nullable(),
  instruction: text(PLAN_SWARM_RUN_TEXT),
  scope: paths,
  status: z.enum(PLAN_SWARM_TASK_STATUSES),
  /** How often it was handed out, the first time included. */
  attempts: z.number().int().min(0).max(10),
  result: text(PLAN_SWARM_RUN_TEXT).nullable(),
  error: text(200).nullable(),
  startedAt: text(40).nullable(),
  endedAt: text(40).nullable(),
});

/** One subtask on the board of a swarm run. */
export type AgentPlanSwarmTaskView = z.infer<typeof planSwarmTaskSchema>;

/** One helper of a swarm run, as its lane shows it. */
export const planSwarmWorkerSchema = z.strictObject({
  id: workerId,
  provider: text(40),
  model: text(200),
  access: z.enum(PLAN_SWARM_ACCESS_MODES),
  status: z.enum(PLAN_SWARM_WORKER_STATUSES),
  taskId: text(40).nullable(),
  /** Why it failed or did not start, such as `acp_worker_limit`. */
  reason: text(200).nullable(),
  locks: paths,
  todos: todosSchema,
});

/** One helper of a swarm run, as its lane shows it. */
export type AgentPlanSwarmWorkerView = z.infer<typeof planSwarmWorkerSchema>;

/**
 * A change Pages found outside the areas and locks of the active helpers.
 *
 * @remarks
 * `outside` names files; `head` and `index` report a changed Git `HEAD` or
 * index, which no helper may change. When the cause is unclear, `workerIds`
 * names every helper that was active in the period.
 */
export const planSwarmViolationSchema = z.strictObject({
  kind: z.enum(["outside", "head", "index"]),
  taskId: text(40).nullable(),
  workerIds: z.array(workerId).max(PLAN_SWARM_WORKER_LIMIT),
  files: z.array(text(PLAN_SWARM_PATH_LENGTH)).max(PLAN_SWARM_VIOLATION_FILES),
  at: text(40),
});

/** A change Pages found outside the areas and locks of the active helpers. */
export type AgentPlanSwarmViolation = z.infer<typeof planSwarmViolationSchema>;

/** The lane of the main model. */
export const planSwarmMainSchema = z.strictObject({
  provider: text(40),
  model: text(200),
  /** What the main model does now, as it reported it. */
  activity: text(200).nullable(),
  todos: todosSchema,
});

/**
 * Main model, helpers, board and summary of one swarm node in a run (PAGE-313).
 *
 * @remarks
 * Stored with the node result, so `read_plan_run` and the run view read the
 * main model and every helper apart from each other.
 */
export const planSwarmRunSchema = z.strictObject({
  main: planSwarmMainSchema,
  workers: z.array(planSwarmWorkerSchema).max(PLAN_SWARM_WORKER_LIMIT),
  tasks: z.array(planSwarmTaskSchema).max(PLAN_SWARM_TASK_LIMIT),
  violations: z.array(planSwarmViolationSchema).max(PLAN_SWARM_VIOLATION_LIMIT),
  summary: text(PLAN_SWARM_RUN_TEXT).nullable(),
  outcome: z.enum(["running", "succeeded", "failed"]),
});

/** Main model, helpers, board and summary of one swarm node in a run. */
export type AgentPlanSwarmRun = z.infer<typeof planSwarmRunSchema>;

/** How many subtasks are finished and how many were handed out, as the card pill shows it. */
export function planSwarmTaskCounts(run: Pick<AgentPlanSwarmRun, "tasks">): {
  readonly finished: number;
  readonly assigned: number;
} {
  return {
    finished: run.tasks.filter(
      (task) => task.status === "done" || task.status === "failed",
    ).length,
    assigned: run.tasks.filter((task) => task.status !== "cancelled").length,
  };
}
