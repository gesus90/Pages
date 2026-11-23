import { describe, expect, it } from "vitest";

import { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";

import type { DecisionMaterial } from "@/backend/service/conversation/ConversationDecisionPrompt";

const decision = new SimulatedConversationDecision({
  isActive: true,
  scenario: "ok",
});

function candidate(
  id: string,
  extra: Partial<DecisionMaterial["candidates"][number]> = {},
): DecisionMaterial["candidates"][number] {
  return {
    id,
    name: `Name${id}`,
    username: `user${id}`,
    role: "",
    specialization: "",
    ...extra,
  };
}

function material(
  text: string | null,
  ...candidates: DecisionMaterial["candidates"][number][]
): DecisionMaterial {
  return {
    groupName: "g",
    candidates,
    lines:
      text === null
        ? []
        : [
            {
              sequence: 1,
              author: "p",
              isAgent: false,
              createdAt: "",
              text,
              isExcerpt: false,
            },
          ],
  };
}

describe("SimulatedConversationDecision", () => {
  it("fails on purpose in the scenario failed", () => {
    expect(() =>
      new SimulatedConversationDecision({
        isActive: true,
        scenario: "failed",
      }).decide(material("x")),
    ).toThrow("fails on purpose");
  });

  it("gives one named agent the high probability", () => {
    const result = decision.decide(
      material("hallo namea bitte", candidate("a"), candidate("b")),
    );
    expect(result.answerProbability).toBe(0.9);
    expect(result.options.slice(0, 2)).toEqual([
      { agentId: "a", probability: 0.85 },
      { agentId: "b", probability: 0 },
    ]);
    expect(result.options[2].agentId).toBeNull();
    expect(result.options[2].probability).toBeCloseTo(0.15);
  });

  it("splits between several named agents", () => {
    const result = decision.decide(
      material(
        "NAMEA and userb",
        candidate("a"),
        candidate("b"),
        candidate("c", { name: "", username: "" }),
      ),
    );
    expect(result.options.slice(0, 3)).toEqual([
      { agentId: "a", probability: 0.5 },
      { agentId: "b", probability: 0.4 },
      { agentId: "c", probability: 0 },
    ]);
    expect(result.options[3].probability).toBeCloseTo(0.1);
  });

  it("matches the words of role and specialization", () => {
    const result = decision.decide(
      material(
        "wir brauchen Design",
        candidate("a", { role: "Lead Design" }),
        candidate("b", { specialization: "sql" }),
      ),
    );
    expect(result.options[0].probability).toBe(0.85);
    expect(result.options[1].probability).toBe(0);
  });

  it("expects an answer to a question and none otherwise", () => {
    expect(
      decision.decide(material("wer?", candidate("a"))).answerProbability,
    ).toBe(0.9);
    const quiet = decision.decide(material("nichts", candidate("a")));
    expect(quiet.answerProbability).toBe(0.1);
    expect(quiet.options.at(-1)).toEqual({ agentId: null, probability: 1 });
    expect(decision.decide(material(null)).options).toEqual([
      { agentId: null, probability: 1 },
    ]);
  });
});
