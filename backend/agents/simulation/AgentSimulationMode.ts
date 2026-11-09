import { logEvent } from "@/backend/logging/Logger";
import { AGENT_SIMULATION_SCENARIOS } from "@/definition/AgentSimulation";

import type { AgentSimulationScenario } from "@/definition/AgentSimulation";

/** Whether the simulation is on and which scenario it plays. */
export interface AgentSimulationMode {
  readonly isActive: boolean;
  readonly scenario: AgentSimulationScenario;
}

const INACTIVE: AgentSimulationMode = { isActive: false, scenario: "ok" };

function readScenario(input: string | undefined): AgentSimulationScenario {
  return (
    AGENT_SIMULATION_SCENARIOS.find((scenario) => scenario === input) ?? "ok"
  );
}

/**
 * Reads the simulation switch of the process environment.
 *
 * @param environment - The environment, the process's own by default.
 * @returns Active only with `PAGES_AGENT_SIMULATION=1` outside production.
 *
 * @remarks
 * With `NODE_ENV=production` the switch is ignored and the ignoring is
 * logged, so a production instance never offers a simulated model and keeps
 * its real model connections.
 */
export function readAgentSimulationMode(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentSimulationMode {
  if (environment.PAGES_AGENT_SIMULATION !== "1") return INACTIVE;
  if (environment.NODE_ENV === "production") {
    logEvent({
      level: "warn",
      event: "agent.simulation.ignored",
      component: "AgentSimulationMode",
      message:
        "PAGES_AGENT_SIMULATION is ignored because NODE_ENV is production.",
    });
    console.warn(
      "[pages] PAGES_AGENT_SIMULATION=1 is ignored because NODE_ENV=production.",
    );
    return INACTIVE;
  }
  const scenario = readScenario(environment.PAGES_AGENT_SIMULATION_SCENARIO);
  logEvent({
    level: "info",
    event: "agent.simulation.active",
    component: "AgentSimulationMode",
    message: "The agent simulation is active; no model provider is contacted.",
    metadata: { scenario },
  });
  console.info(
    `[pages] Agent simulation active (scenario ${scenario}); no request goes to a model provider.`,
  );
  return { isActive: true, scenario };
}

let processMode: AgentSimulationMode | null = null;

/**
 * The simulation switch of this process, read and logged once.
 *
 * @returns The same mode on every call, so every part of Pages agrees.
 */
export function currentAgentSimulationMode(): AgentSimulationMode {
  processMode ??= readAgentSimulationMode();
  return processMode;
}
