import { afterEach, describe, expect, it, vi } from "vitest";

import {
  currentAgentSimulationMode,
  readAgentSimulationMode,
} from "@/backend/agents/simulation/AgentSimulationMode";

vi.mock("@/backend/logging/Logger", () => ({ logEvent: vi.fn() }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("readAgentSimulationMode", () => {
  it("stays inactive without the switch", () => {
    expect(readAgentSimulationMode({})).toEqual({
      isActive: false,
      scenario: "ok",
    });
  });

  it("ignores the switch in production", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(
      readAgentSimulationMode({
        PAGES_AGENT_SIMULATION: "1",
        NODE_ENV: "production",
      }),
    ).toEqual({ isActive: false, scenario: "ok" });
    expect(warn).toHaveBeenCalledOnce();
  });

  it("plays the named scenario, or ok for an unknown one", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect(
      readAgentSimulationMode({
        PAGES_AGENT_SIMULATION: "1",
        PAGES_AGENT_SIMULATION_SCENARIO: "slow",
      }),
    ).toEqual({ isActive: true, scenario: "slow" });
    expect(
      readAgentSimulationMode({
        PAGES_AGENT_SIMULATION: "1",
        PAGES_AGENT_SIMULATION_SCENARIO: "nonsense",
      }).scenario,
    ).toBe("ok");
    expect(
      readAgentSimulationMode({ PAGES_AGENT_SIMULATION: "1" }).scenario,
    ).toBe("ok");
    expect(info).toHaveBeenCalledTimes(3);
  });

  it("reads the process environment once", () => {
    vi.stubEnv("PAGES_AGENT_SIMULATION", "");
    const first = currentAgentSimulationMode();
    expect(first.isActive).toBe(false);
    expect(currentAgentSimulationMode()).toBe(first);
  });
});
