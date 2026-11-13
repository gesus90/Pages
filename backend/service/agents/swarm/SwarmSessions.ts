import { randomUUID } from "node:crypto";

import { AcpAdmissionTimeoutError } from "@/backend/service/agents/resources/AcpAdmissionRequest";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";
import { acpRunOptions, isAcpProvider } from "@/definition/AgentConfiguration";
import { mergeAgentTodos } from "@/definition/AgentPlanAgentTodos";
import { agentModelKey } from "@/definition/AgentPlanConfiguration";
import { PLAN_SWARM_START_TIMEOUT_MS } from "@/definition/AgentPlanSwarm";
import { agentSwarmWorkerStep } from "@/definition/AgentPlanSwarmOperations";

import { turnFailureCode } from "../AgentPlanSessionRecords";
import { SwarmStartError } from "./SwarmPorts";

import type { SessionUpdate } from "@agentclientprotocol/sdk";
import type {
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanConfiguration } from "@/definition/AgentPlanConfiguration";
import type { AgentPlanAgentTodo } from "@/definition/AgentPlanAgentTodos";
import type {
  AgentPlanSwarmAccess,
  AgentPlanSwarmModel,
} from "@/definition/AgentPlanSwarm";
import type { AgentSwarmRole } from "@/definition/AgentPlanSwarmOperations";
import type { AgentProfileService } from "../AgentProfileService";
import type { AgentPlanSessionGrants } from "../AgentPlanSessionAccess";
import type { SwarmTurn } from "./SwarmPorts";

/** What the sessions of a swarm need from the server. */
export interface SwarmSessionDependencies {
  readonly execution: Pick<PlanExecution, "open">;
  readonly grants: Pick<AgentPlanSessionGrants, "grant" | "revoke">;
  readonly profiles: Pick<AgentProfileService, "resolveDefinition">;
  /** The ACP places: the limit and how many are taken now; absent without a scheduler. */
  readonly capacity?: () => { readonly limit: number; readonly active: number };
}

/** The run, node and directory every session of one swarm shares. */
export interface SwarmSessionScope {
  readonly userId: string;
  readonly runId: string;
  readonly nodeId: string;
  readonly projectId: string;
  readonly directory: string;
  /** Epoch milliseconds when the time limit of the node ends. */
  readonly deadline: number;
  /** Rechecks the executor's access right before a process starts. */
  readonly beforeStart: () => Promise<void>;
}

/** One session to open: which side, its model and access and its first prompt. */
export interface SwarmSessionRequest {
  readonly role: AgentSwarmRole;
  /** `H1` … `H10` for a helper; absent for the main model. */
  readonly workerId?: string;
  readonly model: AgentPlanSwarmModel;
  readonly access: AgentPlanSwarmAccess;
  readonly prompt: string;
  readonly signal: AbortSignal;
  /** Receives the TODO list of the session as the CLI reports it. */
  readonly todos: (todos: readonly AgentPlanAgentTodo[]) => void;
}

/** An open session of a swarm and the turn of its first prompt. */
export interface SwarmOpenedSession {
  readonly session: PlanSession;
  readonly turn: Promise<SwarmTurn>;
  /** Runs a further prompt as the next turn. */
  readonly next: (prompt: string, signal: AbortSignal) => Promise<SwarmTurn>;
  /** Closes the session and ends its tool access; never throws. */
  readonly close: () => Promise<void>;
}

const OBSERVER: PlanSessionObserver = {
  started: () => undefined,
  identified: () => undefined,
};

/** Turns the end of a session turn into the turn of a swarm. */
export function swarmTurnOf(turn: PlanSessionTurn): SwarmTurn {
  const code = turnFailureCode(turn);
  return {
    output: turn.output,
    failure: turn.failure ?? (code === null ? null : "failed"),
    errorCode: code === null || code === "timeout" ? null : code,
  };
}

function runMode(access: AgentPlanSwarmAccess): "read_only" | "yolo" {
  return access === "read_only" ? "read_only" : "yolo";
}

function reachOf(access: AgentPlanSwarmAccess): "read" | "full" {
  return access === "yolo" ? "full" : "read";
}

function configurationOf(
  model: AgentPlanSwarmModel,
  access: AgentPlanSwarmAccess,
  minutes: number,
): AgentPlanConfiguration {
  return {
    name: model.model.slice(0, 200),
    revision: 1,
    modelProfileId: agentModelKey(model.connectionId, model.model),
    connectionId: model.connectionId,
    model: model.model,
    provider: model.provider,
    reasoningEffort: model.reasoningEffort,
    template: {
      markdown: "",
      parameters: [],
      directoryParameter: null,
      run: acpRunOptions(runMode(access), minutes),
    },
  };
}

function startReason(error: unknown): string {
  if (error instanceof SwarmStartError) return error.reason;
  if (error instanceof AcpAdmissionTimeoutError) return "acp_capacity";
  if (error instanceof AgentError) return error.code;
  return "swarm_worker_start_failed";
}

/**
 * Opens the main session and the helper sessions of one swarm (PAGE-313).
 *
 * @remarks
 * Every session goes through the ordinary ACP path with its isolation and
 * the shared resource scheduler, in the working directory of the swarm, with
 * its own model, its own Pages tool access and its own TODO list. A helper
 * gets a place only within {@link PLAN_SWARM_START_TIMEOUT_MS} and only while
 * one place stays free for others; otherwise it does not start and the node
 * goes on without it.
 */
export class SwarmSessions {
  private readonly dependencies: SwarmSessionDependencies;
  private readonly scope: SwarmSessionScope;

  public constructor(
    dependencies: SwarmSessionDependencies,
    scope: SwarmSessionScope,
  ) {
    this.dependencies = dependencies;
    this.scope = scope;
  }

  /**
   * Opens a session with its first prompt.
   *
   * @throws {SwarmStartError} For a helper that gets no session, with its reason.
   */
  public async open(request: SwarmSessionRequest): Promise<SwarmOpenedSession> {
    const isWorker = request.role === "worker";
    if (isWorker) this.requireCapacity();
    const stepId = isWorker
      ? agentSwarmWorkerStep(this.scope.nodeId, request.workerId ?? "")
      : this.scope.nodeId;
    try {
      return await this.start(request, stepId);
    } catch (error: unknown) {
      await this.dependencies.grants
        .revoke(this.scope.runId, stepId)
        .catch((revokeError: unknown) => {
          logCaughtError("SwarmSessions", revokeError);
        });
      if (!isWorker || request.signal.aborted) throw error;
      throw new SwarmStartError(startReason(error));
    }
  }

  /** Refuses a helper unless a place stays free after it: a swarm takes the free places minus one. */
  private requireCapacity(): void {
    const capacity = this.dependencies.capacity?.();
    if (!capacity) return;
    if (capacity.limit - capacity.active < 2)
      throw new SwarmStartError("acp_worker_limit");
  }

  private minutesLeft(): number {
    return Math.max(1, Math.ceil((this.scope.deadline - Date.now()) / 60_000));
  }

  private async start(
    request: SwarmSessionRequest,
    stepId: string,
  ): Promise<SwarmOpenedSession> {
    const minutes = this.minutesLeft();
    const configuration = configurationOf(
      request.model,
      request.access,
      minutes,
    );
    const { assignment } = await this.dependencies.profiles.resolveDefinition(
      this.scope.userId,
      {
        agentId: stepId,
        personalAgentId: null,
        projectId: this.scope.projectId,
        configuration,
      },
    );
    if (!isAcpProvider(assignment.connection.provider))
      throw new AgentError("provider_invalid");
    const instanceId = randomUUID();
    const mcp = await this.dependencies.grants.grant({
      userId: this.scope.userId,
      runId: this.scope.runId,
      stepId,
      instanceId,
      tickets: [],
      lifetimeMs: minutes * 60_000,
      reach: reachOf(request.access),
      swarm: request.role,
    });
    const base = {
      agent: assignment,
      userId: this.scope.userId,
      directory: this.scope.directory,
      beforeStart: this.scope.beforeStart,
    };
    const session = await this.dependencies.execution.open(
      {
        ...base,
        prompt: request.prompt,
        options:
          configuration.template.run ?? acpRunOptions("read_only", minutes),
        instanceId,
        mcp,
        journal: this.journal(request.todos),
        resourceContext: {
          runId: this.scope.runId,
          stepId,
          ...(request.role === "worker"
            ? { admissionDeadlineMs: PLAN_SWARM_START_TIMEOUT_MS }
            : {}),
        },
      },
      request.signal,
      OBSERVER,
    );
    return this.opened(session, { base, stepId });
  }

  private opened(
    session: PlanSession,
    context: {
      readonly base: {
        readonly agent: Awaited<
          ReturnType<AgentProfileService["resolveDefinition"]>
        >["assignment"];
        readonly userId: string;
        readonly directory: string;
        readonly beforeStart: () => Promise<void>;
      };
      readonly stepId: string;
    },
  ): SwarmOpenedSession {
    return {
      session,
      turn: session.turn.then(swarmTurnOf),
      next: async (prompt, signal) => {
        if (!session.next) throw new AgentError("plan_session_unavailable");
        return swarmTurnOf(
          await session.next({ ...context.base, prompt }, signal, OBSERVER),
        );
      },
      close: async () => {
        try {
          await session.close();
        } catch (error: unknown) {
          logCaughtError("SwarmSessions", error);
        }
        await this.dependencies.grants
          .revoke(this.scope.runId, context.stepId)
          .catch((error: unknown) => {
            logCaughtError("SwarmSessions", error);
          });
      },
    };
  }

  /** Keeps the newest ACP plan of the session as its TODO list. */
  private journal(
    report: (todos: readonly AgentPlanAgentTodo[]) => void,
  ): NonNullable<Parameters<PlanExecution["open"]>[0]["journal"]> {
    let previous: readonly AgentPlanAgentTodo[] = [];
    return {
      update: (update: SessionUpdate) => {
        if (update.sessionUpdate !== "plan") return;
        previous = mergeAgentTodos(
          update.entries.map((entry) => ({
            content: entry.content,
            status: entry.status,
          })),
          previous,
          new Date().toISOString(),
        );
        report(previous);
      },
      prompted: () => undefined,
      closed: () => undefined,
    };
  }
}
