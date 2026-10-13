import { randomUUID } from "node:crypto";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentError } from "@/backend/error/AgentErrors";
import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { TextAssistantError } from "@/backend/error/TextAssistantErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { isPlanFlowNode } from "@/definition/AgentPlanGraph";

import { sanitizePlanOutput } from "./AgentPlanOutput";
import { hasPlanPath } from "./AgentPlanGraph";

import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanRunRepository } from "@/backend/database/repositories/agent/AgentPlanRunRepository";
import type {
  AgentPlanNode,
  AgentPlanRun,
  AgentPlanStepResult,
} from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "./AgentPlanSnapshot";
import type { AgentPlanStepStart } from "./AgentPlanStepStart";
import type { AgentRunArchive } from "./AgentRunArchive";
import type { AgentDefinitionFiles } from "./AgentDefinitionFiles";

interface ActivePlanRun {
  view: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly controllers: Map<string, AbortController>;
  readonly releaseDefinition?: () => Promise<void>;
}

interface EngineDependencies {
  readonly runs: AgentPlanRunRepository;
  readonly start: AgentPlanStepStart;
  readonly execution: PlanExecution;
  readonly archive?: AgentRunArchive;
  readonly files?: AgentDefinitionFiles;
}

function patchStep(
  active: ActivePlanRun,
  id: string,
  changes: Partial<AgentPlanStepResult>,
): void {
  active.view = {
    ...active.view,
    steps: active.view.steps.map((step) =>
      step.id === id ? { ...step, ...changes } : step,
    ),
  };
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

  /** Persists a snapshot and reserves writing copies before returning a new Play run. */
  public async start(
    userId: string,
    snapshot: AgentPlanSnapshot,
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
      steps: snapshot.plan.nodes
        .filter((node) => isPlanFlowNode(node, snapshot.plan))
        .map((node) => ({
          id: node.id,
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
    const workspaceIds = snapshot.steps.flatMap((step) =>
      !isApiProvider(step.provider) && step.prepared.directory
        ? [step.prepared.directory.id]
        : [],
    );
    const releaseDefinition = await this.dependencies.files?.hold(
      snapshot.steps.map((step) => step.step.agentId),
    );
    try {
      await this.dependencies.runs.create(view, snapshot, workspaceIds);
    } catch (error: unknown) {
      await releaseDefinition?.();
      throw error;
    }
    this.active.set(view.id, {
      view,
      snapshot,
      controllers: new Map(),
      releaseDefinition,
    });
    await this.pump();
    return (await this.dependencies.runs.find(view.id)) ?? view;
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
    await this.pump();
  }

  /** Persists pause before scheduling can start another node; in-flight nodes settle normally. */
  public async pause(id: string): Promise<void> {
    await this.writes.run(async () => {
      const active = this.active.get(id);
      if (!active || active.view.stopRequested)
        throw new AgentError("plan_run_unavailable");
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
    });
    await this.pump();
  }

  /** The shutdown hook drains execution before closing DuckDB or the shared CLI runner. */
  public async shutdown(): Promise<void> {
    this.isClosing = true;
    for (const id of this.active.keys()) await this.stop(id);
    await Promise.all([...this.pending]);
    await this.pump();
  }

  private async pump(): Promise<void> {
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
          void pending.then(() => this.pending.delete(pending));
        }
        if (
          active.controllers.size === 0 &&
          readySteps(active).length === 0 &&
          (active.view.status !== "paused" || active.view.stopRequested)
        ) {
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
          await active.releaseDefinition?.();
          this.active.delete(id);
        }
      }
    });
  }

  private runningCount(): number {
    return [...this.active.values()].reduce(
      (count, active) => count + active.controllers.size,
      0,
    );
  }

  private async execute(
    active: ActivePlanRun,
    node: AgentPlanNode,
    controller: AbortController,
  ): Promise<void> {
    let hasStarted = false;
    let changes: Partial<AgentPlanStepResult>;
    try {
      if (active.view.stopRequested || controller.signal.aborted)
        throw new AgentPlanCancelledError();
      const step = active.snapshot.steps.find(
        (entry) => entry.step.id === node.id,
      );
      let output: string | null = null;
      if (step) {
        const input = await this.dependencies.start.prepare(
          active.view,
          active.snapshot,
          step,
        );
        if (active.view.stopRequested || controller.signal.aborted)
          throw new AgentPlanCancelledError();
        await this.dependencies.archive?.input(
          active.view.id,
          node.id,
          input.prompt,
        );
        hasStarted = true;
        output = sanitizePlanOutput(
          await this.dependencies.execution.run(input, controller.signal),
        );
      } else {
        await this.dependencies.start.control(
          active.view,
          active.snapshot,
          node,
        );
      }
      changes = {
        status: "succeeded",
        output,
        error: null,
      };
    } catch (error: unknown) {
      changes =
        error instanceof AgentPlanCancelledError
          ? {
              status: "cancelled",
              cancellation: hasStarted ? "confirmed" : "not_started",
            }
          : {
              status: "failed",
              error:
                error instanceof AgentError ||
                error instanceof TextAssistantError
                  ? error.code
                  : "plan_step_failed",
            };
    }
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
}
