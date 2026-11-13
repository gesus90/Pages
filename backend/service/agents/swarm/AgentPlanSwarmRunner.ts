import path from "node:path";

import { AgentPlanCancelledError } from "@/backend/error/AgentPlanCancelledError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  PLAN_SWARM_LEASE_MS,
  PLAN_SWARM_TASK_BINDING,
  planSwarmIssues,
  planSwarmWorkerList,
} from "@/definition/AgentPlanSwarm";

import { errorCode } from "../AgentPlanStepFailure";
import { SwarmCoordinator } from "./SwarmCoordinator";
import { SwarmGitProbe } from "./SwarmGitProbe";
import { SwarmMainLoop } from "./SwarmMainLoop";
import { SwarmSessions } from "./SwarmSessions";

import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";
import type { AgentPlanSwarm } from "@/definition/AgentPlanSwarm";
import type { AgentPlanSwarmRun } from "@/definition/AgentPlanSwarmRun";
import type { AgentPlanSwarmRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmRepository";
import type { AgentPlanSnapshot } from "../AgentPlanSnapshot";
import type { AgentPlanTasks } from "../AgentPlanTasks";
import type { AgentWorkspaceService } from "../AgentWorkspaceService";
import type { SwarmSessionDependencies } from "./SwarmSessions";
import type { AgentPlanSwarmRegistry } from "./SwarmRegistry";
import type { SwarmStoredBoard, SwarmWorkerLauncher } from "./SwarmPorts";

/** What a swarm node needs from the server. */
export interface AgentPlanSwarmRunnerDependencies extends SwarmSessionDependencies {
  readonly tasks: Pick<AgentPlanTasks, "snapshot">;
  readonly workspaces: Pick<AgentWorkspaceService, "resolve">;
  readonly boards: Pick<
    AgentPlanSwarmRepository,
    "find" | "save" | "saveTodos"
  >;
  readonly registry: Pick<AgentPlanSwarmRegistry, "register">;
}

/** One activation of a swarm node. */
export interface PlanSwarmRequest {
  readonly run: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly node: AgentPlanSwarm;
  readonly signal: AbortSignal;
  /** Rechecks the executor's access to the plan before every session. */
  readonly authorize: () => Promise<void>;
  /** Shows the lanes and board in the node result of the run. */
  readonly save: (view: AgentPlanSwarmRun) => Promise<void>;
}

/** The attempt the TODO lists of a swarm node are filed under. */
export function swarmTodoAttempt(runId: string, nodeId: string): string {
  return `swarm:${runId}:${nodeId}`;
}

/**
 * Runs a swarm node of a plan (PAGE-313).
 *
 * @remarks
 * The main model runs in one session with the swarm tools; every helper
 * starts at its first subtask in a session of its own, all in the working
 * directory of the swarm on the Pages host. The board is stored after every
 * change, so a resumed run continues it without running a finished subtask
 * again. The node fails only when the main model ends it as failed, its time
 * limit runs out or the main session is lost; a failing helper never fails it.
 */
export class AgentPlanSwarmRunner {
  private readonly dependencies: AgentPlanSwarmRunnerDependencies;

  public constructor(dependencies: AgentPlanSwarmRunnerDependencies) {
    this.dependencies = dependencies;
  }

  /** Runs one activation and returns the changes of the node result. */
  public async run(
    request: PlanSwarmRequest,
  ): Promise<Partial<AgentPlanStepResult>> {
    const { node, snapshot } = request;
    const issue = planSwarmIssues(node, snapshot.plan)[0];
    if (issue !== undefined)
      return { status: "failed", error: issue, output: null };
    const deadline = Date.now() + node.timeoutMinutes * 60_000;
    const timeout = AbortSignal.timeout(node.timeoutMinutes * 60_000);
    const signal = AbortSignal.any([request.signal, timeout]);
    try {
      await request.authorize();
      const directory = await this.directory(request);
      const task = await this.task(request);
      const stored = await this.stored(request.run, node.id);
      return await this.execute(request, {
        directory,
        task,
        stored,
        signal,
        deadline,
      });
    } catch (error: unknown) {
      if (timeout.aborted)
        return { status: "failed", error: "swarm_timeout", output: null };
      if (error instanceof AgentPlanCancelledError || request.signal.aborted)
        return { status: "cancelled", cancellation: "confirmed", output: null };
      logCaughtError("AgentPlanSwarmRunner", error);
      return { status: "failed", error: errorCode(error), output: null };
    }
  }

  private async execute(
    request: PlanSwarmRequest,
    context: {
      readonly directory: string;
      readonly task: string;
      readonly stored: SwarmStoredBoard | null;
      readonly signal: AbortSignal;
      readonly deadline: number;
    },
  ): Promise<Partial<AgentPlanStepResult>> {
    const { run, node, snapshot } = request;
    const sessions = new SwarmSessions(this.dependencies, {
      userId: run.userId,
      runId: run.id,
      nodeId: node.id,
      projectId: snapshot.plan.projectId,
      directory: context.directory,
      deadline: context.deadline,
      beforeStart: request.authorize,
    });
    const coordinator = this.coordinator(request, sessions, context);
    const unregister = this.dependencies.registry.register(
      run.id,
      node.id,
      coordinator,
    );
    const renewal = setInterval(
      () => coordinator.renewLeases(),
      PLAN_SWARM_LEASE_MS / 3,
    );
    renewal.unref();
    // The run view shows the empty lanes at once: the main model plans the split.
    await request.save(coordinator.view());
    const loop = new SwarmMainLoop(coordinator, sessions, {
      node,
      task: context.task,
      isResumed: context.stored !== null,
      signal: context.signal,
      todos: (todos) => this.saveTodos(request, "main", todos),
    });
    try {
      return await loop.run();
    } finally {
      clearInterval(renewal);
      await coordinator.shutdown();
      unregister();
      await request.save(coordinator.view()).catch((error: unknown) => {
        logCaughtError("AgentPlanSwarmRunner", error);
      });
    }
  }

  private coordinator(
    request: PlanSwarmRequest,
    sessions: SwarmSessions,
    context: {
      readonly directory: string;
      readonly stored: SwarmStoredBoard | null;
      readonly signal: AbortSignal;
    },
  ): SwarmCoordinator {
    const { run, node } = request;
    const workers = planSwarmWorkerList(node.workers);
    const launcher: SwarmWorkerLauncher = {
      open: async (workerId, first, events) => {
        const index = Number(workerId.slice(1)) - 1;
        const worker = workers[index];
        if (!worker?.model) throw new AgentPlanCancelledError();
        const opened = await sessions.open({
          role: "worker",
          workerId,
          model: worker.model,
          access: worker.access,
          prompt: first.prompt,
          signal: first.signal,
          todos: (todos) => {
            events.todos(todos);
            void this.saveTodos(request, workerId, todos);
          },
        });
        return {
          session: { run: opened.next, close: opened.close },
          turn: opened.turn,
        };
      },
    };
    return new SwarmCoordinator(
      {
        main: {
          provider: node.main.model?.provider ?? "",
          model: node.main.model?.model ?? "",
        },
        workers: workers.map((worker) => ({
          provider: worker.model?.provider ?? "",
          model: worker.model?.model ?? "",
          access: worker.access,
        })),
        instruction: node.workers.instruction ?? null,
        stored: context.stored,
        signal: context.signal,
      },
      {
        launcher,
        probe: new SwarmGitProbe(context.directory),
        save: async (board) => {
          await this.dependencies.boards.save(run.id, node.id, board);
          await request.save(board.view);
        },
        now: Date.now,
        leaseMs: PLAN_SWARM_LEASE_MS,
      },
    );
  }

  private async saveTodos(
    request: PlanSwarmRequest,
    workerId: string,
    todos: Parameters<SwarmCoordinator["showMainTodos"]>[0],
  ): Promise<void> {
    try {
      await this.dependencies.boards.saveTodos({
        runId: request.run.id,
        stepId: request.node.id,
        attemptId: swarmTodoAttempt(request.run.id, request.node.id),
        workerId,
        todos,
        updatedAt: new Date().toISOString(),
      });
    } catch (error: unknown) {
      logCaughtError("AgentPlanSwarmRunner", error);
    }
  }

  /** The working directory: the plan workspace or a directory below it, resolved with the executor's rights. */
  private async directory(request: PlanSwarmRequest): Promise<string> {
    const { plan } = request.snapshot;
    const workspace = await this.dependencies.workspaces.resolve(
      request.run.userId,
      plan.workspaceId,
      plan.projectId,
    );
    const relative = request.node.directory ?? "";
    const directory = path.resolve(workspace.path, relative);
    if (
      directory !== workspace.path &&
      !directory.startsWith(`${workspace.path}${path.sep}`)
    )
      throw new Error("swarm_directory_invalid");
    return directory;
  }

  /** The task: the text of the node, or the ticket bound as its task. */
  private async task(request: PlanSwarmRequest): Promise<string> {
    const { node, snapshot, run } = request;
    if (node.task.source === "text") return node.task.text;
    const binding = node.bindings[PLAN_SWARM_TASK_BINDING];
    const source =
      binding?.kind === "source"
        ? snapshot.plan.nodes.find((entry) => entry.id === binding.nodeId)
        : undefined;
    if (source?.type !== "task") throw new Error("swarm_task_missing");
    const ticket = await this.dependencies.tasks.snapshot(
      run.userId,
      snapshot.plan.projectId,
      source.taskId,
    );
    return ticket.markdown;
  }

  /** The board of this run, or of the run a resume continues. */
  private async stored(
    run: AgentPlanRun,
    nodeId: string,
  ): Promise<SwarmStoredBoard | null> {
    const own = await this.dependencies.boards.find(run.id, nodeId);
    if (own) return own;
    if (!run.origin || run.origin.kind !== "resume") return null;
    return this.dependencies.boards.find(run.origin.runId, nodeId);
  }
}
