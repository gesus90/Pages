import { setTimeout as delay } from "node:timers/promises";

import { describe, expect, it, vi } from "vitest";

import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";

import type { AgentSimulationScenario } from "@/definition/AgentSimulation";

function agent(scenario: AgentSimulationScenario): SimulatedConversationAgent {
  return new SimulatedConversationAgent({ isActive: true, scenario });
}

vi.mock("node:timers/promises", () => ({
  setTimeout: vi.fn(() => Promise.resolve()),
}));

describe("SimulatedConversationAgent", () => {
  it("quotes the last message", async () => {
    expect(
      await agent("ok").answer({ agentName: "Ada", lastMessage: " Hallo " }),
    ).toBe(
      "Simulation (Szenario ok): Ada hat deine Nachricht „Hallo“ erhalten. Kein Modellanbieter wurde angefragt.",
    );
  });

  it("shortens a long quote", async () => {
    const answer = await agent("ok").answer({
      agentName: "Ada",
      lastMessage: "x".repeat(250),
    });
    expect(answer).toContain(`„${"x".repeat(200)}…“`);
  });

  it("sends content lines back as cards", async () => {
    const message = "Text\n```ts\ncode\n```";
    const answer = await agent("ok").answer({
      agentName: "Ada",
      lastMessage: message,
    });
    expect(answer.endsWith(`\n\n${message}`)).toBe(true);
    const url = await agent("ok").answer({
      agentName: "Ada",
      lastMessage: "https://example.com/a",
    });
    expect(url).toContain("\n\nhttps://example.com/a");
  });

  it("fails on purpose in the scenario failed", async () => {
    await expect(
      agent("failed").answer({ agentName: "Ada", lastMessage: "x" }),
    ).rejects.toThrow("fails on purpose");
  });

  it("ends a stopped answer at once", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      agent("ok").answer({
        agentName: "Ada",
        lastMessage: "x",
        signal: controller.signal,
      }),
    ).rejects.toThrow();
  });

  it("waits five seconds in the scenario slow", async () => {
    const answer = await agent("slow").answer({
      agentName: "Ada",
      lastMessage: "x",
    });
    expect(answer).toContain("Szenario slow");
    expect(delay).toHaveBeenCalledWith(5_000, undefined, { signal: undefined });
  });
});
