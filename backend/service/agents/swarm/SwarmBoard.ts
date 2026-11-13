import {
  PLAN_SWARM_REASSIGN_LIMIT,
  planSwarmWorkerLabel,
} from "@/definition/AgentPlanSwarm";
import { planSwarmScopeOverlaps } from "@/definition/AgentPlanSwarmScope";
import {
  PLAN_SWARM_RUN_TEXT,
  PLAN_SWARM_TASK_LIMIT,
  PLAN_SWARM_VIOLATION_LIMIT,
} from "@/definition/AgentPlanSwarmRun";

import type {
  AgentPlanSwarmTaskView,
  AgentPlanSwarmViolation,
  AgentPlanSwarmWorkerView,
} from "@/definition/AgentPlanSwarmRun";

/** Why the board refused an assignment; nothing changed. */
export type SwarmAssignRefusal =
  | "swarm_scope_invalid"
  | "swarm_scope_overlap"
  | "swarm_worker_unknown"
  | "swarm_task_unknown"
  | "swarm_task_done"
  | "swarm_task_active"
  | "swarm_reassign_limit"
  | "swarm_task_limit";

/** An assignment the main model asked for. */
export interface SwarmAssignRequest {
  readonly instruction: string;
  /** `null` asks for the next free helper. */
  readonly workerId: string | null;
  readonly scope: readonly string[];
  /** Hands out a failed or cancelled subtask again instead of a new one. */
  readonly taskId: string | null;
}

/** The outcome of an assignment: the subtask, or why nothing changed. */
export type SwarmAssignOutcome =
  | { readonly status: "assigned"; readonly task: AgentPlanSwarmTaskView }
  | {
      readonly status: "refused";
      readonly code: SwarmAssignRefusal;
      readonly details?: Readonly<Record<string, unknown>>;
    };

/** The board as it is stored: subtasks, helpers without TODOs, violations. */
export interface SwarmBoardState {
  readonly tasks: readonly AgentPlanSwarmTaskView[];
  readonly workers: readonly AgentPlanSwarmWorkerView[];
  readonly violations: readonly AgentPlanSwarmViolation[];
}

const ACTIVE_TASK = new Set<AgentPlanSwarmTaskView["status"]>([
  "queued",
  "running",
]);

function clip(text: string): string {
  return text.length > PLAN_SWARM_RUN_TEXT
    ? text.slice(0, PLAN_SWARM_RUN_TEXT)
    : text;
}

/**
 * The task board of one swarm node (PAGE-313): subtasks, helpers and violations.
 *
 * @remarks
 * Every method changes the board completely or not at all: a refused
 * assignment leaves every subtask and helper as it was. A subtask is handed
 * out at most {@link PLAN_SWARM_REASSIGN_LIMIT} times again, a finished one
 * never, so no work is done twice.
 */
export class SwarmBoard {
  private tasks: AgentPlanSwarmTaskView[];
  private workers: AgentPlanSwarmWorkerView[];
  private violations: AgentPlanSwarmViolation[];
  private nextNumber: number;

  /** Creates a board from its stored state. */
  public constructor(state: SwarmBoardState) {
    this.tasks = [...state.tasks];
    this.workers = [...state.workers];
    this.violations = [...state.violations];
    this.nextNumber =
      Math.max(0, ...this.tasks.map((task) => Number(task.id.slice(1)) || 0)) +
      1;
  }

  /**
   * The board of a resumed run.
   *
   * @remarks
   * Helper sessions are never revived: a running subtask goes back on the
   * board, waiting, and every helper is free without locks. Finished
   * subtasks stay finished and never run again.
   */
  public static resumed(state: SwarmBoardState): SwarmBoard {
    return new SwarmBoard({
      tasks: state.tasks.map((task) =>
        task.status === "running"
          ? { ...task, status: "queued", workerId: null, startedAt: null }
          : task,
      ),
      workers: state.workers.map((worker) => ({
        ...worker,
        status: "idle",
        taskId: null,
        reason: null,
        locks: [],
      })),
      violations: state.violations,
    });
  }

  /** The stored form of the board. */
  public state(): SwarmBoardState {
    return {
      tasks: [...this.tasks],
      workers: [...this.workers],
      violations: [...this.violations],
    };
  }

  /** One helper by its label. */
  public worker(workerId: string): AgentPlanSwarmWorkerView | undefined {
    return this.workers.find((worker) => worker.id === workerId);
  }

  /** One subtask by its identifier. */
  public task(taskId: string): AgentPlanSwarmTaskView | undefined {
    return this.tasks.find((task) => task.id === taskId);
  }

  /** The subtasks that wait for a helper, oldest first. */
  public queued(): readonly AgentPlanSwarmTaskView[] {
    return this.tasks.filter((task) => task.status === "queued");
  }

  /** The subtasks that wait or run. */
  public active(): readonly AgentPlanSwarmTaskView[] {
    return this.tasks.filter((task) => ACTIVE_TASK.has(task.status));
  }

  /**
   * Puts a new subtask on the board, or a failed one again.
   *
   * @param request - What the main model asked for, its area already normalized.
   * @returns The waiting subtask; the coordinator hands it to a helper.
   */
  public assign(request: SwarmAssignRequest): SwarmAssignOutcome {
    if (request.workerId !== null && !this.worker(request.workerId))
      return { status: "refused", code: "swarm_worker_unknown" };
    const overlaps = planSwarmScopeOverlaps(
      request.scope,
      this.active()
        .filter((task) => task.id !== request.taskId)
        .map((task) => ({ owner: task.id, scope: task.scope })),
    );
    if (overlaps.length > 0)
      return {
        status: "refused",
        code: "swarm_scope_overlap",
        details: { overlaps },
      };
    return request.taskId === null
      ? this.addTask(request)
      : this.reassign(request.taskId, request);
  }

  /** Marks a helper as the one working on a waiting subtask. */
  public start(taskId: string, workerId: string, at: string): void {
    this.updateTask(taskId, {
      status: "running",
      workerId,
      startedAt: at,
      endedAt: null,
      error: null,
    });
    this.updateWorker(workerId, { status: "busy", taskId, reason: null });
  }

  /** Marks a helper as waiting for its session. */
  public starting(workerId: string, taskId: string): void {
    this.updateTask(taskId, { workerId });
    this.updateWorker(workerId, { status: "starting", taskId, reason: null });
  }

  /**
   * Records a helper that could not get a session.
   *
   * @remarks
   * The subtask fails without counting as an attempt, so the main model can
   * hand it to another helper; the node never fails for it.
   */
  public notStarted(workerId: string, taskId: string, reason: string): void {
    const task = this.task(taskId);
    this.updateWorker(workerId, {
      status: "not_started",
      taskId: null,
      reason,
    });
    if (!task) return;
    this.updateTask(taskId, {
      status: "failed",
      workerId,
      attempts: Math.max(0, task.attempts - 1),
      error: `not_started:${reason}`.slice(0, 200),
    });
  }

  /** Records the end of a subtask and frees its helper. */
  public finish(
    taskId: string,
    outcome: {
      readonly status: "done" | "failed" | "cancelled";
      readonly result: string | null;
      readonly error: string | null;
      readonly at: string;
    },
  ): void {
    const task = this.task(taskId);
    if (!task || !ACTIVE_TASK.has(task.status)) return;
    this.updateTask(taskId, {
      status: outcome.status,
      result: outcome.result === null ? null : clip(outcome.result),
      error: outcome.error,
      endedAt: outcome.at,
    });
    if (task.workerId === null) return;
    this.updateWorker(task.workerId, {
      status: outcome.status === "failed" ? "failed" : "idle",
      taskId: null,
      reason: outcome.status === "failed" ? outcome.error : null,
      locks: [],
    });
  }

  /** Shows the locks a helper holds in its lane. */
  public showLocks(workerId: string, locks: readonly string[]): void {
    this.updateWorker(workerId, { locks: [...locks] });
  }

  /** Shows the TODO list a helper reported. */
  public showTodos(
    workerId: string,
    todos: readonly AgentPlanSwarmWorkerView["todos"][number][],
  ): void {
    this.updateWorker(workerId, { todos: [...todos] });
  }

  /** Keeps a violation, dropping the oldest beyond the limit. */
  public report(violation: AgentPlanSwarmViolation): void {
    this.violations = [...this.violations, violation].slice(
      -PLAN_SWARM_VIOLATION_LIMIT,
    );
  }

  /** The helpers that can take a subtask now, H1 first. */
  public freeWorkers(): readonly AgentPlanSwarmWorkerView[] {
    return this.workers.filter(
      (worker) => worker.status === "idle" || worker.status === "failed",
    );
  }

  private addTask(request: SwarmAssignRequest): SwarmAssignOutcome {
    if (this.tasks.length >= PLAN_SWARM_TASK_LIMIT)
      return { status: "refused", code: "swarm_task_limit" };
    const task: AgentPlanSwarmTaskView = {
      id: `T${String(this.nextNumber)}`,
      workerId: null,
      requestedWorkerId: request.workerId,
      instruction: clip(request.instruction),
      scope: [...request.scope],
      status: "queued",
      attempts: 1,
      result: null,
      error: null,
      startedAt: null,
      endedAt: null,
    };
    this.nextNumber += 1;
    this.tasks.push(task);
    return { status: "assigned", task };
  }

  private reassign(
    taskId: string,
    request: SwarmAssignRequest,
  ): SwarmAssignOutcome {
    const task = this.task(taskId);
    if (!task) return { status: "refused", code: "swarm_task_unknown" };
    if (task.status === "done")
      return { status: "refused", code: "swarm_task_done" };
    if (ACTIVE_TASK.has(task.status))
      return { status: "refused", code: "swarm_task_active" };
    if (task.attempts > PLAN_SWARM_REASSIGN_LIMIT)
      return { status: "refused", code: "swarm_reassign_limit" };
    const next: AgentPlanSwarmTaskView = {
      ...task,
      status: "queued",
      workerId: null,
      requestedWorkerId: request.workerId,
      instruction: request.instruction
        ? clip(request.instruction)
        : task.instruction,
      scope: [...request.scope],
      attempts: task.attempts + 1,
      error: null,
      startedAt: null,
      endedAt: null,
    };
    this.tasks = this.tasks.map((entry) =>
      entry.id === taskId ? next : entry,
    );
    return { status: "assigned", task: next };
  }

  private updateTask(
    taskId: string,
    changes: Partial<AgentPlanSwarmTaskView>,
  ): void {
    this.tasks = this.tasks.map((task) =>
      task.id === taskId ? { ...task, ...changes } : task,
    );
  }

  private updateWorker(
    workerId: string,
    changes: Partial<AgentPlanSwarmWorkerView>,
  ): void {
    this.workers = this.workers.map((worker) =>
      worker.id === workerId ? { ...worker, ...changes } : worker,
    );
  }
}

/** The helpers of a new board, all free, by their configuration. */
export function newSwarmWorkers(
  workers: readonly {
    readonly provider: string;
    readonly model: string;
    readonly access: AgentPlanSwarmWorkerView["access"];
  }[],
): readonly AgentPlanSwarmWorkerView[] {
  return workers.map((worker, index) => ({
    id: planSwarmWorkerLabel(index),
    provider: worker.provider,
    model: worker.model,
    access: worker.access,
    status: "idle",
    taskId: null,
    reason: null,
    locks: [],
    todos: [],
  }));
}
