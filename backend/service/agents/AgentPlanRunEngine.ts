import { AgentPlanPausedError } from "@/backend/error/AgentPlanPausedError";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { AgentExecutionError } from "@/backend/error/AgentExecutionErrors";
import { withDatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";
import { dispatchRemotePlanStep } from "./AgentPlanRemoteExecution";
import { savePlanSession } from "./AgentPlanSessionPersistence";
import { capturePlanExecution } from "./AgentPlanExecutionSnapshot";
import { hasRemotePlanTarget } from "./AgentPlanExecutionTargets";
import { AgentPlanRunCommands } from "./AgentPlanRunCommands";
import { completePlanDrain } from "./AgentPlanDrain";
import { runPlanInstruction } from "./AgentPlanInstructionControl";
import {
  patchStep,
  requestCancellation,
  updateBlocked,
  readySteps,
  canSchedule,
  canFinalize,
  isRequestStep,
  settlePlanPause,
  finalPlanStatus,
  endedPlanRun,
  hasUnconfirmedCloseout,
  countRunningPlanRequests,
  interruptedPlanRun,
} from "./AgentPlanRunState";
import { planWritingWorkspaces } from "./AgentPlanContinuation";
import { createPlanCheckpoint } from "./recovery/AgentPlanCheckpoint";
import { createLoopHost } from "./loop/AgentPlanLoopEngineHost";
import { initialPlanRun, recoveredPlanRun } from "./AgentPlanRunStart";
import { AgentPlanLoopRunner } from "./loop/AgentPlanLoopRunner";
import { planRecoveryReason } from "./recovery/AgentPlanFailure";
import { dispatchPlanScript } from "./AgentPlanScriptDispatch";
import type { AgentPlanRemoteExecution } from "./AgentPlanRemoteExecution";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { RecoveredRunStart } from "./AgentPlanRunStart";
import type { PlanInstructionWork } from "./AgentPlanInstructionControl";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { AcpResourceScheduler } from "./AcpResourceScheduler";
import type { DatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanLoop } from "@/definition/AgentPlanLoop";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { AgentPlanStepRunner } from "./AgentPlanStepRunner";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";
import type { AgentPlanScriptRunner } from "./AgentPlanScriptRunner";

/**
 * Creates the record of a new run inside a transaction that the caller opens.
 *
 * @remarks
 * The caller passes `create` the transaction in which it stores its own
 * changes; a failure of either rolls both back.
 */
export type AgentPlanRunRecording = (
  create: (transaction: DatabaseTransaction) => Promise<void>,
) => Promise<void>;

/** How long a stopped run may take to close before the caller gives up waiting. */
const STOP_WAIT_MILLISECONDS = 30_000;

/** Runtime boundaries shared with the run command aggregate. */
export interface EngineDependencies {
  readonly remoteExecution?: AgentPlanRemoteExecution;
  readonly scripts?: Pick<AgentPlanScriptRunner, "run">;
  readonly resources?: Pick<AcpResourceScheduler, "pauseRun" | "resumeRun">;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "insert" | "create" | "update" | "find"
  >;
  readonly start: Pick<AgentPlanStepStart, "control">;
  readonly steps: Pick<AgentPlanStepRunner, "run" | "closeGroups"> &
    Partial<Pick<AgentPlanStepRunner, "revise">>;
  readonly archive?: AgentRunArchive;
  readonly files?: AgentDefinitionFiles;
}

/** Event-driven DAG scheduling; native ACP capacity is admitted by the shared resource service. */
export class AgentPlanRunEngine {
  private readonly dependencies: EngineDependencies;
  private readonly commands: AgentPlanRunCommands;
  private readonly loops: AgentPlanLoopRunner;
  private readonly active = new Map<string, ActivePlanRun>();
  private readonly writes = new SerialQueue();
  private readonly pending = new Set<Promise<void>>();
  private isClosing = false;

  public constructor(dependencies: EngineDependencies) {
    this.dependencies = dependencies;
    this.loops = new AgentPlanLoopRunner(dependencies.steps);
    this.commands = new AgentPlanRunCommands({
      ...dependencies,
      active: this.active,
      writes: this.writes,
      isClosing: () => this.isClosing,
      pump: () => this.pump(),
    });
  }

  /**
   * Persists a snapshot and reserves writing copies before returning a new Play run.
   *
   * @param userId - The executor.
   * @param snapshot - The prepared revision; every start gets its own run and fresh node states.
   * @param recording - Runs the creation of the run record inside a
   * transaction of the caller, which stores its own changes with it; without
   * it the record is created in a transaction of its own.
   */
  public async start(
    userId: string,
    snapshot: AgentPlanSnapshot,
    recording?: AgentPlanRunRecording,
    journal?: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    if (this.isClosing) throw new AgentError("plan_access_denied");
    return this.launch(initialPlanRun(userId, snapshot), snapshot, {
      recording,
      journal,
    });
  }

  /**
   * Starts the run an explicit restart or resume of an earlier run asked for.
   *
   * @param userId - The executor.
   * @param snapshot - The prepared revision of the new run.
   * @param recovered - The origin and what is taken over from the earlier run.
   * @param journal - Records the decision in the transaction that creates the run.
   * @returns The new run; the earlier one is not changed.
   */
  public async startRecovered(
    userId: string,
    snapshot: AgentPlanSnapshot,
    recovered: RecoveredRunStart,
    journal: AgentPlanRunJournal,
  ): Promise<AgentPlanRun> {
    if (this.isClosing) throw new AgentError("plan_access_denied");
    return this.launch(
      recoveredPlanRun(userId, snapshot, recovered),
      snapshot,
      { journal },
    );
  }

  /** Persists an explicit stop before aborting any execution. */
  public async stop(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await this.commands.stop(id, journal);
  }

  /**
   * Whether this process still drives the run.
   *
   * @remarks
   * A run of an earlier process keeps its durable remote jobs, but nothing
   * here schedules, finalizes or releases it anymore.
   */
  public isActive(id: string): boolean {
    return this.active.has(id);
  }

  /** Persists an explicit pause before releasing the execution gate. */
  public async pause(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await this.commands.pause(id, journal);
  }

  /** Adopts a saved revision and journals the resume at its durable boundary. */
  public async resume(
    id: string,
    snapshot?: AgentPlanSnapshot,
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    await this.commands.resume(id, snapshot, journal);
  }

  /**
   * Stops every active run of a project and waits until each has closed.
   *
   * @param projectId - The project whose runs end.
   * @returns Whether all of them closed in time; their records are written by then.
   *
   * @remarks
   * Meant for the deletion of a project, whose data a still running node
   * would otherwise keep writing to.
   */
  public async stopProject(projectId: string): Promise<boolean> {
    const runs = [...this.active.values()].filter(
      (active) => active.snapshot.plan.projectId === projectId,
    );
    for (const active of runs) await this.stop(active.view.id);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), STOP_WAIT_MILLISECONDS);
    });
    const closed = Promise.all(
      runs.flatMap((active) => [...active.executions]),
    ).then(() => true);
    try {
      return await Promise.race([closed, timeout]);
    } finally {
      clearTimeout(timer);
      await this.pump();
    }
  }

  /** The shutdown hook drains execution before closing DuckDB or the shared CLI runner. */
  public async shutdown(): Promise<void> {
    this.isClosing = true;
    // A shutdown is no decision of the executor: the runs close as interrupted, not stopped.
    for (const id of this.active.keys()) await this.commands.interrupt(id);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const drained = await Promise.race([
        Promise.all([...this.pending]).then(() => true),
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => resolve(false), STOP_WAIT_MILLISECONDS);
        }),
      ]);
      if (!drained)
        throw new Error(
          "Agent plan shutdown timed out; reservations remain held.",
        );
    } finally {
      clearTimeout(timer);
    }
    await this.pump();
  }

  private schedulePump(): void {
    void this.pump().catch((error: unknown) => {
      logCaughtError("AgentPlanRunEngine", error);
    });
  }

  /** Persists the view and reserves writing copies before the first node is scheduled. */
  private async launch(
    view: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    terms: {
      readonly recording?: AgentPlanRunRecording;
      readonly journal?: AgentPlanRunJournal;
    },
  ): Promise<AgentPlanRun> {
    if (
      (hasRemotePlanTarget(snapshot.plan) ||
        snapshot.steps.some((step) => step.remoteTarget)) &&
      !this.dependencies.remoteExecution
    )
      throw new AgentError("plan_remote_unavailable");
    const { recording, journal } = terms;
    const captured = capturePlanExecution(view, snapshot);
    view = captured.run;
    snapshot = captured.snapshot;
    withLogContext({ runId: view.id }, () =>
      logEvent({
        level: "info",
        event: "agent.run.started",
        component: "AgentPlanRunEngine",
        message: "Agent plan run starting",
        metadata: { userId: view.userId, origin: view.origin?.kind ?? null },
      }),
    );
    const workspaceIds = planWritingWorkspaces(snapshot);
    const releaseDefinition = await this.dependencies.files?.hold(
      snapshot.steps.map((step) => step.step.agentId),
    );
    try {
      if (recording)
        await recording((transaction) =>
          this.dependencies.runs.insert(
            transaction,
            view,
            snapshot,
            workspaceIds,
          ),
        );
      else
        await this.dependencies.runs.create(
          view,
          snapshot,
          workspaceIds,
          journal,
        );
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);

      await releaseDefinition?.();
      throw error;
    }
    this.active.set(view.id, {
      groupCloseout: "open",
      hasPersistenceFailure: false,
      view: view,
      snapshot,
      dispatched: new Set(),
      controllers: new Map(),
      executions: new Set(),
      releaseDefinition,
    });
    try {
      await this.pump();
      return (await this.dependencies.runs.find(view.id)) ?? view;
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);

      await this.failStart(view.id);
      throw error;
    }
  }

  private async pump(): Promise<void> {
    await this.writes.run(async () => {
      for (const active of this.active.values()) {
        await completePlanDrain(active, this.dependencies.runs);
        const previous = active.view;
        settlePlanPause(active);
        if (previous !== active.view)
          await this.dependencies.runs.update(active.view);
      }
    });
    await this.closeIdleGroups();
    await this.writes.run(async () => {
      for (const [id, active] of this.active) {
        updateBlocked(active);
        const ready = canSchedule(active) ? readySteps(active) : [];
        for (const step of ready) {
          if (
            isRequestStep(active, step.id) &&
            countRunningPlanRequests(this.active.values()) >= 2
          )
            continue;
          const controller = new AbortController();
          active.controllers.set(step.id, controller);
          patchStep(active, step.id, { status: "running" });
          await this.dependencies.runs.update(active.view);
          active.dispatched.add(step.id);
          const pending = this.execute(active, step, controller);
          this.track(active, pending);
        }
        if (canFinalize(active)) {
          const hasFailure = active.view.steps.some(
            (step) =>
              step.status === "failed" ||
              step.status === "waiting" ||
              step.status === "paused" ||
              step.isBlocked,
          );
          const status = finalPlanStatus(active, hasFailure);
          const recovery =
            status === "failed" ? planRecoveryReason(active.view) : undefined;
          active.view = {
            ...endedPlanRun(active.view, status),
            ...(recovery ? { recovery } : {}),
          };
          if (active.isInterrupted)
            active.view = interruptedPlanRun(active.view);
          await this.dependencies.runs.update(active.view);
          await this.dependencies.archive?.complete(
            active.view,
            active.snapshot,
          );
          if (!hasUnconfirmedCloseout(active))
            await active.releaseDefinition?.();
          this.active.delete(id);
          withLogContext({ runId: id }, () =>
            logEvent({
              level: "info",
              event: "agent.run.completed",
              component: "AgentPlanRunEngine",
              message: "Agent plan run completed",
              metadata: { status },
            }),
          );
          this.dependencies.resources?.resumeRun(id);
        }
      }
    });
  }

  private async closeIdleGroups(): Promise<void> {
    const closing = await this.writes.run(() => {
      const idle = [...this.active.values()].filter(
        (active) =>
          active.groupCloseout === "open" &&
          active.controllers.size === 0 &&
          (readySteps(active).length === 0 || active.isInterrupted) &&
          (active.view.status !== "paused" ||
            active.view.stopRequested ||
            active.isInterrupted),
      );
      for (const active of idle) active.groupCloseout = "closing";
      return Promise.resolve(idle);
    });
    for (const active of closing) {
      if (
        active.snapshot.groups?.length ||
        active.snapshot.plan.nodes.some((node) => node.type === "loop")
      )
        await this.dependencies.steps.closeGroups(active.view.id);
      active.groupCloseout = "closed";
    }
  }

  private track(active: ActivePlanRun, execution: Promise<void>): void {
    // A node that fails outside its own handling ends this run's dispatch, never the server.
    const pending = execution.catch((error: unknown) => {
      logCaughtError("AgentPlanRunEngine", error);
      active.hasPersistenceFailure = true;
      for (const controller of active.controllers.values()) controller.abort();
    });
    this.pending.add(pending);
    active.executions.add(pending);
    void pending.then(() => {
      this.pending.delete(pending);
      active.executions.delete(pending);
    });
  }

  private instruction(
    active: ActivePlanRun,
    work: PlanInstructionWork,
  ): Promise<PlanSessionTurn> {
    const pending = runPlanInstruction(
      active,
      {
        writes: this.writes,
        runs: this.dependencies.runs,
        settled: () => this.pump(),
      },
      work,
    );
    this.track(
      active,
      pending.then(
        () => undefined,
        () => undefined,
      ),
    );
    return pending;
  }

  private async failStart(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    requestCancellation(active);
    for (const controller of active.controllers.values()) controller.abort();
    if (
      active.executions.size > 0 ||
      allPlanRunResults(active.view).some((step) => step.session)
    ) {
      await Promise.all([...active.executions]);
      // Running adapters settle before normal finalization releases their definitions.
      try {
        await this.pump();
      } catch (error: unknown) {
        logCaughtError("AgentPlanRunEngine", error);

        logDiagnostic(
          "AgentPlanRunEngine",
          "error",
          "Pages could not finalize a failed plan start.",
          error,
        );
      }
      return;
    }
    active.view = {
      ...endedPlanRun(active.view, "failed"),
      steps: active.view.steps.map((step) => ({
        ...step,
        status: "cancelled",
        cancellation: "not_started",
      })),
    };
    await active.releaseDefinition?.();
    this.active.delete(id);
    try {
      await this.dependencies.runs.update(active.view);
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);

      logDiagnostic(
        "AgentPlanRunEngine",
        "error",
        "Pages could not persist a failed plan start; reservations remain held.",
        error,
      );
    }
  }

  private async execute(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
  ): Promise<void> {
    return withLogContext({ runId: active.view.id }, () =>
      withDatabaseLogMetrics((metrics) =>
        this.executeNode(active, node, controller, metrics),
      ),
    );
  }

  private async executeNode(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
    metrics: DatabaseLogMetrics,
  ): Promise<void> {
    logEvent({
      level: "debug",
      event: "agent.step.started",
      component: "AgentPlanRunEngine",
      message: "Agent plan step started",
    });
    const changes = await this.outcome(active, node, controller).catch(
      (error: unknown): Partial<AgentPlanStepResult> => {
        logCaughtError("AgentPlanRunEngine", error);
        return {
          status: "failed",
          error: error instanceof AgentError ? error.code : "plan_step_failed",
        };
      },
    );
    logEvent({
      level: changes.status === "failed" ? "error" : "info",
      event: "agent.step.completed",
      component: "AgentPlanRunEngine",
      message: "Agent plan step completed",
      metadata: {
        status: changes.status,
        code: changes.error,
        ...metrics.finish(),
      },
    });
    try {
      await this.writes.run(async () => {
        const previous = active.view;
        patchStep(
          active,
          node.id,
          changes.status === "paused" && active.view.stopRequested
            ? { ...changes, status: "cancelled", cancellation: "not_started" }
            : changes,
        );
        active.controllers.delete(node.id);
        active.dispatched.delete(node.id);
        try {
          const checkpoint =
            changes.status === "succeeded" && !changes.remote
              ? createPlanCheckpoint(active.view, active.snapshot, node.id)
              : undefined;
          await this.dependencies.runs.update(active.view, checkpoint);
        } catch (error: unknown) {
          logCaughtError("AgentPlanRunEngine", error);

          active.view = previous;
          active.hasPersistenceFailure = true;
          throw error;
        }
        await this.dependencies.archive?.complete(active.view, active.snapshot);
      });
      await this.pump();
    } catch (caughtError: unknown) {
      logCaughtError("AgentPlanRunEngine", caughtError);

      // Keep persistent reservations if progress cannot be saved; no further providers may start.
      active.hasPersistenceFailure = true;
      for (const running of active.controllers.values()) running.abort();
      logDiagnostic(
        "AgentPlanRunEngine",
        "error",
        "Pages could not persist agent plan progress; workspace reservations remain held.",
      );
    }
  }

  /** Agent nodes run through the step runner; starts and ends are checkpoints. */
  private async outcome(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
  ): Promise<Partial<AgentPlanStepResult>> {
    const isStopped = active.view.stopRequested || controller.signal.aborted;
    const remote = dispatchRemotePlanStep(
      this.dependencies.remoteExecution,
      active,
      node.id,
      controller.signal,
    );
    if (remote) return remote;
    if (node.type === "script")
      return dispatchPlanScript(active, node.id, controller, {
        scripts: this.dependencies.scripts,
        writes: this.writes,
        runs: this.dependencies.runs,
      });
    const step = active.snapshot.steps.find(
      (entry) => entry.step.id === node.id,
    );
    if (step) {
      if (isStopped)
        return { status: "cancelled", cancellation: "not_started" };
      return this.dependencies.steps.run(active.view, active.snapshot, step, {
        signal: controller.signal,
        awaitDispatch: () => {
          active.dispatched.delete(node.id);
        },
        claimStart: () => {
          if (active.dispatched.has(node.id)) return;
          if (active.view.status !== "running")
            throw new AgentPlanPausedError();
          active.dispatched.add(node.id);
        },
        runInstruction: (work) => this.instruction(active, work),
        save: (session) => this.saveSession(active, node.id, session),
      });
    }
    try {
      if (isStopped) throw new AgentPlanCancelledError();
      if (active.view.status !== "running") throw new AgentPlanPausedError();
      active.dispatched.add(node.id);
      if (node.type === "loop")
        return await this.runLoop(active, node, controller);
      await this.dependencies.start.control(active.view, active.snapshot, node);
      return { status: "succeeded", output: null, error: null };
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunEngine", error);

      if (error instanceof AgentPlanPausedError) return { status: "paused" };
      if (error instanceof AgentPlanCancelledError)
        return { status: "cancelled", cancellation: "not_started" };
      return {
        status: "failed",
        error:
          error instanceof AgentError || error instanceof AgentExecutionError
            ? error.code
            : "plan_step_failed",
      };
    }
  }

  /** A loop is one node: its iterations run inside it and it settles only when they have. */
  private runLoop(
    active: ActivePlanRun,
    node: AgentPlanLoop,
    controller: AbortController,
  ): Promise<Partial<AgentPlanStepResult>> {
    const host = createLoopHost(active, controller.signal, {
      writes: this.writes,
      runs: this.dependencies.runs,
      authorize: () =>
        this.dependencies.start.control(active.view, active.snapshot, node),
    });
    return this.loops.run(node, host);
  }

  /** Stores the newest record of a running node; a failure is reported, never thrown. */
  private async saveSession(
    active: ActivePlanRun,
    stepId: string,
    session: AgentPlanSessionRecord,
  ): Promise<void> {
    await savePlanSession(active, stepId, session, {
      writes: this.writes,
      runs: this.dependencies.runs,
    });
  }
}
