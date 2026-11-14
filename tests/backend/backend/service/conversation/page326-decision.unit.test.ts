import { expect, it, vi } from "vitest";

import { ConversationChatDecisions } from "@/backend/service/conversation/ConversationChatDecisions";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import {
  CONVERSATION_DEFAULT_REPLY_MODE,
  CONVERSATION_DEFAULT_DECISION_RULES,
  CONVERSATION_NO_RULE_OVERRIDES,
} from "@/definition/ConversationDecision";
import { ROLE } from "@/definition/Role";

import type { ConversationDecisionRequest } from "@/backend/service/conversation/ConversationChatDecisions";

function fixture(): {
  service: ConversationChatDecisions;
  request: ConversationDecisionRequest;
  ask: ReturnType<typeof vi.fn>;
  record: ReturnType<typeof vi.fn>;
} {
  const person = {
    id: "person",
    username: "person",
    displayName: "Igor",
    role: ROLE.EMPLOYEE,
    isActive: true,
    mustChangePassword: false,
  };
  const agents = ["ed", "bakuman"].map((id) => ({
    ...person,
    id,
    username: id,
    displayName: id,
    isAgent: true,
  }));
  const accounts = new ConversationAccounts(
    new Map(
      agents.map((user) => [
        user.id,
        {
          user,
          participant: {
            id: user.id,
            name: user.displayName,
            kind: "agent",
            color: null,
          },
          role: user.id === "ed" ? "Developer" : "Designer",
          isAvailable: true,
        },
      ]),
    ),
  );
  const ask = vi.fn().mockResolvedValue({
    model: "decision-model",
    probabilities: {
      answerProbability: 0.9,
      options: [
        { agentId: "ed", probability: 0.8 },
        { agentId: "bakuman", probability: 0.2 },
        { agentId: null, probability: 0 },
      ],
    },
  });
  const record = vi.fn();
  const request: ConversationDecisionRequest = {
    conversation: { id: "group", name: "Pages Team" },
    originMessageId: "message",
    person,
    accounts,
    memberIds: ["person", "ed", "bakuman"],
    message: {
      id: "message",
      conversationId: "group",
      clientMessageId: "client",
      text: "Bitte repariert den Chat.",
      sender: { id: "person", kind: "human", name: "Igor", color: null },
      mentions: [],
      attachments: [],
      links: [],
      createdAt: "today",
    },
    settings: {
      conversationId: "group",
      mode: "decision",
      overrides: CONVERSATION_NO_RULE_OVERRIDES,
    },
  };
  const service = new ConversationChatDecisions({
    messages: {
      find: vi.fn().mockResolvedValue({ sequence: 1 }),
      history: vi.fn().mockResolvedValue([]),
    },
    rounds: {
      claimRouting: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValue(false),
      finishRouting: vi.fn(),
    },
    decisions: { record },
    model: { ask },
    defaults: {
      rules: vi.fn().mockResolvedValue(CONVERSATION_DEFAULT_DECISION_RULES),
    },
    agents: { find: vi.fn().mockResolvedValue(null) },
    publisher: { publish: vi.fn() },
  });
  return { service, request, ask, record };
}

it("PAGE-326 defaults groups to the instance decision model", () => {
  expect(CONVERSATION_DEFAULT_REPLY_MODE).toBe("decision");
});

it("decides an unmentioned question once, selects the eligible agent and stores its probabilities", async () => {
  const { service, request, ask, record } = fixture();
  expect(await service.decide(request)).toEqual([
    {
      agentId: "ed",
      trigger: "context",
      reason:
        "Das Decision-Modell hat dich gewählt: Antwort erwartet 90 % · ed 80 %, bakuman 20 %, niemand 0 %.",
    },
  ]);
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      groupName: "Pages Team",
      candidates: expect.arrayContaining([
        expect.objectContaining({ id: "ed", role: "Developer" }),
      ]) as unknown,
    }),
  );
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      responderIds: ["ed"],
      model: "decision-model",
      answerProbability: 0.9,
      choices: expect.arrayContaining([
        expect.objectContaining({ agentId: "ed", probability: 0.8 }),
      ]) as unknown,
      fallback: "none",
    }),
  );
  expect(await service.decide(request)).toEqual([]);
  expect(ask).toHaveBeenCalledOnce();
});

it("stores probabilities when nobody should answer", async () => {
  const { service, request, ask, record } = fixture();
  ask.mockResolvedValue({
    model: "decision-model",
    probabilities: {
      answerProbability: 0.1,
      options: [
        { agentId: "ed", probability: 0.2 },
        { agentId: null, probability: 0.8 },
      ],
    },
  });
  expect(await service.decide(request)).toEqual([]);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "nobody",
      model: "decision-model",
      answerProbability: 0.1,
      fallback: "none",
    }),
  );
});

it.each(["missing", "failed", "invalid"])(
  "records the %s model fallback without losing the message",
  async (kind) => {
    const { service, request, ask, record } = fixture();
    if (kind === "invalid")
      ask.mockRejectedValue(new ConversationObserverError("decision_invalid"));
    else
      ask.mockRejectedValue(
        new ConversationObserverError(
          kind === "missing" ? "decision_no_model" : "observer_unavailable",
        ),
      );
    expect(await service.decide(request)).toEqual([]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "unavailable",
        fallback: kind === "missing" ? "no_model" : "model_failed",
      }),
    );
  },
);
