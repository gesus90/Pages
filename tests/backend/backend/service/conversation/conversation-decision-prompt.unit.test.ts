import { describe, expect, it } from "vitest";

import {
  AGENT_MEANT_QUESTION,
  ANSWER_EXPECTED_QUESTION,
  NOBODY_OPTION,
  decisionQuestions,
  readDecisionProbabilities,
} from "@/backend/service/conversation/ConversationDecisionPrompt";

import type {
  DecisionCandidate,
  DecisionMaterial,
} from "@/backend/service/conversation/ConversationDecisionPrompt";
import type { OpenRouterDecisionsResponse } from "@/backend/service/conversation/OpenRouterDecisionsClient";

const ed: DecisionCandidate = {
  id: "agent-ed",
  name: "Ed",
  username: "ed",
  role: "Entwickler",
  specialization: "Setzt Tickets im Code um.",
};
const mei: DecisionCandidate = {
  id: "agent-mei",
  name: "Mei",
  username: "mei",
  role: "",
  specialization: "",
};

function line(
  sequence: number,
  author: string,
  text: string,
  isAgent = false,
): DecisionMaterial["lines"][number] {
  return {
    sequence,
    author,
    isAgent,
    createdAt: "2026-01-01T00:00:00Z",
    text,
    isExcerpt: false,
  };
}

const material: DecisionMaterial = {
  groupName: "Pages Team",
  candidates: [ed, mei],
  lines: [
    line(1, "Anna", "Wir brauchen den Fix bis Freitag."),
    line(2, "Ed", "Ich schaue es mir an.", true),
    line(3, "Anna", "Kann jemand den Fehler beheben?"),
  ],
};

function response(
  answers: OpenRouterDecisionsResponse["answers"],
): OpenRouterDecisionsResponse {
  return { model: "perplexity/pplx-decider-v1.3", answers };
}

describe("decisionQuestions", () => {
  it("asks both typed questions: a yes/no question and a choice among all agents and nobody", () => {
    const { questions } = decisionQuestions(material);
    expect(Object.keys(questions)).toEqual([
      ANSWER_EXPECTED_QUESTION,
      AGENT_MEANT_QUESTION,
    ]);
    expect(questions[ANSWER_EXPECTED_QUESTION]).toMatchObject({ type: "noul" });
    const meant = questions[AGENT_MEANT_QUESTION];
    expect(meant?.type).toBe("choice");
    if (meant?.type !== "choice") throw new Error("choice question expected");
    expect(Object.keys(meant.criteria)).toEqual(["ed", "mei", NOBODY_OPTION]);
    expect(meant.criteria.ed).toBe(
      "Ed: Entwickler · Setzt Tickets im Code um.",
    );
    expect(meant.criteria.mei).toBe("Mei: keine Angabe");
  });

  it("hands the model the new message, the earlier messages and each agent's specialization", () => {
    const { state } = decisionQuestions(material);
    expect(state).toMatchObject({
      gruppe: "Pages Team",
      agents: [
        {
          name: "Ed",
          username: "ed",
          spezialisierung: "Ed: Entwickler · Setzt Tickets im Code um.",
        },
        { name: "Mei", username: "mei", spezialisierung: "Mei: keine Angabe" },
      ],
      neue_nachricht: "#3 Anna (Mensch): Kann jemand den Fehler beheben?",
    });
    expect(state.letzte_nachrichten).toEqual([
      "#1 Anna (Mensch): Wir brauchen den Fix bis Freitag.",
      "#2 Ed (Agent): Ich schaue es mir an.",
    ]);
  });
});

describe("readDecisionProbabilities", () => {
  const valid = response({
    [ANSWER_EXPECTED_QUESTION]: { type: "noul", noul: 0.82 },
    [AGENT_MEANT_QUESTION]: {
      type: "choice",
      choice: "ed",
      probabilities: { ed: 0.78, mei: 0.15, [NOBODY_OPTION]: 0.07 },
    },
  });

  it("maps the answers to the agents and to nobody", () => {
    expect(readDecisionProbabilities(valid, [ed, mei])).toEqual({
      answerProbability: 0.82,
      options: [
        { agentId: "agent-ed", probability: 0.78 },
        { agentId: "agent-mei", probability: 0.15 },
        { agentId: null, probability: 0.07 },
      ],
    });
  });

  it("counts an option the model left out as 0", () => {
    const partial = response({
      [ANSWER_EXPECTED_QUESTION]: { type: "noul", noul: 0.9 },
      [AGENT_MEANT_QUESTION]: {
        type: "choice",
        choice: "ed",
        probabilities: { ed: 1 },
      },
    });
    expect(readDecisionProbabilities(partial, [ed, mei]).options).toEqual([
      { agentId: "agent-ed", probability: 1 },
      { agentId: "agent-mei", probability: 0 },
      { agentId: null, probability: 0 },
    ]);
  });

  it.each([
    ["an answer is missing", response({})],
    [
      "the yes/no answer has another type",
      response({
        [ANSWER_EXPECTED_QUESTION]: {
          type: "choice",
          choice: "x",
          probabilities: { x: 1 },
        },
        [AGENT_MEANT_QUESTION]: {
          type: "choice",
          choice: "ed",
          probabilities: { ed: 1 },
        },
      }),
    ],
    [
      "the choice gives no probabilities",
      response({
        [ANSWER_EXPECTED_QUESTION]: { type: "noul", noul: 0.9 },
        [AGENT_MEANT_QUESTION]: {
          type: "choice",
          choice: "ed",
          probabilities: null,
        },
      }),
    ],
    [
      "the choice names none of the options asked",
      response({
        [ANSWER_EXPECTED_QUESTION]: { type: "noul", noul: 0.9 },
        [AGENT_MEANT_QUESTION]: {
          type: "choice",
          choice: "zed",
          probabilities: { zed: 1 },
        },
      }),
    ],
  ])("refuses an answer where %s", (_name, invalid) => {
    expect(() => readDecisionProbabilities(invalid, [ed, mei])).toThrowError(
      expect.objectContaining({ code: "decision_invalid" }),
    );
  });
});
