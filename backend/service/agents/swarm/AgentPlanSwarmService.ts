import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { SwarmCallError } from "./SwarmRegistry";

import type { AgentRunScope } from "@/definition/McpAuthorization";
import type {
  AgentSwarmOperation,
  AgentSwarmToolResult,
} from "@/definition/AgentPlanSwarmOperations";
import type { AgentPlanSwarmRegistry, SwarmCall } from "./SwarmRegistry";

/** How long one wait of `swarm_status` sleeps between two reads of the board. */
const STATUS_POLL_MS = 1000;

/** What the agent API of a process needs to reach the swarms. */
export interface AgentPlanSwarmServiceDependencies {
  /** The swarms that run in this process. */
  readonly local: Pick<AgentPlanSwarmRegistry, "has" | "handle">;
  /** Hands a call to the run engine process; `null` when no engine is reachable. */
  readonly forward: ((call: SwarmCall) => Promise<unknown>) | null;
  /** Sleeps between two reads of a waiting `swarm_status`. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** The clock in epoch milliseconds. */
  readonly now?: () => number;
}

function sleepFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function versionOf(result: unknown): number | null {
  if (typeof result !== "object" || result === null) return null;
  const version: unknown = Reflect.get(result, "version");
  return typeof version === "number" ? version : null;
}

function waitSeconds(parameters: unknown): number {
  if (typeof parameters !== "object" || parameters === null) return 0;
  const seconds: unknown = Reflect.get(parameters, "waitSeconds");
  return typeof seconds === "number" && seconds > 0 ? Math.min(seconds, 60) : 0;
}

/**
 * Serves the swarm tools of plan sessions in the agent API (PAGE-313).
 *
 * @remarks
 * The credential alone names run and step, so a session reaches only its own
 * swarm. A swarm lives in the process of the run engine; when that is another
 * process, every call goes through its private socket. A call never waits for
 * a helper or a lock: a waiting `swarm_status` reads the board again once a
 * second and returns at its first change or when its time is up.
 */
export class AgentPlanSwarmService {
  private readonly dependencies: AgentPlanSwarmServiceDependencies;

  public constructor(dependencies: AgentPlanSwarmServiceDependencies) {
    this.dependencies = dependencies;
  }

  /**
   * Runs one swarm tool call of a session.
   *
   * @throws {AgentOperationError} `FORBIDDEN` for a session without this swarm,
   * `INVALID_REQUEST` for invalid input.
   */
  public async handle(
    scope: AgentRunScope,
    operation: AgentSwarmOperation,
    parameters: unknown,
  ): Promise<AgentSwarmToolResult> {
    return { swarm: await this.answer(scope, operation, parameters) };
  }

  private async answer(
    scope: AgentRunScope,
    operation: AgentSwarmOperation,
    parameters: unknown,
  ): Promise<unknown> {
    const call: SwarmCall = {
      runId: scope.runId,
      stepId: scope.stepId,
      operation,
      parameters: this.withoutWait(operation, parameters),
    };
    const first = await this.call(call);
    const seconds =
      operation === "run.swarm.status" ? waitSeconds(parameters) : 0;
    if (seconds === 0) return first;
    const now = this.dependencies.now ?? Date.now;
    const sleep = this.dependencies.sleep ?? sleepFor;
    const deadline = now() + seconds * 1000;
    const version = versionOf(first);
    let latest = first;
    while (now() < deadline && versionOf(latest) === version) {
      await sleep(Math.min(STATUS_POLL_MS, Math.max(0, deadline - now())));
      latest = await this.call(call);
    }
    return latest;
  }

  private withoutWait(
    operation: AgentSwarmOperation,
    parameters: unknown,
  ): unknown {
    if (operation !== "run.swarm.status") return parameters;
    return {};
  }

  private async call(call: SwarmCall): Promise<unknown> {
    try {
      if (this.dependencies.local.has(call.runId, call.stepId))
        return this.dependencies.local.handle(call);
      if (!this.dependencies.forward) throw new SwarmCallError("FORBIDDEN");
      return await this.dependencies.forward(call);
    } catch (error: unknown) {
      if (error instanceof SwarmCallError)
        throw new AgentOperationError(error.code);
      throw error;
    }
  }
}
