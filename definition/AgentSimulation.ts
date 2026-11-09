/**
 * The connections of the agent simulation (PAGE-268), a development aid.
 *
 * @remarks
 * Neither is a stored connection. They exist only while the simulation is
 * switched on and never outside development: `local` runs the simulated agent
 * in the Pages process, `remote` runs it like a remote runner that reaches a
 * file only through a checked reference.
 */
export const AGENT_SIMULATION_CONNECTIONS = {
  local: "pages-simulation",
  remote: "pages-simulation-remote",
} as const;

/** The model name both simulation connections offer. */
export const AGENT_SIMULATION_MODEL = "simulation";

/** The scenarios `PAGES_AGENT_SIMULATION_SCENARIO` selects. */
export const AGENT_SIMULATION_SCENARIOS = [
  "ok",
  "item_failed",
  "runner_denied",
  "slow",
] as const;
export type AgentSimulationScenario =
  (typeof AGENT_SIMULATION_SCENARIOS)[number];

/** Which simulated runner a connection stands for, or `null` for every real connection. */
export function agentSimulationRunner(
  connectionId: string | undefined,
): "local" | "remote" | null {
  if (connectionId === AGENT_SIMULATION_CONNECTIONS.local) return "local";
  return connectionId === AGENT_SIMULATION_CONNECTIONS.remote ? "remote" : null;
}
