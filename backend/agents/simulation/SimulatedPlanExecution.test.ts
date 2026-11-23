import { describe, expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import {
  SimulatedPlanExecution,
  simulationGuardedFetch,
} from "@/backend/agents/simulation/SimulatedPlanExecution";
import { AGENT_SIMULATION_CONNECTIONS } from "@/definition/AgentSimulation";

const active = { isActive: true, scenario: "ok" } as const;
const inactive = { isActive: false, scenario: "ok" } as const;

function stub(value: object): never {
  return value as never;
}

function inputOf(connectionId: string): never {
  return stub({ agent: { connection: { id: connectionId } } });
}

interface Setup {
  readonly real: {
    readonly run: Mock;
    readonly open: Mock;
    readonly finishPlanRun: Mock;
  };
  readonly simulator: { readonly run: Mock };
  readonly execution: SimulatedPlanExecution;
}

function setup(
  mode: typeof active | typeof inactive,
  durable?: boolean,
): Setup {
  const real = {
    hasDurableLocalSessions: durable,
    run: vi.fn(() => Promise.resolve("real")),
    open: vi.fn(() => Promise.resolve("session")),
    finishPlanRun: vi.fn(() => Promise.resolve()),
  };
  const simulator = { run: vi.fn(() => Promise.resolve("simulated")) };
  const execution = new SimulatedPlanExecution(
    stub(real),
    stub(simulator),
    mode,
  );
  return { real, simulator, execution };
}

const signal = new AbortController().signal;

describe("SimulatedPlanExecution", () => {
  it("runs the simulator for a simulation connection", async () => {
    const { execution, simulator } = setup(active);
    expect(
      await execution.run(inputOf(AGENT_SIMULATION_CONNECTIONS.remote), signal),
    ).toBe("simulated");
    expect(simulator.run).toHaveBeenCalledOnce();
  });

  it("refuses a simulation connection while the simulation is off", async () => {
    const { execution } = setup(inactive);
    await expect(
      execution.run(inputOf(AGENT_SIMULATION_CONNECTIONS.local), signal),
    ).rejects.toMatchObject({ code: "connection_not_found" });
  });

  it("blocks real requests and sessions while active", async () => {
    const { execution, real } = setup(active);
    await expect(execution.run(inputOf("real"), signal)).rejects.toMatchObject({
      code: "plan_simulation_external_blocked",
    });
    await expect(
      execution.open(stub({}), signal, stub({})),
    ).rejects.toBeInstanceOf(AgentError);
    expect(real.run).not.toHaveBeenCalled();
  });

  it("passes everything to the real execution while off", async () => {
    const { execution, real } = setup(inactive, true);
    expect(await execution.run(inputOf("real"), signal)).toBe("real");
    expect(await execution.open(stub({}), signal, stub({}))).toBe("session");
    await execution.finishPlanRun("run", "succeeded");
    expect(real.finishPlanRun).toHaveBeenCalledWith("run", "succeeded");
    expect(execution.hasDurableLocalSessions).toBe(true);
  });

  it("reports no durable sessions and tolerates a missing finish hook", async () => {
    const { execution, real } = setup(inactive);
    expect(execution.hasDurableLocalSessions).toBe(false);
    const bare = new SimulatedPlanExecution(
      stub({ run: real.run, open: real.open }),
      stub({}),
      inactive,
    );
    await expect(bare.finishPlanRun("run", "failed")).resolves.toBeUndefined();
  });
});

describe("simulationGuardedFetch", () => {
  it("is the real fetch while off and refuses every request while on", async () => {
    expect(simulationGuardedFetch(inactive)).toBe(fetch);
    await expect(
      simulationGuardedFetch(active)("https://example.com"),
    ).rejects.toBeInstanceOf(AgentError);
  });
});
