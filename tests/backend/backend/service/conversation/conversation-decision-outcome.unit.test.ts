import { describe, expect, it } from "vitest";

import { settleDecision } from "@/backend/service/conversation/ConversationDecisionOutcome";
import { CONVERSATION_DEFAULT_DECISION_RULES } from "@/definition/ConversationDecision";

import type { DecisionInput } from "@/backend/service/conversation/ConversationDecisionOutcome";
import type { DecisionOption } from "@/backend/service/conversation/ConversationDecisionPrompt";

const RULES = CONVERSATION_DEFAULT_DECISION_RULES;

function answer(
  answerProbability: number,
  options: Record<string, number>,
): DecisionInput {
  return {
    kind: "answer",
    model: "perplexity/pplx-decider-v1.3",
    probabilities: {
      answerProbability,
      options: Object.entries(options).map(
        ([id, probability]): DecisionOption => ({
          agentId: id === "nobody" ? null : id,
          probability,
        }),
      ),
    },
  };
}

describe("nobody answers", () => {
  it("for a thank-you where nobody is the most probable choice", () => {
    const settled = settleDecision(
      answer(0.06, { ed: 0.05, mei: 0.04, nobody: 0.91 }),
      RULES,
    );
    expect(settled.outcome).toBe("nobody");
    expect(settled.responderIds).toEqual([]);
    expect(settled.model).toBe("perplexity/pplx-decider-v1.3");
    expect(settled.answerProbability).toBe(0.06);
  });

  it("when the chance of an expected answer stays below the answer threshold, however sure the choice", () => {
    const settled = settleDecision(
      answer(0.59, { ed: 0.9, mei: 0.05, nobody: 0.05 }),
      RULES,
    );
    expect(settled.responderIds).toEqual([]);
    expect(settled.outcome).toBe("nobody");
  });

  it("when nobody is more probable than the best agent, although an answer is expected", () => {
    const settled = settleDecision(
      answer(0.95, { ed: 0.3, mei: 0.1, nobody: 0.6 }),
      RULES,
    );
    expect(settled.responderIds).toEqual([]);
  });

  it("when nobody ties with the best agent", () => {
    const settled = settleDecision(
      answer(0.95, { ed: 0.5, mei: 0, nobody: 0.5 }),
      RULES,
    );
    expect(settled.responderIds).toEqual([]);
  });

  it("when the best agent stays below the responsibility threshold", () => {
    const settled = settleDecision(
      answer(0.95, { ed: 0.49, mei: 0.3, nobody: 0.21 }),
      RULES,
    );
    expect(settled.responderIds).toEqual([]);
  });
});

describe("agents answer", () => {
  it("only the most probable agent when the others stay below the second threshold", () => {
    const settled = settleDecision(
      answer(0.82, { ed: 0.78, mei: 0.15, nobody: 0.07 }),
      RULES,
    );
    expect(settled).toMatchObject({
      outcome: "responders",
      fallback: "none",
      responderIds: ["ed"],
      answerProbability: 0.82,
    });
    expect(settled.options.map((option) => option.agentId)).toEqual([
      "ed",
      "mei",
      null,
    ]);
  });

  it("reaches every threshold inclusively and adds the second agent", () => {
    const settled = settleDecision(
      answer(0.6, { ed: 0.5, mei: 0.4, nobody: 0.1 }),
      RULES,
    );
    expect(settled.responderIds).toEqual(["ed", "mei"]);
  });

  it("never lets more agents answer than the maximum, however many reach the second threshold", () => {
    const options = {
      ed: 0.5,
      mei: 0.45,
      conan: 0.42,
      bakuman: 0.41,
      nobody: 0,
    };
    expect(settleDecision(answer(0.9, options), RULES).responderIds).toEqual([
      "ed",
      "mei",
    ]);
    expect(
      settleDecision(answer(0.9, options), { ...RULES, maximumResponders: 1 })
        .responderIds,
    ).toEqual(["ed"]);
    expect(
      settleDecision(answer(0.9, options), { ...RULES, maximumResponders: 3 })
        .responderIds,
    ).toEqual(["ed", "mei", "conan"]);
  });

  it("follows the thresholds of the group", () => {
    const options = { ed: 0.7, mei: 0.3, nobody: 0 };
    expect(
      settleDecision(answer(0.7, options), { ...RULES, answerThreshold: 80 })
        .responderIds,
    ).toEqual([]);
    expect(
      settleDecision(answer(0.7, options), {
        ...RULES,
        responsibilityThreshold: 80,
      }).responderIds,
    ).toEqual([]);
    expect(
      settleDecision(answer(0.7, options), { ...RULES, secondThreshold: 30 })
        .responderIds,
    ).toEqual(["ed", "mei"]);
  });
});

it("settles a missing or failed model as unavailable, which starts nobody", () => {
  for (const fallback of ["no_model", "model_failed"] as const) {
    expect(settleDecision({ kind: "failure", fallback }, RULES)).toEqual({
      outcome: "unavailable",
      fallback,
      responderIds: [],
      model: null,
      answerProbability: null,
      options: [],
    });
  }
});
