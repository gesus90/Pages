import { expect, it, vi } from "vitest";

import { ConversationChatDecisions } from "@/backend/service/conversation/ConversationChatDecisions";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationObserverError } from "@/backend/error/ConversationObserverError";
import { CONVERSATION_DEFAULT_REPLY_MODE } from "@/definition/ConversationDecision";

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
    role: "employee",
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
  const ask = vi.fn().mockResolvedValue(
    JSON.stringify({
      responders: ["ed", "ed", "bakuman", "outsider"],
      needsAnswer: true,
      reason: "Ed entwickelt den Chat.",
    }),
  );
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
      defaultResponderId: null,
      maximumResponders: 3,
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
    publisher: { publish: vi.fn() },
  });
  return { service, request, ask, record };
}

it("PAGE-326 defaults groups to the instance decision model", () => {
  expect(CONVERSATION_DEFAULT_REPLY_MODE).toBe("decision");
});

it("decides an unmentioned question once, selects at most one eligible agent and stores its visible reason", async () => {
  const { service, request, ask, record } = fixture();
  expect(await service.decide(request)).toEqual([
    { agentId: "ed", trigger: "context", reason: "Ed entwickelt den Chat." },
  ]);
  expect(ask).toHaveBeenCalledWith(
    expect.objectContaining({
      material: expect.objectContaining({ maximum: 1 }),
    }),
  );
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      responderIds: ["ed"],
      reason: "Ed entwickelt den Chat.",
      fallback: "none",
    }),
  );
  expect(await service.decide(request)).toEqual([]);
  expect(ask).toHaveBeenCalledOnce();
});

it("stores a visible explanation when nobody should answer", async () => {
  const { service, request, ask, record } = fixture();
  ask.mockResolvedValue(
    JSON.stringify({
      responders: [],
      needsAnswer: false,
      reason: "Nur ein Gruß an die Menschen.",
    }),
  );
  expect(await service.decide(request)).toEqual([]);
  expect(record).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: "nobody",
      reason: "Nur ein Gruß an die Menschen.",
      fallback: "none",
    }),
  );
});

it.each(["missing", "failed", "invalid"])(
  "records the %s model fallback without losing the message",
  async (kind) => {
    const { service, request, ask, record } = fixture();
    if (kind === "invalid") ask.mockResolvedValue("not JSON");
    else
      ask.mockRejectedValue(
        new ConversationObserverError(
          kind === "missing" ? "decision_no_model" : "observer_unavailable",
        ),
      );
    expect(await service.decide(request)).toEqual([]);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "notice",
        fallback: kind === "missing" ? "no_model" : "model_failed",
      }),
    );
  },
);
