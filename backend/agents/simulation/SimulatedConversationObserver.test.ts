import { describe, expect, it } from "vitest";

import { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";

const line = {
  sequence: 1,
  author: "Ada",
  isAgent: false,
  createdAt: "now",
  text: "Berta ist zuständig und hat entschieden?",
  isExcerpt: false,
};
const routing = {
  groupName: "Team",
  candidates: [
    { id: "b", name: "Berta", username: "berta", role: "Design" },
    { id: "c", name: "Carl", username: "carl", role: "Security" },
  ],
  context: null,
  lines: [line],
  maximum: 1,
  handoff: null,
};

describe("simulated conversation observer", () => {
  it("routes by name, role and username within the selection limit", () => {
    const observer = new SimulatedConversationObserver({
      isActive: true,
      scenario: "ok",
    });
    expect(JSON.parse(observer.route(routing))).toEqual({
      agents: [
        {
          id: "b",
          reason: "Simulation: „berta“ passt zur angegebenen Zuständigkeit.",
        },
      ],
    });
    expect(
      JSON.parse(
        observer.route({ ...routing, lines: [{ ...line, text: "SECURITY" }] }),
      ),
    ).toMatchObject({ agents: [{ id: "c" }] });
    expect(JSON.parse(observer.route({ ...routing, lines: [] }))).toEqual({
      agents: [],
    });
  });

  it("summarizes decisions, questions and responsibilities", () => {
    const observer = new SimulatedConversationObserver({
      isActive: true,
      scenario: "ok",
    });
    expect(
      JSON.parse(
        observer.summarize({
          groupName: "Team",
          previous: null,
          lines: [line],
        }),
      ),
    ).toEqual({
      summary: "Simulation: Nachrichten #1 bis #1 von Ada.",
      decisions: ["Ada: Berta ist zuständig und hat entschieden?"],
      openItems: ["Ada: Berta ist zuständig und hat entschieden?"],
      responsibilities: ["Ada: Berta ist zuständig und hat entschieden?"],
    });
    expect(
      JSON.parse(
        observer.summarize({ groupName: "Team", previous: null, lines: [] }),
      ),
    ).toMatchObject({
      summary: "Simulation: Nachrichten #0 bis #0 von .",
      decisions: [],
    });
  });

  it("fails both operations in the failed scenario", () => {
    const observer = new SimulatedConversationObserver({
      isActive: true,
      scenario: "failed",
    });
    expect(() => observer.route(routing)).toThrow("fails on purpose");
    expect(() =>
      observer.summarize({ groupName: "Team", previous: null, lines: [] }),
    ).toThrow("fails on purpose");
  });
});
