import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { isPlanWriterWaitActive } from "@/definition/AgentPlanRunState";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { withDatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import {
  captureLogContext,
  logCaughtError,
  logDiagnostic,
  logEvent,
  withLogContext,
} from "@/backend/logging/Logger";

import { planNodeOutcome } from "./AgentPlanNodeOutcome";
import {
  acquirePlanWriters,
  retireActivePredecessor,
  finalizeScheduledPlanRun,
} from "./AgentPlanRunLifecycle";
import { adoptLocalPlanRun } from "./AgentPlanEngineAdoption";
import { planNodeStop } from "./AgentPlanBlockerRules";
import { savePlanSession } from "./AgentPlanSessionPersistence";
import { capturePlanExecution } from "./AgentPlanExecutionSnapshot";
import { hasRemotePlanTarget } from "./AgentPlanExecutionTargets";
import { AgentPlanEngineStarts } from "./AgentPlanEngineStarts";
import { AgentPlanRunCommands } from "./AgentPlanRunCommands";
import { completePlanDrain } from "./AgentPlanDrain";
import { closeIdlePlanGroups } from "./AgentPlanGroupCloseout";
import { runPlanInstruction } from "./AgentPlanInstructionControl";
import {
  patchStep,
  updateBlocked,
  readySteps,
  canSchedule,
  canFinalize,
  isRequestStep,
  countRunningPlanRequests,
} from "./AgentPlanRunState";
import { planWritingWorkspaces } from "./AgentPlanContinuation";
import { settlePlanRun } from "./AgentPlanRunSettle";
import { sharedAgentPlanRunObservers } from "./AgentPlanRunObservers";
import {
  isStaleStart,
  settleEventPrompt,
  settlePlanBranching,
  startedStep,
  unstartedChanges,
} from "./branching/AgentPlanBranchSettle";
import {
  shutdownPlanEngine,
  STOP_WAIT_MILLISECONDS,
} from "./AgentPlanEngineShutdown";
import { initialPlanRun, recoveredPlanRun } from "./AgentPlanRunStart";
import { AgentPlanLoopRunner } from "./loop/AgentPlanLoopRunner";
import { readPlanBranchState } from "./branching/AgentPlanBranchPersistence";
import { completedPlanWorkCheckpoint } from "./AgentPlanWorkDispatch";
import { settleFailedPlanStart } from "./AgentPlanStartFailure";

import type { dispatchPlanLoop } from "./AgentPlanNodeDispatch";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";
import type { RecoveredRunStart } from "./AgentPlanRunStart";
import type { AgentPlanResourceStart } from "@/definition/AgentPlanResourceRelease";
import type { PlanInstructionWork } from "./AgentPlanInstructionControl";
import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "./AgentPlanRunState";
import type { DatabaseLogMetrics } from "@/backend/logging/DatabaseLogMetrics";
import type { DatabaseTransaction } from "@/backend/database/Database";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { EngineDependencies } from "./AgentPlanEngineDependencies";

export type { EngineDependencies } from "./AgentPlanEngineDependencies";

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

/** Label of the database jobs of plan runs in the write-ahead log counters. */
const PLAN_RUN_ORIGIN = "plan_run";

/** Event-driven DAG scheduling; native ACP capacity is admitted by the shared resource service. */
export class AgentPlanRunEngine {
  private resourceTimer: NodeJS.Timeout | null = null;
  private readonly dependencies: EngineDependencies;
  private readonly commands: AgentPlanRunCommands;
  private readonly nodes: Parameters<typeof dispatchPlanLoop>[3];
  private readonly active = new Map<string, ActivePlanRun>();
  private readonly writes = new SerialQueue();
  private readonly starts: AgentPlanEngineStarts;
  private readonly pending = new Set<Promise<void>>();
  private isClosing = false;
  private isSchedulingEnabled: boolean;

  public constructor(dependencies: EngineDependencies) {
    this.dependencies = dependencies;
    this.starts = new AgentPlanEngineStarts({
      dependencies, active: this.active, writes: this.writes,
      reset: (id, record) => this.resetLogical(id, record),
    });
    this.isSchedulingEnabled = !dependencies.deferScheduling;
    this.nodes = {
      writes: this.writes,
      dependencies,
      loops: new AgentPlanLoopRunner(dependencies.steps, {
        scripts: dependencies.scripts,
        decisions: dependencies.decisions,
      }),
    };
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
    return this.starts.run(initialPlanRun(userId, snapshot), snapshot, (run) =>
      this.launch(run, snapshot, { recording, journal }),
    );
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
    return this.starts.run(recoveredPlanRun(userId, snapshot, recovered), snapshot, (run) =>
      this.launch(run, snapshot, { journal }),
    );
  }

  /** Persists an explicit stop before aborting any execution. */
  public async stop(id: string, journal?: AgentPlanRunJournal): Promise<void> {
    await this.commands.stop(id, journal);
  }

  /** Retires writers for a separate API producer before its run admission transaction. */
  public async prepareStartResources(start: AgentPlanResourceStart, keys: readonly string[]): Promise<readonly string[]> {
    return this.starts.prepare(start, keys);
  }

  /** Applies an atomic logical reset under the same queue that owns dispatch; cleanup continues independently. */
  public async resetLogical(
    id: string,
    record: () => Promise<AgentPlanRun>,
  ): Promise<void> {
    await this.writes.run(async () => {
      const retired = await record();
      const active = this.active.get(id);
      if (!active) return;
      active.view = retired;
      for (const controller of active.controllers.values()) controller.abort();
    });
    this.schedulePump();
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

  /** Whether the server is stopping, so nothing new may start. */
  public isShuttingDown(): boolean {
    return this.isClosing;
  }

  /** Restores the same run around independently proven native owners, without a replacement prompt. */
  public async adopt(run: AgentPlanRun): Promise<boolean> {
    if (this.isClosing) return false;
    const adopted = await adoptLocalPlanRun(run, {
      dependencies: this.dependencies,
      active: this.active,
      writes: this.writes,
      start: (active, node, controller) =>
        this.track(
          active,
          this.execute(
            active,
            node,
            controller,
            active.view.steps.find((step) => step.id === node.id)?.activation,
          ),
        ),
      track: (active, pending) => this.track(active, pending),
      pump: () => this.pump(),
      instruction: (active, work) => this.instruction(active, work),
    });
    if (adopted) this.schedulePump();
    return adopted;
  }

  /** Unknown local owner identities retain reservations and never authorize cleanup. */
  public unverifiedLocalSessions(): ReadonlySet<string> {
    return this.dependencies.localSessions?.unverified() ?? new Set();
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
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), STOP_WAIT_MILLISECONDS);
    });
    const closed = (async (): Promise<boolean> => {
      for (const active of runs) await this.stop(active.view.id);
      await Promise.all(runs.flatMap((active) => [...active.executions]));
      return true;
    })();
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
    this.dependencies.localSessions?.detachAll();
    if (this.resourceTimer) clearTimeout(this.resourceTimer);
    for (const [id, active] of this.active) {
      if (
        active.view.status !== "paused" &&
        !this.dependencies.localSessions?.detachRun(id)
      )
        continue;
      this.active.delete(id);
      for (const pending of active.executions) this.pending.delete(pending);
    }
    await shutdownPlanEngine({
      active: this.active,
      pending: this.pending,
      interrupt: (id) => this.commands.interrupt(id),
      pump: () => this.pump(),
    });
  }

  /** Releases dispatch after recovery and queued controls have been reconciled. */
  public activateScheduling(): void {
    this.isSchedulingEnabled = true;
    this.schedulePump();
  }

  /** Applies reset/restart fences committed by the API without replaying their effects. */
  public async reconcileRetiredRuns(): Promise<void> {
    await this.starts.reconcile();
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
    const logContext = { ...captureLogContext(), runId: view.id };
    withLogContext(logContext, () =>
      logEvent({
        level: "info",
        event: "agent.run.started",
        component: "AgentPlanRunEngine",
        message: "Agent plan run starting",
        metadata: { userId: view.userId, origin: view.origin?.kind ?? null },
      }),
    );
    await this.dependencies.runs.prepareSnapshot?.(view.id, snapshot);
    const workspaceIds = planWritingWorkspaces(snapshot);
    const releaseDefinition = await this.dependencies.files?.hold(
      snapshot.steps.map((step) => step.step.agentId),
    );
    await this.writes.run(async () => {
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
      sharedAgentPlanRunObservers().notifyStarted(view);
      // The run exists from here on, so its lifecycle no longer hangs on the request.
      await withBackgroundDatabaseWork(PLAN_RUN_ORIGIN, () =>
        retireActivePredecessor(view, this.active, this.dependencies),
      );
      this.active.set(view.id, {
        logContext,
        groupCloseout: "open",
        hasPersistenceFailure: false,
        view: view,
        snapshot,
        dispatched: new Set(),
        controllers: new Map(),
        executions: new Set(),
        releaseDefinition,
        branching: snapshot.recovery?.branching
          ? readPlanBranchState(snapshot.recovery.branching)
          : undefined,
      });
    });
    return withBackgroundDatabaseWork(PLAN_RUN_ORIGIN, async () => {
      try {
        await this.pump();
        return (await this.dependencies.runs.find(view.id)) ?? view;
      } catch (error: unknown) {
        logCaughtError("AgentPlanRunEngine", error);

        await this.failStart(view.id);
        throw error;
      }
    });
  }

  /**
   * Advances every active run.
   *
   * @remarks
   * Any request can trigger it, but it works on the runs of all accounts and
   * dispatches their long-running nodes. It therefore runs as background work
   * (PAGE-199): a node keeps the long writer budget for its whole lifetime, and
   * no client leaving ends another person's run. An explicit stop or a server
   * stop acts through the controllers of the run, not through this context.
   */
  private pump(): Promise<void> {
    return this.isSchedulingEnabled
      ? withBackgroundDatabaseWork(PLAN_RUN_ORIGIN, () => this.advance())
      : Promise.resolve();
  }

  private async advance(): Promise<void> {
    await this.writes.run(async () => {
      for (const active of this.active.values()) {
        await completePlanDrain(active, this.dependencies.runs);
        if (settlePlanRun(active))
          await this.dependencies.runs.update(active.view);
      }
    });
    await closeIdlePlanGroups(this.active.values(), {
      writes: this.writes,
      runs: this.dependencies.runs,
      steps: this.dependencies.steps,
    });
    await this.writes.run(async () => {
      for (const [id, active] of this.active) {
        if (
          canSchedule(active) &&
          !(await acquirePlanWriters(active, this.dependencies))
        )
          continue;
        updateBlocked(active);
        if (canSchedule(active) && settlePlanBranching(active))
          await this.dependencies.runs.update(active.view);
        const ready = canSchedule(active) ? readySteps(active) : [];
        for (const step of ready) {
          if (
            isRequestStep(active, step.id) &&
            countRunningPlanRequests(this.active.values()) >= 2
          )
            continue;
          const controller = new AbortController();
          active.controllers.set(step.id, controller);
          patchStep(active, step.id, startedStep(active, step.id));
          await this.dependencies.runs.update(active.view);
          active.dispatched.add(step.id);
          const pending = this.execute(
            active,
            step,
            controller,
            active.view.steps.find((entry) => entry.id === step.id)?.activation,
          );
          this.track(active, pending);
        }
        if (canFinalize(active)) {
          await finalizeScheduledPlanRun(active, this.dependencies);
          this.active.delete(id);
        }
      }
    });
    if (
      !this.isClosing &&
      !this.resourceTimer &&
      [...this.active.values()].some((active) =>
        isPlanWriterWaitActive(active.view),
      )
    ) {
      this.resourceTimer = setTimeout(() => {
        this.resourceTimer = null;
        this.schedulePump();
      }, 1000);
      this.resourceTimer.unref();
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
    await settleFailedPlanStart(id, {
      active: this.active,
      dependencies: this.dependencies,
      pump: () => this.pump(),
    });
  }

  private async execute(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
    activation: number | undefined,
  ): Promise<void> {
    const step = active.view.steps.find((entry) => entry.id === node.id);
    const attemptId = step?.session?.attemptId ?? step?.execution?.attemptId;
    // The log of the run names the step and attempt each line belongs to (PAGE-307).
    return withLogContext(
      {
        ...active.logContext,
        runId: active.view.id,
        stepId: node.id,
        ...(attemptId === undefined ? {} : { attemptId }),
      },
      () =>
        withDatabaseLogMetrics((metrics) =>
          this.executeNode(active, node, controller, { metrics, activation }),
        ),
    );
  }

  private async executeNode(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
    context: {
      readonly metrics: DatabaseLogMetrics;
      readonly activation: number | undefined;
    },
  ): Promise<void> {
    const { metrics, activation } = context;
    logEvent({
      level: "debug",
      event: "agent.step.started",
      component: "AgentPlanRunEngine",
      message: "Agent plan step started",
    });
    const outcome = await this.outcome(active, node, controller).catch(
      (error: unknown): Partial<AgentPlanStepResult> => {
        logCaughtError("AgentPlanRunEngine", error);
        return {
          status: "failed",
          error: error instanceof AgentError ? error.code : "plan_step_failed",
        };
      },
    );
    if (active.view.stopRequested) return;
    const changes =
      outcome.status === "failed"
        ? { ...outcome, failureStop: planNodeStop(active.view, node, outcome) }
        : outcome;
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
        // A result belongs to the start it was dispatched for.
        if (
          active.view.stopRequested ||
          isStaleStart(active, node.id, activation)
        )
          return;
        const previous = active.view;
        patchStep(
          active,
          node.id,
          changes.status === "paused" && active.view.stopRequested
            ? { ...changes, status: "cancelled", cancellation: "not_started" }
            : unstartedChanges(active, node.id, changes),
        );
        active.controllers.delete(node.id);
        active.dispatched.delete(node.id);
        // A start that a pause ended before it began keeps its news for the resume.
        if (changes.status !== "paused" && changes.status !== "failed")
          settleEventPrompt(active, node.id);
        try {
          const checkpoint = completedPlanWorkCheckpoint(active, node, changes);
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

  /** Dispatches a node through the current engine gates and native adoption boundary. */
  private outcome(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
  ): Promise<Partial<AgentPlanStepResult>> {
    return planNodeOutcome(active, node, controller, {
      dependencies: this.dependencies,
      nodes: this.nodes,
      instruction: (work) => this.instruction(active, work),
      saveSession: (session) => this.saveSession(active, node.id, session),
    });
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
