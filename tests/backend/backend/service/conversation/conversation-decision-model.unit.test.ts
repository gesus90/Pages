import { beforeEach, expect, it, vi } from "vitest";

import { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";
import {
  AGENT_MEANT_QUESTION,
  ANSWER_EXPECTED_QUESTION,
  NOBODY_OPTION,
} from "@/backend/service/conversation/ConversationDecisionPrompt";

import type { ConversationDecisionModelDependencies } from "@/backend/service/conversation/ConversationDecisionModel";
import type { DecisionMaterial } from "@/backend/service/conversation/ConversationDecisionPrompt";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));

const judgedLine = {
  sequence: 1,
  author: "Anna",
  isAgent: false,
  createdAt: "2026-01-01T00:00:00Z",
  text: "Danke!",
  isExcerpt: false,
};

const material: DecisionMaterial = {
  groupName: "Pages Team",
  candidates: [
    { id: "ed", name: "Ed", username: "ed", role: "Entwickler", specialization: "Code" },
    { id: "mei", name: "Mei", username: "mei", role: "", specialization: "" },
  ],
  lines: [judgedLine],
};

function dependencies(): ConversationDecisionModelDependencies {
  return {
    settings: {
      resolve: vi
        .fn()
        .mockResolvedValue({ connectionId: "openrouter", model: "perplexity/pplx-decider-v1.3" }),
    },
    connections: { findSecretEncrypted: vi.fn().mockResolvedValue("cipher") },
    cipher: { decrypt: vi.fn().mockReturnValue("or-key") },
    client: {
      decide: vi.fn().mockResolvedValue({
        model: "perplexity/pplx-decider-v1.3-20261112",
        answers: {
          [ANSWER_EXPECTED_QUESTION]: { type: "noul", noul: 0.06 },
          [AGENT_MEANT_QUESTION]: {
            type: "choice",
            choice: NOBODY_OPTION,
            probabilities: { ed: 0.05, mei: 0.04, [NOBODY_OPTION]: 0.91 },
          },
        },
      }),
    },
    simulation: null,
  };
}

let deps: ConversationDecisionModelDependencies;
beforeEach(() => {
  deps = dependencies();
});

it("calls the decisions interface once with the key of the connection of the chosen model", async () => {
  const answer = await new ConversationDecisionModel(deps).ask(material);
  expect(deps.connections.findSecretEncrypted).toHaveBeenCalledWith("openrouter");
  expect(deps.cipher.decrypt).toHaveBeenCalledWith("openrouter", "cipher");
  expect(deps.client.decide).toHaveBeenCalledOnce();
  const call = vi.mocked(deps.client.decide).mock.calls[0]?.[0];
  expect(call).toMatchObject({
    apiKey: "or-key",
    model: "perplexity/pplx-decider-v1.3",
  });
  expect(Object.keys(call?.questions ?? {})).toEqual([
    ANSWER_EXPECTED_QUESTION,
    AGENT_MEANT_QUESTION,
  ]);
  expect(answer).toEqual({
    model: "perplexity/pplx-decider-v1.3-20261112",
    probabilities: {
      answerProbability: 0.06,
      options: [
        { agentId: "ed", probability: 0.05 },
        { agentId: "mei", probability: 0.04 },
        { agentId: null, probability: 0.91 },
      ],
    },
  });
});

it("asks nothing while no model is chosen", async () => {
  vi.mocked(deps.settings.resolve).mockResolvedValue(null);
  await expect(new ConversationDecisionModel(deps).ask(material)).rejects.toMatchObject({
    code: "decision_no_model",
  });
  expect(deps.client.decide).not.toHaveBeenCalled();
});

it("treats a missing or unreadable key as no usable model", async () => {
  vi.mocked(deps.connections.findSecretEncrypted).mockResolvedValue(null);
  await expect(new ConversationDecisionModel(deps).ask(material)).rejects.toMatchObject({
    code: "decision_no_model",
  });
  vi.mocked(deps.connections.findSecretEncrypted).mockResolvedValue("cipher");
  vi.mocked(deps.cipher.decrypt).mockImplementation(() => {
    throw new Error("wrong key");
  });
  await expect(new ConversationDecisionModel(deps).ask(material)).rejects.toMatchObject({
    code: "decision_no_model",
  });
  expect(deps.client.decide).not.toHaveBeenCalled();
});

it("lets a failed or invalid call reach the caller as it is", async () => {
  vi.mocked(deps.client.decide).mockRejectedValue(
    Object.assign(new Error("decision_failed"), { code: "decision_failed" }),
  );
  await expect(new ConversationDecisionModel(deps).ask(material)).rejects.toMatchObject({
    code: "decision_failed",
  });
  vi.mocked(deps.client.decide).mockResolvedValue({
    model: "m",
    answers: {},
  });
  await expect(new ConversationDecisionModel(deps).ask(material)).rejects.toMatchObject({
    code: "decision_invalid",
  });
});

it("answers from the simulation without a key and without a call", async () => {
  const model = new ConversationDecisionModel({
    ...deps,
    simulation: new SimulatedConversationDecision({ isActive: true, scenario: "ok" }),
  });
  const answer = await model.ask({
    ...material,
    lines: [{ ...judgedLine, text: "Ed, kannst du das prüfen?" }],
  });
  expect(deps.client.decide).not.toHaveBeenCalled();
  expect(deps.connections.findSecretEncrypted).not.toHaveBeenCalled();
  expect(answer.model).toBe("simulation");
  expect(answer.probabilities.options[0]).toEqual({ agentId: "ed", probability: 0.85 });
  const failing = new ConversationDecisionModel({
    ...deps,
    simulation: new SimulatedConversationDecision({ isActive: true, scenario: "failed" }),
  });
  await expect(failing.ask(material)).rejects.toThrow("fails on purpose");
});
