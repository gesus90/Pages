import { AgentError } from "@/backend/error/AgentErrors";
import { agentSimulationRunner } from "@/definition/AgentSimulation";

import type {
  AgentPlanSessionInput,
  PlanExecution,
  PlanSession,
  PlanSessionObserver,
} from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanExecutionInput } from "@/backend/service/agents/AgentPlanStepStart";
import type { AgentSimulationMode } from "./AgentSimulationMode";
import type { AgentSimulator } from "./AgentSimulator";

/**
 * The plan execution while the agent simulation is on.
 *
 * @remarks
 * A node that chose a simulation model runs the simulated agent. Every other
 * request and every CLI session is refused with
 * `plan_simulation_external_blocked`, so no request reaches a model provider
 * while the simulation runs. With the simulation off, everything passes to
 * the real execution unchanged.
 */
export class SimulatedPlanExecution implements PlanExecution {
  private readonly real: PlanExecution;
  private readonly simulator: AgentSimulator;
  private readonly mode: AgentSimulationMode;

  public constructor(
    real: PlanExecution,
    simulator: AgentSimulator,
    mode: AgentSimulationMode,
  ) {
    this.real = real;
    this.simulator = simulator;
    this.mode = mode;
  }

  /** Whether native plan sessions use the independent local owner. */
  public get hasDurableLocalSessions(): boolean {
    return this.real.hasDurableLocalSessions === true;
  }

  /** Releases the real session owners after a plan settled. */
  public async finishPlanRun(
    runId: string,
    status: "succeeded" | "failed" | "cancelled",
  ): Promise<void> {
    await this.real.finishPlanRun?.(runId, status);
  }

  /** Runs the simulated agent, or the real request when the simulation is off. */
  public async run(
    input: AgentPlanExecutionInput,
    signal: AbortSignal,
  ): Promise<string> {
    const runner = agentSimulationRunner(input.agent.connection.id);
    if (runner !== null) {
      if (!this.mode.isActive) throw new AgentError("connection_not_found");
      return this.simulator.run(input, signal);
    }
    if (this.mode.isActive)
      throw new AgentError("plan_simulation_external_blocked");
    return this.real.run(input, signal);
  }

  /** Opens a real CLI session; the simulation refuses every one. */
  public async open(
    input: AgentPlanSessionInput,
    signal: AbortSignal,
    observer: PlanSessionObserver,
  ): Promise<PlanSession> {
    if (this.mode.isActive)
      throw new AgentError("plan_simulation_external_blocked");
    return this.real.open(input, signal, observer);
  }
}

/** A transport for provider requests that refuses every request while the simulation is on. */
export function simulationGuardedFetch(
  mode: AgentSimulationMode,
): typeof fetch {
  if (!mode.isActive) return fetch;
  return () =>
    Promise.reject(new AgentError("plan_simulation_external_blocked"));
}
