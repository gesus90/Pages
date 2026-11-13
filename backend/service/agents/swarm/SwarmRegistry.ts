import { z } from "zod";

import {
  AGENT_SWARM_MAIN_OPERATIONS,
  readAgentSwarmStep,
} from "@/definition/AgentPlanSwarmOperations";
import { PLAN_SWARM_PATH_LENGTH } from "@/definition/AgentPlanSwarmScope";
import { PLAN_SWARM_RUN_TEXT } from "@/definition/AgentPlanSwarmRun";

import type { AgentSwarmOperation } from "@/definition/AgentPlanSwarmOperations";
import type { SwarmCoordinator } from "./SwarmCoordinator";

/** One tool call of a swarm session, named by the run and step of its credential. */
export interface SwarmCall {
  readonly runId: string;
  readonly stepId: string;
  readonly operation: AgentSwarmOperation;
  readonly parameters: unknown;
}

/** Why a swarm call was refused before it reached the board. */
export type SwarmCallRefusal = "FORBIDDEN" | "INVALID_REQUEST";

/** A refused call; the caller maps it to the agent API error. */
export class SwarmCallError extends Error {
  public readonly code: SwarmCallRefusal;

  /** @param code - Whether the session may not call it or the input is invalid. */
  public constructor(code: SwarmCallRefusal) {
    super(`Swarm call refused: ${code}`);
    this.name = "SwarmCallError";
    this.code = code;
  }
}

const worker = z.string().regex(/^H(?:[1-9]|10)$/u);
const task = z.string().regex(/^T[0-9]{1,4}$/u);
const path = z.string().min(1).max(PLAN_SWARM_PATH_LENGTH);

const inputs = {
  "run.swarm.assign": z.strictObject({
    instruction: z.string().max(PLAN_SWARM_RUN_TEXT).optional(),
    workerId: worker.optional(),
    scope: z.array(path).max(64).optional(),
    taskId: task.optional(),
  }),
  "run.swarm.status": z.strictObject({
    waitSeconds: z.number().int().min(0).max(60).optional(),
    sinceVersion: z.number().int().min(0).optional(),
  }),
  "run.swarm.result": z.strictObject({ taskId: task }),
  "run.swarm.cancel": z.strictObject({ taskId: task }),
  "run.swarm.finish": z.strictObject({
    status: z.enum(["succeeded", "failed"]),
    summary: z.string().min(1).max(PLAN_SWARM_RUN_TEXT),
  }),
  "run.swarm.lock": z.strictObject({ path }),
  "run.swarm.unlock": z.strictObject({ path }),
  "run.swarm.locks": z.strictObject({}),
} as const;

function parse<Input>(schema: z.ZodType<Input>, parameters: unknown): Input {
  const parsed = schema.safeParse(parameters ?? {});
  if (!parsed.success) throw new SwarmCallError("INVALID_REQUEST");
  return parsed.data;
}

/**
 * The live swarms of this process, by run and node (PAGE-313).
 *
 * @remarks
 * A call reaches only the swarm its credential names: the run and the step
 * of the credential are the key, so a session never reaches another run.
 * The main model calls the main tools only, a helper only its lock tools,
 * and only while it works on a subtask.
 */
export class AgentPlanSwarmRegistry {
  private readonly coordinators = new Map<string, SwarmCoordinator>();

  /**
   * Makes a swarm reachable for the sessions of its node.
   *
   * @returns Removes it again.
   */
  public register(
    runId: string,
    nodeId: string,
    coordinator: SwarmCoordinator,
  ): () => void {
    const key = JSON.stringify([runId, nodeId]);
    this.coordinators.set(key, coordinator);
    return () => {
      if (this.coordinators.get(key) === coordinator)
        this.coordinators.delete(key);
    };
  }

  /** Whether the swarm a call names runs in this process. */
  public has(runId: string, stepId: string): boolean {
    return this.find(runId, stepId) !== undefined;
  }

  /**
   * Runs one tool call against the board; it never waits.
   *
   * @throws {SwarmCallError} `FORBIDDEN` for a swarm of another run or step
   * or a tool of the other side, `INVALID_REQUEST` for invalid input.
   */
  public handle(call: SwarmCall): unknown {
    const coordinator = this.find(call.runId, call.stepId);
    if (!coordinator) throw new SwarmCallError("FORBIDDEN");
    const { workerId } = readAgentSwarmStep(call.stepId);
    const isMainCall = AGENT_SWARM_MAIN_OPERATIONS.some(
      (operation) => operation === call.operation,
    );
    if (isMainCall !== (workerId === null))
      throw new SwarmCallError("FORBIDDEN");
    if (workerId === null) return this.main(coordinator, call);
    return this.worker(coordinator, workerId, call);
  }

  private find(runId: string, stepId: string): SwarmCoordinator | undefined {
    const { nodeId } = readAgentSwarmStep(stepId);
    return this.coordinators.get(JSON.stringify([runId, nodeId]));
  }

  private main(coordinator: SwarmCoordinator, call: SwarmCall): unknown {
    switch (call.operation) {
      case "run.swarm.assign": {
        const input = parse(inputs[call.operation], call.parameters);
        return coordinator.assign({
          instruction: input.instruction ?? "",
          workerId: input.workerId ?? null,
          scope: input.scope ?? [],
          taskId: input.taskId ?? null,
        });
      }
      case "run.swarm.status":
        parse(inputs[call.operation], call.parameters);
        return { version: coordinator.version(), ...coordinator.view() };
      case "run.swarm.result":
        return coordinator.result(
          parse(inputs[call.operation], call.parameters).taskId,
        );
      case "run.swarm.cancel":
        return coordinator.cancel(
          parse(inputs[call.operation], call.parameters).taskId,
        );
      case "run.swarm.finish":
        return coordinator.finish(
          parse(inputs[call.operation], call.parameters),
        );
      case "run.swarm.lock":
      case "run.swarm.unlock":
      case "run.swarm.locks":
        throw new SwarmCallError("FORBIDDEN");
    }
  }

  private worker(
    coordinator: SwarmCoordinator,
    workerId: string,
    call: SwarmCall,
  ): unknown {
    switch (call.operation) {
      case "run.swarm.lock":
        return coordinator.lock(
          workerId,
          parse(inputs[call.operation], call.parameters).path,
        );
      case "run.swarm.unlock":
        return coordinator.unlock(
          workerId,
          parse(inputs[call.operation], call.parameters).path,
        );
      case "run.swarm.locks":
        parse(inputs[call.operation], call.parameters);
        if (!coordinator.isWorkerActive(workerId))
          return { status: "refused", code: "swarm_worker_inactive" };
        return { locks: coordinator.listLocks() };
      case "run.swarm.assign":
      case "run.swarm.status":
      case "run.swarm.result":
      case "run.swarm.cancel":
      case "run.swarm.finish":
        throw new SwarmCallError("FORBIDDEN");
    }
  }
}

/** The registry of this process; the run engine registers, the socket and the API read. */
export const PROCESS_SWARM_REGISTRY = new AgentPlanSwarmRegistry();

/**
 * Answers a swarm call the API handed to this engine process over its socket.
 *
 * @param request - The checked socket request.
 * @param registry - The swarms of this process.
 * @returns The result, or the refusal the API turns back into an error.
 */
export function answerSwarmCall(
  request: {
    readonly runId: string;
    readonly stepId: string;
    readonly swarmOperation: AgentSwarmOperation;
    readonly parameters?: unknown;
  },
  registry: Pick<AgentPlanSwarmRegistry, "handle"> = PROCESS_SWARM_REGISTRY,
): unknown {
  try {
    return {
      result: registry.handle({
        runId: request.runId,
        stepId: request.stepId,
        operation: request.swarmOperation,
        parameters: request.parameters,
      }),
    };
  } catch (error: unknown) {
    if (error instanceof SwarmCallError) return { refused: error.code };
    throw error;
  }
}
