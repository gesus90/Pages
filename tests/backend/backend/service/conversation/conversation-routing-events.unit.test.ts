import { expect, it, vi } from "vitest";

import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import {
  ConversationEvents,
  sharedConversationEvents,
} from "@/backend/service/conversation/ConversationEvents";
import {
  ConversationObserverRouting,
  observerContextBlock,
} from "@/backend/service/conversation/ConversationObserverRouting";
import { CONVERSATION_OBSERVER_LIMITS } from "@/definition/ConversationObserver";

import type { ConversationObserverModel } from "@/backend/service/conversation/ConversationObserverModel";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";

vi.mock("@/backend/logging/Logger", () => ({ logCaughtError: vi.fn() }));
import { logCaughtError } from "@/backend/logging/Logger";

const message: StoredConversationMessage = {
  id: "judged",
  sequence: 3,
  conversationId: "group",
  senderId: "person",
  clientMessageId: "client",
  text: "Question",
  mentions: [],
  createdAt: "2026-01-01T00:00:00Z",
  voice: null,
  notice: null,
};
const candidate = {
  id: "agent",
  name: "Agent",
  username: "agent",
  role: "Research",
};
const request = {
  conversation: { id: "group", name: "Team" },
  triggerMessageId: "judged",
  personId: "person",
  candidates: [candidate],
  maximum: 1,
  handoff: null,
  accounts: new ConversationAccounts(new Map()),
};

it("routes bounded history in chronological order and validates the answer", async () => {
  const messages = {
    find: vi.fn().mockResolvedValue(message),
    history: vi
      .fn()
      .mockResolvedValue([
        message,
        { ...message, id: "notice", sequence: 2, notice: "agent_failed" },
        { ...message, id: "older", sequence: 1, text: "Earlier" },
      ]),
  };
  const contexts = {
    promptContext: vi.fn().mockResolvedValue({ context: null }),
  };
  const model = {
    ask: vi
      .fn<ConversationObserverModel["ask"]>()
      .mockResolvedValue('{"agents":[{"id":"agent","reason":"Research"}]}'),
  };
  const routing = new ConversationObserverRouting({
    messages,
    contexts,
    model,
  });
  await expect(routing.choose(request)).resolves.toEqual([
    { agentId: "agent", reason: "Research" },
  ]);
  expect(messages.history).toHaveBeenCalledWith(
    "group",
    4,
    CONVERSATION_OBSERVER_LIMITS.routingContextMessages,
  );
  expect(model.ask.mock.calls[0]?.[0]).toMatchObject({
    conversationId: "group",
    personIds: ["person"],
    trigger: "judged",
    material: {
      kind: "routing",
      routing: {
        lines: [
          { sequence: 1, text: "Earlier" },
          { sequence: 3, text: "Question" },
        ],
        context: null,
      },
    },
  });
  model.ask.mockResolvedValueOnce(
    '{"agents":[{"id":"unknown","reason":"No"}]}',
  );
  await expect(routing.choose(request)).rejects.toMatchObject({
    code: "observer_output_invalid",
  });
});

it("keeps the judged message when older history exceeds the character budget", async () => {
  const messages = {
    find: vi.fn().mockResolvedValue(message),
    history: vi.fn().mockResolvedValue([
      message,
      {
        ...message,
        text: "x".repeat(CONVERSATION_OBSERVER_LIMITS.routingContextCharacters),
      },
    ]),
  };
  const model = {
    ask: vi
      .fn<ConversationObserverModel["ask"]>()
      .mockResolvedValue('{"agents":[]}'),
  };
  const routing = new ConversationObserverRouting({
    messages,
    model,
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
  });
  await routing.choose(request);
  expect(model.ask.mock.calls[0]?.[0]).toMatchObject({
    material: { kind: "routing", routing: { lines: [{ text: "Question" }] } },
  });
  messages.find.mockResolvedValueOnce(null);
  await routing.choose(request);
  expect(messages.history).toHaveBeenCalledTimes(1);
  expect(model.ask.mock.calls[1]?.[0]).toMatchObject({
    material: { kind: "routing", routing: { lines: [] } },
  });
  expect(observerContextBlock(null)).toBeNull();
});

it("isolates failing event listeners and honors unsubscribe", () => {
  const events = new ConversationEvents();
  const failure = new Error("listener failed");
  const listener = vi.fn();
  events.subscribe(() => {
    throw failure;
  });
  const unsubscribe = events.subscribe(listener);
  const event = {
    kind: "conversation",
    conversationId: "group",
    recipientIds: ["person"],
  } as const;
  events.publish(event);
  expect(logCaughtError).toHaveBeenCalledWith("ConversationEvents", failure);
  expect(listener).toHaveBeenCalledWith(event);
  unsubscribe();
  events.publish(event);
  expect(listener).toHaveBeenCalledOnce();
  expect(sharedConversationEvents()).toBe(sharedConversationEvents());
});
