import { randomUUID } from "node:crypto";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import { withGroupResults } from "./AgentPlanGroupResults";
import { hasPlanPath } from "./AgentPlanGraph";
import { planStepDirectory } from "./AgentPlanSnapshot";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { AgentPlanStepRunner } from "./AgentPlanStepRunner";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";
import type { AgentRunNotes } from "./AgentRunNotes";
import type { AgentRunNotesCleanup } from "./AgentRunNotesCleanup";
import type { AgentRunNotesContext } from "@/backend/agents/AgentRunNotesContext";

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

interface ActivePlanRun {
  readonly notes: AgentRunNotesContext | null;
  groupCloseout: "open" | "closing" | "closed";
  view: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly controllers: Map<string, AbortController>;
  /** The nodes of this run that are executing, so a caller can wait for exactly this run. */
  readonly executions: Set<Promise<void>>;
  readonly releaseDefinition?: () => Promise<void>;
}

/** How long a stopped run may take to close before the caller gives up waiting. */
const STOP_WAIT_MILLISECONDS = 30_000;

interface EngineDependencies {
  readonly notesCleanup?: Pick<AgentRunNotesCleanup, "shutdown">;
  readonly notes?: Pick<
    AgentRunNotes,
    "create" | "discard" | "complete" | "setPaused"
  >;
  readonly runs: Pick<
    AgentPlanRunRepository,
    "insert" | "create" | "update" | "find"
  >;
  readonly start: Pick<AgentPlanStepStart, "control">;
  readonly steps: Pick<AgentPlanStepRunner, "run" | "closeGroups">;
  readonly archive?: AgentRunArchive;
  readonly files?: AgentDefinitionFiles;
}

function patchStep(
  active: ActivePlanRun,
  id: string,
  changes: Partial<AgentPlanStepResult>,
): void {
  active.view = withGroupResults(
    {
      ...active.view,
      steps: active.view.steps.map((step) =>
        step.id === id ? { ...step, ...changes } : step,
      ),
    },
    active.snapshot,
  );
}

function requestCancellation(active: ActivePlanRun): void {
  active.view = { ...active.view, stopRequested: true };
  for (const step of active.view.steps) {
    if (step.status === "waiting" || step.status === "paused")
      patchStep(active, step.id, {
        status: "cancelled",
        cancellation: "not_started",
        isBlocked: false,
      });
    if (step.status === "running")
      patchStep(active, step.id, { cancellation: "requested" });
  }
}

function updateBlocked(active: ActivePlanRun): void {
  for (const step of active.view.steps) {
    if (step.status !== "waiting" && step.status !== "paused") continue;
    const hasFailedDependency = active.view.steps.some(
      (entry) =>
        (entry.status === "failed" || entry.status === "cancelled") &&
        hasPlanPath(active.snapshot.plan.edges, entry.id, step.id),
    );
    if (hasFailedDependency)
      patchStep(active, step.id, {
        isBlocked: true,
        error: "plan_dependency_failed",
      });
  }
}

function readySteps(active: ActivePlanRun): readonly AgentPlanNode[] {
  return active.snapshot.plan.nodes.filter((node) => {
    const step = active.view.steps.find((entry) => entry.id === node.id);
    return (
      step?.status === "waiting" &&
      !step.isBlocked &&
      active.snapshot.plan.edges
        .filter((edge) => edge.to === step.id)
        .every(
          (edge) =>
            active.view.steps.find((entry) => entry.id === edge.from)
              ?.status === "succeeded",
        )
    );
  });
}

/** Event-driven DAG scheduler; at most two steps run across the whole instance service. */
export class AgentPlanRunEngine {
  private readonly dependencies: EngineDependencies;
  private readonly active = new Map<string, ActivePlanRun>();
  private readonly writes = new SerialQueue();
  private readonly pending = new Set<Promise<void>>();
  private isClosing = false;

  public constructor(dependencies: EngineDependencies) {
    this.dependencies = dependencies;
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
  ): Promise<AgentPlanRun> {
    if (this.isClosing) throw new AgentError("plan_access_denied");
    const view: AgentPlanRun = {
      id: randomUUID(),
      planId: snapshot.plan.id,
      planName: snapshot.plan.name,
      planRevision: snapshot.plan.revision,
      userId,
      startedAt: new Date().toISOString(),
      status: "running",
      stopRequested: false,
      steps: snapshot.plan.nodes.filter(isPlanFlowNode).map((node) => ({
        id: node.id,
        groupId: snapshot.steps.find((step) => step.step.id === node.id)
          ?.groupId,
        name:
          snapshot.steps.find((step) => step.step.id === node.id)?.name ??
          node.type,
        status: "waiting",
        isBlocked: false,
        cancellation: "none",
        output: null,
        error: null,
      })),
    };
    const initialView = withGroupResults(view, snapshot);
    const workspaceIds = snapshot.steps.flatMap((step) => {
      const directory = planStepDirectory(step);
      return !isApiProvider(step.provider) && directory ? [directory.id] : [];
    });
    const releaseDefinition = await this.dependencies.files?.hold(
      snapshot.steps.map((step) => step.step.agentId),
    );
    let notes: AgentRunNotesContext | null = null;
    try {
      notes =
        (await this.dependencies.notes?.create(initialView, snapshot)) ?? null;
      if (recording)
        await recording((transaction) =>
          this.dependencies.runs.insert(
            transaction,
            initialView,
            snapshot,
            workspaceIds,
          ),
        );
      else
        await this.dependencies.runs.create(
          initialView,
          snapshot,
          workspaceIds,
        );
    } catch (error: unknown) {
      try {
        if (notes) await this.dependencies.notes?.discard(notes);
      } finally {
        await releaseDefinition?.();
      }
      throw error;
    }
    this.active.set(view.id, {
      notes,
      groupCloseout: "open",
      view: initialView,
      snapshot,
      controllers: new Map(),
      executions: new Set(),
      releaseDefinition,
    });
    try {
      await this.pump();
      return (await this.dependencies.runs.find(view.id)) ?? view;
    } catch (error: unknown) {
      await this.failStart(view.id);
      throw error;
    }
  }

  /** Stop is persisted first; confirmed cancellation is reported only by a settled adapter. */
  public async stop(id: string): Promise<void> {
    await this.writes.run(async () => {
      const active = this.active.get(id);
      if (!active) return;
      requestCancellation(active);
      await this.dependencies.runs.update(active.view);
      for (const controller of active.controllers.values()) controller.abort();
    });
    if (this.active.get(id)?.snapshot.groups?.length)
      await this.dependencies.steps.closeGroups(id);
    await this.pump();
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

  /** Persists pause before scheduling can start another node; in-flight nodes settle normally. */
  public async pause(id: string): Promise<void> {
    await this.writes.run(async () => {
      const active = this.active.get(id);
      if (!active || active.view.stopRequested)
        throw new AgentError("plan_run_unavailable");
      if (active.notes)
        await this.dependencies.notes?.setPaused(active.notes, {
          isPaused: true,
        });
      active.view = {
        ...active.view,
        status: "paused",
        steps: active.view.steps.map((step) =>
          step.status === "waiting" ? { ...step, status: "paused" } : step,
        ),
      };
      await this.dependencies.runs.update(active.view);
    });
  }

  /** Resumes the same snapshot and only its unfinished nodes, without replaying completed work. */
  public async resume(id: string): Promise<void> {
    await this.writes.run(async () => {
      const active = this.active.get(id);
      if (!active || this.isClosing || active.view.stopRequested)
        throw new AgentError("plan_run_unavailable");
      active.view = {
        ...active.view,
        status: "running",
        steps: active.view.steps.map((step) =>
          step.status === "paused" ? { ...step, status: "waiting" } : step,
        ),
      };
      await this.dependencies.runs.update(active.view);
      if (active.notes)
        await this.dependencies.notes?.setPaused(active.notes, {
          isPaused: false,
        });
    });
    await this.pump();
  }

  /** The shutdown hook drains execution before closing DuckDB or the shared CLI runner. */
  public async shutdown(): Promise<void> {
    this.isClosing = true;
    await this.dependencies.notesCleanup?.shutdown();
    for (const id of this.active.keys()) await this.stop(id);
    await Promise.all([...this.pending]);
    await this.pump();
  }

  private async pump(): Promise<void> {
    await this.closeIdleGroups();
    await this.writes.run(async () => {
      for (const [id, active] of this.active) {
        updateBlocked(active);
        const ready =
          active.view.stopRequested || active.view.status === "paused"
            ? []
            : readySteps(active);
        for (const step of ready) {
          if (this.runningCount() >= 2) break;
          const controller = new AbortController();
          active.controllers.set(step.id, controller);
          patchStep(active, step.id, { status: "running" });
          await this.dependencies.runs.update(active.view);
          const pending = this.execute(active, step, controller);
          this.pending.add(pending);
          active.executions.add(pending);
          void pending.then(() => {
            this.pending.delete(pending);
            active.executions.delete(pending);
          });
        }
        if (canFinalize(active)) {
          const hasFailure = active.view.steps.some(
            (step) =>
              step.status === "failed" ||
              step.status === "waiting" ||
              step.isBlocked,
          );
          let status: AgentPlanRun["status"] = "succeeded";
          if (hasFailure) status = "failed";
          if (active.view.stopRequested) status = "cancelled";
          active.view = { ...active.view, status };
          await this.dependencies.runs.update(active.view);
          await this.dependencies.archive?.complete(
            active.view,
            active.snapshot,
          );
          if (active.notes)
            await this.dependencies.notes?.complete(active.view, active.notes);
          await active.releaseDefinition?.();
          this.active.delete(id);
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
          readySteps(active).length === 0 &&
          (active.view.status !== "paused" || active.view.stopRequested),
      );
      for (const active of idle) active.groupCloseout = "closing";
      return Promise.resolve(idle);
    });
    for (const active of closing) {
      if (active.snapshot.groups?.length)
        await this.dependencies.steps.closeGroups(active.view.id);
      active.groupCloseout = "closed";
    }
  }

  private runningCount(): number {
    return [...this.active.values()].reduce(
      (count, active) => count + active.controllers.size,
      0,
    );
  }

  private async failStart(id: string): Promise<void> {
    const active = this.active.get(id);
    if (!active) return;
    requestCancellation(active);
    for (const controller of active.controllers.values()) controller.abort();
    if (
      active.executions.size > 0 ||
      active.view.steps.some((step) => step.session)
    ) {
      await Promise.all([...active.executions]);
      // Running adapters retain their files until their confirmed closeout and normal finalization.
      try {
        await this.pump();
      } catch (error: unknown) {
        console.error("Pages could not finalize a failed plan start.", error);
      }
      return;
    }
    active.view = {
      ...active.view,
      status: "failed",
      steps: active.view.steps.map((step) => ({
        ...step,
        status: "cancelled",
        cancellation: "not_started",
      })),
    };
    if (active.notes) await this.dependencies.notes?.discard(active.notes);
    await active.releaseDefinition?.();
    this.active.delete(id);
    try {
      await this.dependencies.runs.update(active.view);
    } catch (error: unknown) {
      console.error(
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
    const changes = await this.outcome(active, node, controller);
    try {
      await this.writes.run(async () => {
        patchStep(active, node.id, changes);
        active.controllers.delete(node.id);
        await this.dependencies.runs.update(active.view);
        await this.dependencies.archive?.complete(active.view, active.snapshot);
      });
      await this.pump();
    } catch {
      // Keep persistent reservations if progress cannot be saved; no further providers may start.
      requestCancellation(active);
      for (const running of active.controllers.values()) running.abort();
      console.error(
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
    const step = active.snapshot.steps.find(
      (entry) => entry.step.id === node.id,
    );
    if (step) {
      if (isStopped)
        return { status: "cancelled", cancellation: "not_started" };
      return this.dependencies.steps.run(active.view, active.snapshot, step, {
        notes: active.notes ?? undefined,
        signal: controller.signal,
        save: (session) => this.saveSession(active, node.id, session),
      });
    }
    try {
      if (isStopped) throw new AgentPlanCancelledError();
      await this.dependencies.start.control(active.view, active.snapshot, node);
      return { status: "succeeded", output: null, error: null };
    } catch (error: unknown) {
      if (error instanceof AgentPlanCancelledError)
        return { status: "cancelled", cancellation: "not_started" };
      return {
        status: "failed",
        error:
          error instanceof AgentError || error instanceof TextAssistantError
            ? error.code
            : "plan_step_failed",
      };
    }
  }

  /** Stores the newest record of a running node; a failure is reported, never thrown. */
  private async saveSession(
    active: ActivePlanRun,
    stepId: string,
    session: AgentPlanSessionRecord,
  ): Promise<void> {
    try {
      await this.writes.run(async () => {
        patchStep(active, stepId, { session });
        await this.dependencies.runs.update(active.view);
      });
    } catch (error: unknown) {
      console.error(
        "Pages could not store the record of an agent node.",
        error,
      );
    }
  }
}

function canFinalize(active: ActivePlanRun): boolean {
  return (
    active.controllers.size === 0 &&
    active.groupCloseout === "closed" &&
    readySteps(active).length === 0 &&
    (active.view.status !== "paused" || active.view.stopRequested)
  );
}
