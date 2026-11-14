import { expect, it, vi } from "vitest";

import { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";

const question = {
  groupName: "Pages Team",
  candidates: [
    {
      id: "ed",
      name: "Ed",
      username: "ed",
      role: "Developer",
      specialization: "",
    },
  ],
  lines: [],
};

it("runs one bounded decision request with typed questions and no tools or workspace", async () => {
  const decide = vi.fn().mockResolvedValue({
    model: "decision-model",
    answers: {
      answer_expected: { type: "noul", noul: 0.9 },
      agent_meant: {
        type: "choice",
        choice: "ed",
        probabilities: { ed: 0.8, "(niemand)": 0.2 },
      },
    },
  });
  const service = new ConversationDecisionModel({
    settings: {
      resolve: async () => ({
        connectionId: "connection",
        model: "decision-model",
      }),
    },
    connections: {
      findSecretEncrypted: vi.fn().mockResolvedValue("encrypted"),
    },
    cipher: { decrypt: vi.fn().mockReturnValue("key") },
    client: { decide },
    simulation: null,
  });
  expect(await service.ask(question)).toEqual({
    model: "decision-model",
    probabilities: {
      answerProbability: 0.9,
      options: [
        { agentId: "ed", probability: 0.8 },
        { agentId: null, probability: 0.2 },
      ],
    },
  });
  expect(decide).toHaveBeenCalledOnce();
  expect(decide).toHaveBeenCalledWith({
    apiKey: "key",
    model: "decision-model",
    state: expect.objectContaining({
      gruppe: "Pages Team",
      agents: [
        expect.objectContaining({
          username: "ed",
          spezialisierung: "Ed: Developer",
        }),
      ],
    }) as unknown,
    questions: expect.objectContaining({
      answer_expected: expect.objectContaining({ type: "noul" }) as unknown,
      agent_meant: expect.objectContaining({ type: "choice" }) as unknown,
    }) as unknown,
  });
});

it("fails as no model before calling any execution path", async () => {
  const decide = vi.fn();
  const connections = { findSecretEncrypted: vi.fn() };
  const service = new ConversationDecisionModel({
    settings: { resolve: async () => null },
    connections,
    cipher: { decrypt: vi.fn() },
    client: { decide },
    simulation: null,
  });
  await expect(service.ask(question)).rejects.toMatchObject({
    code: "decision_no_model",
  });
  expect(decide).not.toHaveBeenCalled();
  expect(connections.findSecretEncrypted).not.toHaveBeenCalled();
});
