import { logCaughtError } from "@/backend/logging/Logger";
import {
  normalizePlanSwarmPath,
  readPlanSwarmScope,
} from "@/definition/AgentPlanSwarmScope";

import { SwarmAllowances } from "./SwarmAllowances";
import { SwarmBoard, newSwarmWorkers } from "./SwarmBoard";
import { SwarmLockTable } from "./SwarmLocks";
import { swarmWorkerPrompt } from "./SwarmPrompts";
import { SwarmStartError } from "./SwarmPorts";

import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type {
  AgentPlanSwarmRun,
  AgentPlanSwarmTaskView,
  AgentPlanSwarmWorkerView,
} from "@/definition/AgentPlanSwarmRun";
import type { SwarmAssignOutcome } from "./SwarmBoard";
import type { SwarmLock, SwarmLockOutcome } from "./SwarmLocks";
import type {
  SwarmCoordinatorDependencies,
  SwarmStoredBoard,
  SwarmTurn,
  SwarmWorkerSession,
} from "./SwarmPorts";
import type { SwarmWorkspaceState } from "./SwarmWorkspaceState";

/** The models of a swarm and what its helpers share. */
export interface SwarmCoordinatorInput {
  readonly main: { readonly provider: string; readonly model: string };
  readonly workers: readonly {
    readonly provider: string;
    readonly model: string;
    readonly access: AgentPlanSwarmWorkerView["access"];
  }[];
  readonly instruction: string | null;
  /** The board of an earlier run that is resumed; `null` starts empty. */
  readonly stored: SwarmStoredBoard | null;
  /** Ends every helper when the node stops. */
  readonly signal: AbortSignal;
}

/** How the main model ended the node. */
export interface SwarmFinish {
  readonly status: "succeeded" | "failed";
  readonly summary: string;
}

/** A refusal a tool reports to the model; nothing changed. */
export interface SwarmRefusal {
  readonly status: "refused";
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

function refused(code: string): SwarmRefusal {
  return { status: "refused", code };
}

function failedTurn(errorCode: string): SwarmTurn {
  return { output: "", failure: "failed", errorCode };
}

function errorText(turn: SwarmTurn): string {
  if (turn.failure === "timeout") return "swarm_worker_timeout";
  return (turn.errorCode ?? "swarm_worker_failed").slice(0, 200);
}

/**
 * Runs the board, the locks and the helper sessions of one swarm node (PAGE-313).
 *
 * @remarks
 * Every tool call answers at once; nothing here waits for capacity or for a
 * lock. Board and locks change synchronously, so two calls never interleave
 * inside a change. A helper session starts at its first subtask. When a
 * subtask ends, is cancelled or its helper crashes, the helper's locks are
 * released and its period is checked against the areas and locks of every
 * helper active in it. A failing helper never fails the node: only
 * {@link finish}, the time limit or the loss of the main session do.
 */
export class SwarmCoordinator {
  public readonly finished: Promise<SwarmFinish>;
  private readonly dependencies: SwarmCoordinatorDependencies;
  private readonly input: SwarmCoordinatorInput;
  private readonly board: SwarmBoard;
  private readonly locks: SwarmLockTable;
  private readonly allowances = new SwarmAllowances();
  private readonly sessions = new Map<string, SwarmWorkerSession>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly pending = new Set<Promise<void>>();
  private readonly waiters = new Set<() => void>();
  private main: AgentPlanSwarmRun["main"];
  private summary: string | null = null;
  private outcome: AgentPlanSwarmRun["outcome"] = "running";
  private saving: Promise<void> = Promise.resolve();
  private changes = 0;
  private readonly finishing: { resolve: (finish: SwarmFinish) => void } = {
    resolve: () => undefined,
  };

  /** Creates the coordinator from the configuration or the stored board. */
  public constructor(
    input: SwarmCoordinatorInput,
    dependencies: SwarmCoordinatorDependencies,
  ) {
    this.input = input;
    this.dependencies = dependencies;
    this.locks = new SwarmLockTable(dependencies.now, dependencies.leaseMs);
    this.board = input.stored
      ? SwarmBoard.resumed(input.stored.view)
      : new SwarmBoard({
          tasks: [],
          workers: newSwarmWorkers(input.workers),
          violations: [],
        });
    this.main = {
      provider: input.main.provider,
      model: input.main.model,
      activity: null,
      todos: [],
    };
    this.finished = new Promise((resolve) => {
      this.finishing.resolve = resolve;
    });
  }

  /** The lanes, board, violations and summary as the run shows them. */
  public view(): AgentPlanSwarmRun {
    const state = this.board.state();
    return {
      main: this.main,
      workers: [...state.workers],
      tasks: [...state.tasks],
      violations: [...state.violations],
      summary: this.summary,
      outcome: this.outcome,
    };
  }

  /** Counts every change of the board, so a caller can tell whether anything happened since. */
  public version(): number {
    return this.changes;
  }

  /** Whether a helper works on a subtask now; only then do its tools act. */
  public isWorkerActive(workerId: string): boolean {
    const worker = this.board.worker(workerId);
    return (
      worker?.status === "busy" ||
      (worker?.status === "starting" && worker.taskId !== null)
    );
  }

  /** `swarm_assign`: puts a subtask on the board and hands it to a free helper. */
  public assign(request: {
    readonly instruction: string;
    readonly workerId: string | null;
    readonly scope: readonly string[];
    readonly taskId: string | null;
  }): SwarmAssignOutcome | SwarmRefusal {
    if (this.outcome !== "running") return refused("swarm_finished");
    const scope = readPlanSwarmScope(request.scope);
    if (scope === null) return refused("swarm_scope_invalid");
    if (request.taskId === null && !request.instruction.trim())
      return refused("swarm_instruction_missing");
    const outcome = this.board.assign({ ...request, scope });
    if (outcome.status === "assigned") {
      this.dispatch();
      this.changed();
    }
    return outcome;
  }

  /** `swarm_result`: one subtask with its result. */
  public result(taskId: string): AgentPlanSwarmTaskView | SwarmRefusal {
    return this.board.task(taskId) ?? refused("swarm_task_unknown");
  }

  /** `swarm_cancel`: cancels a waiting or running subtask. */
  public cancel(
    taskId: string,
  ): { readonly status: "cancelled" } | SwarmRefusal {
    const task = this.board.task(taskId);
    if (!task) return refused("swarm_task_unknown");
    const controller = this.controllers.get(taskId);
    if (task.status === "queued" && !controller) {
      this.board.finish(taskId, {
        status: "cancelled",
        result: null,
        error: null,
        at: this.isoNow(),
      });
      this.changed();
      return { status: "cancelled" };
    }
    if (!controller) return refused("swarm_task_inactive");
    controller.abort();
    return { status: "cancelled" };
  }

  /** `swarm_finish`: ends the node with the summary of the main model. */
  public finish(
    finish: SwarmFinish,
  ): { readonly status: "finished" } | SwarmRefusal {
    if (this.outcome !== "running") return refused("swarm_finished");
    this.outcome = finish.status;
    this.summary = finish.summary;
    this.changed();
    this.finishing.resolve(finish);
    return { status: "finished" };
  }

  /** `swarm_lock`: locks a file for a busy helper, at once or not at all. */
  public lock(workerId: string, file: string): SwarmLockOutcome | SwarmRefusal {
    if (!this.isWorkerActive(workerId)) return refused("swarm_worker_inactive");
    const path = normalizePlanSwarmPath(file);
    if (path === null || path === "") return refused("swarm_path_invalid");
    const area = this.board
      .active()
      .find(
        (task) =>
          task.status === "running" &&
          task.workerId !== workerId &&
          task.scope.some(
            (entry) =>
              path === entry || path.startsWith(`${entry}/`) || entry === "",
          ),
      );
    if (area?.workerId) return { status: "taken", path, owner: area.workerId };
    const outcome = this.locks.lock(workerId, path);
    if (outcome.status === "locked") {
      this.allowances.add({ workerId, scope: [], locks: [path] });
      this.board.showLocks(workerId, this.locks.held(workerId));
      this.changed();
    }
    return outcome;
  }

  /** `swarm_unlock`: releases a lock of a busy helper. */
  public unlock(
    workerId: string,
    file: string,
  ): { readonly status: "unlocked" | "not_held" } | SwarmRefusal {
    if (!this.isWorkerActive(workerId)) return refused("swarm_worker_inactive");
    const path = normalizePlanSwarmPath(file) ?? "";
    const isHeld = this.locks.unlock(workerId, path);
    this.board.showLocks(workerId, this.locks.held(workerId));
    this.changed();
    return { status: isHeld ? "unlocked" : "not_held" };
  }

  /** `swarm_locks`: who holds which lock. */
  public listLocks(): readonly SwarmLock[] {
    return this.locks.list();
  }

  /**
   * Waits for the next change of the board, at most the given time.
   *
   * @remarks
   * `swarm_status` uses it so the main model need not poll; it never waits
   * longer than the time it asked for.
   */
  public waitForChange(
    milliseconds: number,
    signal: AbortSignal,
  ): Promise<void> {
    if (milliseconds <= 0 || this.outcome !== "running")
      return Promise.resolve();
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer);
        this.waiters.delete(done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, milliseconds);
      this.waiters.add(done);
      signal.addEventListener("abort", done, { once: true });
    });
  }

  /** Whether any subtask waits or runs. */
  public hasActiveTasks(): boolean {
    return this.board.active().length > 0;
  }

  /** Shows what the main model does now. */
  public showMainActivity(activity: string | null): void {
    this.main = { ...this.main, activity: activity?.slice(0, 200) ?? null };
    this.changed();
  }

  /** Shows the TODO list the main model reported. */
  public showMainTodos(todos: readonly AgentPlanAgentTodo[]): void {
    this.main = { ...this.main, todos: [...todos] };
    this.changed();
  }

  /** Extends the locks of every busy helper; called periodically while the node runs. */
  public renewLeases(): void {
    for (const worker of this.board.state().workers)
      if (this.isWorkerActive(worker.id)) this.locks.renew(worker.id);
    const expired = this.locks.expire();
    for (const owner of expired) this.board.showLocks(owner, []);
    if (expired.length > 0) this.changed();
  }

  /**
   * Ends every helper and releases everything; the board keeps its state.
   *
   * @remarks
   * A helper ended here can no longer act: it is no longer busy, so its
   * tools are refused, and its session is closed.
   */
  public async shutdown(): Promise<void> {
    for (const controller of this.controllers.values()) controller.abort();
    await Promise.allSettled([...this.pending]);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    await Promise.allSettled(sessions.map((session) => session.close()));
    this.locks.clear();
    for (const task of this.board.queued())
      this.board.finish(task.id, {
        status: "cancelled",
        result: null,
        error: null,
        at: this.isoNow(),
      });
    this.changed();
    await this.saving;
  }

  /** Waits until every change so far is stored. */
  public flushed(): Promise<void> {
    return this.saving;
  }

  /** The stored form, with the locks for resuming. */
  public stored(): SwarmStoredBoard {
    return { view: this.view(), locks: this.locks.list() };
  }

  /** Hands every waiting subtask to the helper it asked for or to the next free one. */
  private dispatch(): void {
    if (this.input.signal.aborted || this.outcome !== "running") return;
    for (const task of this.board.queued()) {
      if (this.controllers.has(task.id)) continue;
      const workerId = this.pickWorker(task);
      if (workerId === null) continue;
      this.board.starting(workerId, task.id);
      const running = this.runTask(workerId, task.id).catch(
        (error: unknown) => {
          logCaughtError("SwarmCoordinator", error);
        },
      );
      this.pending.add(running);
      void running.finally(() => this.pending.delete(running));
    }
  }

  private pickWorker(task: AgentPlanSwarmTaskView): string | null {
    const free = this.board.freeWorkers();
    if (task.requestedWorkerId !== null) {
      const requested = this.board.worker(task.requestedWorkerId);
      const isFree =
        requested !== undefined &&
        (free.some((worker) => worker.id === requested.id) ||
          requested.status === "not_started");
      return isFree ? requested.id : null;
    }
    return free[0]?.id ?? null;
  }

  private async runTask(workerId: string, taskId: string): Promise<void> {
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    const signal = AbortSignal.any([controller.signal, this.input.signal]);
    try {
      await this.work(workerId, taskId, signal);
    } finally {
      this.controllers.delete(taskId);
      this.dispatch();
      this.changed();
    }
  }

  /**
   * Runs one subtask: its period opens before the turn, so nothing a helper
   * changes escapes the check, and its locks go when the turn ends.
   */
  private async work(
    workerId: string,
    taskId: string,
    signal: AbortSignal,
  ): Promise<void> {
    const task = this.board.task(taskId);
    if (!task) return;
    this.allowances.open(taskId, [
      ...this.activeAllowances(),
      { workerId, scope: task.scope, locks: [] },
    ]);
    const before = await this.snapshot();
    const prompt = swarmWorkerPrompt({
      workerId,
      task,
      instruction: this.input.instruction,
    });
    const started = await this.startTurn(workerId, taskId, { prompt, signal });
    if (started === null) {
      this.allowances.drop(taskId);
      return;
    }
    this.board.start(taskId, workerId, this.isoNow());
    this.changed();
    const ended = await started.turn.catch((error: unknown) => {
      logCaughtError("SwarmCoordinator", error);
      return failedTurn("swarm_worker_failed");
    });
    await this.settle(workerId, taskId, { ended, before, signal });
  }

  /** Starts the turn in the helper's open session, or opens one with it. */
  private async startTurn(
    workerId: string,
    taskId: string,
    request: { readonly prompt: string; readonly signal: AbortSignal },
  ): Promise<{ readonly turn: Promise<SwarmTurn> } | null> {
    if (
      request.signal.aborted ||
      this.board.task(taskId)?.status !== "queued"
    ) {
      this.cancelled(taskId);
      return null;
    }
    const existing = this.sessions.get(workerId);
    if (existing) return { turn: existing.run(request.prompt, request.signal) };
    try {
      const opened = await this.dependencies.launcher.open(workerId, request, {
        todos: (todos) => {
          this.board.showTodos(workerId, todos);
          this.changed();
        },
      });
      this.sessions.set(workerId, opened.session);
      return { turn: opened.turn };
    } catch (error: unknown) {
      if (request.signal.aborted) {
        this.cancelled(taskId);
        return null;
      }
      const reason =
        error instanceof SwarmStartError
          ? error.reason
          : "swarm_worker_start_failed";
      if (!(error instanceof SwarmStartError))
        logCaughtError("SwarmCoordinator", error);
      this.board.notStarted(workerId, taskId, reason);
      return null;
    }
  }

  /** Ends a subtask: closes a failed session, frees the locks and checks the period. */
  private async settle(
    workerId: string,
    taskId: string,
    turn: {
      readonly ended: SwarmTurn;
      readonly before: SwarmWorkspaceState | null;
      readonly signal: AbortSignal;
    },
  ): Promise<void> {
    const { ended, before } = turn;
    const status = this.statusOf(ended, turn.signal);
    if (status !== "done") await this.endSession(workerId);
    const after = before ? await this.snapshot() : null;
    this.locks.releaseOwner(workerId);
    this.check(taskId, before, after);
    this.board.finish(taskId, {
      status,
      result: status === "done" ? ended.output : null,
      error: status === "failed" ? errorText(ended) : null,
      at: this.isoNow(),
    });
  }

  private statusOf(
    turn: SwarmTurn,
    signal: AbortSignal,
  ): "done" | "failed" | "cancelled" {
    if (signal.aborted) return "cancelled";
    return turn.failure === null ? "done" : "failed";
  }

  private cancelled(taskId: string): void {
    this.board.finish(taskId, {
      status: "cancelled",
      result: null,
      error: null,
      at: this.isoNow(),
    });
  }

  private check(
    taskId: string,
    before: SwarmWorkspaceState | null,
    after: SwarmWorkspaceState | null,
  ): void {
    if (!before || !after) {
      this.allowances.drop(taskId);
      return;
    }
    const found = this.allowances.close(taskId, {
      before,
      after,
      at: this.isoNow(),
    });
    for (const violation of found) this.board.report(violation);
  }

  private activeAllowances(): readonly {
    readonly workerId: string;
    readonly scope: readonly string[];
    readonly locks: readonly string[];
  }[] {
    return this.board.state().workers.flatMap((worker) => {
      const task = worker.taskId ? this.board.task(worker.taskId) : undefined;
      if (!this.isWorkerActive(worker.id) || !task) return [];
      return [
        {
          workerId: worker.id,
          scope: task.scope,
          locks: this.locks.held(worker.id),
        },
      ];
    });
  }

  private async endSession(workerId: string): Promise<void> {
    const session = this.sessions.get(workerId);
    this.sessions.delete(workerId);
    this.locks.releaseOwner(workerId);
    await session?.close();
  }

  private async snapshot(): Promise<SwarmWorkspaceState | null> {
    try {
      return await this.dependencies.probe.snapshot();
    } catch (error: unknown) {
      logCaughtError("SwarmCoordinator", error);
      return null;
    }
  }

  private changed(): void {
    this.changes += 1;
    for (const waiter of [...this.waiters]) waiter();
    const stored = this.stored();
    this.saving = this.saving
      .then(() => this.dependencies.save(stored))
      .catch((error: unknown) => {
        logCaughtError("SwarmCoordinator", error);
      });
  }

  private isoNow(): string {
    return new Date(this.dependencies.now()).toISOString();
  }
}
