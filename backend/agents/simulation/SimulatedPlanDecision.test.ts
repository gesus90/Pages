import { describe, expect, it } from "vitest";

import { SimulatedPlanDecision } from "@/backend/agents/simulation/SimulatedPlanDecision";
import { DecisionModelError } from "@/backend/error/DecisionModelError";

const questions = {
  yes: { type: "noul", instructions: "?" },
  pick: {
    type: "choice",
    instructions: "?",
    criteria: { Alpha: "a", Beta: "b", Gamma: "c" },
  },
} as const;

const decision = new SimulatedPlanDecision({ isActive: true, scenario: "ok" });

describe("SimulatedPlanDecision", () => {
  it("fails on purpose in the scenario failed", () => {
    expect(() =>
      new SimulatedPlanDecision({ isActive: true, scenario: "failed" }).decide(
        "x",
        questions,
      ),
    ).toThrow(DecisionModelError);
  });

  it("answers yes unless the source says no", () => {
    expect(decision.decide("fine", questions).answers.yes).toEqual({
      type: "noul",
      noul: 0.8,
      confidence: 0.8,
    });
    const no = decision.decide("Nein danke", questions).answers.yes;
    expect(no.type === "noul" ? no.noul : null).toBeCloseTo(0.2);
  });

  it("chooses the named option, else the first", () => {
    const named = decision.decide("take beta please", questions);
    expect(named).toMatchObject({ model: "simulation", costUsd: null });
    expect(named.answers.pick).toMatchObject({ choice: "Beta" });
    const first = decision.decide("zzz", questions).answers.pick;
    expect(first).toMatchObject({ choice: "Alpha" });
    const probabilities =
      first.type === "choice" ? (first.probabilities ?? {}) : {};
    expect(probabilities.Alpha).toBe(0.8);
    expect(probabilities.Beta).toBeCloseTo(0.1);
    expect(probabilities.Gamma).toBeCloseTo(0.1);
  });

  it("handles a choice with one or no option", () => {
    const single = decision.decide("x", {
      one: { type: "choice", instructions: "?", criteria: { Only: "o" } },
      none: { type: "choice", instructions: "?", criteria: {} },
    });
    expect(single.answers.one).toMatchObject({
      choice: "Only",
      probabilities: { Only: 0.8 },
    });
    expect(single.answers.none).toMatchObject({
      choice: "",
      probabilities: {},
    });
  });
});
