import { describe, expect, it } from "vitest";

import {
  agentSimulationModels,
  resolveAgentSimulationModel,
} from "@/backend/agents/simulation/AgentSimulationModels";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  AGENT_SIMULATION_CONNECTIONS,
  AGENT_SIMULATION_MODEL,
} from "@/definition/AgentSimulation";

const active = { isActive: true, scenario: "ok" } as const;
const inactive = { isActive: false, scenario: "ok" } as const;

describe("agentSimulationModels", () => {
  it("offers a local and a remote model while active", () => {
    const models = agentSimulationModels(active);
    expect(models.map((model) => model.location)).toEqual(["local", "remote"]);
    expect(models[0]).not.toHaveProperty("targetName");
    expect(models[1].targetName).toBe("Simulation");
    expect(models.every((model) => model.isSimulation)).toBe(true);
  });

  it("offers nothing while off or unknown", () => {
    expect(agentSimulationModels(inactive)).toEqual([]);
    expect(agentSimulationModels(undefined)).toEqual([]);
  });
});

describe("resolveAgentSimulationModel", () => {
  it("ignores real connections", () => {
    expect(
      resolveAgentSimulationModel(active, {
        connectionId: "real",
        model: "m",
      }),
    ).toBeNull();
  });

  it("resolves both simulated runners", () => {
    for (const connectionId of Object.values(AGENT_SIMULATION_CONNECTIONS)) {
      const resolved = resolveAgentSimulationModel(active, {
        connectionId,
        model: AGENT_SIMULATION_MODEL,
      });
      expect(resolved).toMatchObject({
        model: AGENT_SIMULATION_MODEL,
        supportsImages: true,
      });
      expect(resolved?.connection.id).toBe(connectionId);
    }
  });

  it("refuses the simulation while off or for another model", () => {
    const local = {
      connectionId: AGENT_SIMULATION_CONNECTIONS.local,
      model: AGENT_SIMULATION_MODEL,
    };
    expect(() => resolveAgentSimulationModel(inactive, local)).toThrow(
      AgentError,
    );
    expect(() => resolveAgentSimulationModel(undefined, local)).toThrow(
      AgentError,
    );
    expect(() =>
      resolveAgentSimulationModel(active, { ...local, model: "other" }),
    ).toThrow(AgentError);
  });
});
