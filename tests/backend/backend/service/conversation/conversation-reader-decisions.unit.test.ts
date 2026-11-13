import { beforeEach, expect, it, vi } from "vitest";

import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";

import { bareInstance } from "../tasks/bare-instance";

import type {
  StoredConversationDecision,
} from "@/backend/database/repositories/conversation/ConversationDecisionRepository";
import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "anna",
  displayName: "Anna",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};

function account(id: string, name: string, isAgent: boolean) {
  return [
    id,
    {
      user: { ...person, id, displayName: name, isAgent },
      participant: {
        id,
        name,
        kind: isAgent ? ("agent" as const) : ("human" as const),
        color: null,
      },
      role: "",
      isAvailable: true,
    },
  ] as const;
}

function message(
  id: string,
  sequence: number,
  senderId: string,
): StoredConversationMessage {
  return {
    id,
    sequence,
    conversationId: "group",
    senderId,
    clientMessageId: `client-${id}`,
    text: id,
    mentions: [],
    createdAt: "2026-01-01T00:00:00Z",
    voice: null,
    notice: null,
  };
}

function decision(
  messageId: string,
  outcome: StoredConversationDecision["outcome"],
): StoredConversationDecision {
  return {
    messageId,
    conversationId: "group",
    outcome,
    fallback: "none",
    responderIds: outcome === "responders" ? ["ed"] : [],
    model: "perplexity/pplx-decider-v1.3",
    answerProbability: outcome === "nobody" ? 0.06 : 0.82,
    choices:
      outcome === "nobody"
        ? [
            { agentId: null, probability: 0.91 },
            { agentId: "ed", probability: 0.05 },
          ]
        : [
            { agentId: "ed", probability: 0.78 },
            { agentId: null, probability: 0.07 },
          ],
    createdAt: "2026-01-01T00:00:00Z",
  };
}

const forMessages = vi.fn();
const forReplies = vi.fn();

function reader(stored: readonly StoredConversationMessage[]): ConversationReader {
  const conversations = bareInstance(ConversationRepository.prototype);
  vi.spyOn(conversations, "findForMember").mockResolvedValue({
    id: "group",
    kind: "group",
    name: "Team",
    lastActivityAt: "today",
    isMuted: false,
    unreadCount: 0,
  });
  const messages = bareInstance(ConversationMessageRepository.prototype);
  vi.spyOn(messages, "history").mockResolvedValue([...stored].reverse());
  return new ConversationReader({
    conversations,
    messages,
    directory: {
      read: vi.fn().mockResolvedValue(
        new ConversationAccounts(
          new Map([
            account("person", "Anna", false),
            account("other", "Berta", false),
            account("ed", "Ed", true),
          ]),
        ),
      ),
    },
    files: { open: vi.fn() },
    decisions: { forMessages, forReplies },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  forMessages.mockResolvedValue(new Map());
  forReplies.mockResolvedValue(new Map());
});

it("shows the decision \"nobody answers\" under the message of any member, with its probabilities", async () => {
  forMessages.mockResolvedValue(
    new Map([
      ["thanks", decision("thanks", "nobody")],
      ["berta-thanks", decision("berta-thanks", "nobody")],
    ]),
  );
  const page = await reader([
    message("thanks", 1, "person"),
    message("berta-thanks", 2, "other"),
  ]).history(person, "group", null, { withDecisions: true });
  expect(forMessages).toHaveBeenCalledWith(["thanks", "berta-thanks"]);
  for (const entry of page.messages) {
    expect(entry.decision).toMatchObject({
      outcome: "nobody",
      answerProbability: 0.06,
      model: "perplexity/pplx-decider-v1.3",
      choices: [
        { agentId: null, probability: 0.91 },
        { agentId: "ed", name: "Ed", probability: 0.05 },
      ],
    });
  }
});

it("shows no line under a message that agents answer, that names agents with @, or where the model was unavailable", async () => {
  forMessages.mockResolvedValue(
    new Map([
      ["asked", decision("asked", "responders")],
      ["mentioned", decision("mentioned", "mention")],
      ["failed", decision("failed", "unavailable")],
    ]),
  );
  const page = await reader([
    message("asked", 1, "person"),
    message("mentioned", 2, "person"),
    message("failed", 3, "person"),
    message("plain", 4, "person"),
  ]).history(person, "group", null, { withDecisions: true });
  expect(page.messages.map((entry) => entry.decision)).toEqual([
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
});

it("attaches the decision that chose an agent to its answer, for \"Warum?\"", async () => {
  forReplies.mockResolvedValue(new Map([["answer", decision("asked", "responders")]]));
  const page = await reader([
    message("asked", 1, "person"),
    message("answer", 2, "ed"),
    message("other-answer", 3, "ed"),
  ]).history(person, "group", null, { withDecisions: true });
  expect(forReplies).toHaveBeenCalledWith(["answer", "other-answer"]);
  expect(page.messages[0]?.decision).toBeUndefined();
  expect(page.messages[1]?.decision).toMatchObject({
    outcome: "responders",
    responders: [{ id: "ed", name: "Ed" }],
    answerProbability: 0.82,
  });
  expect(page.messages[2]?.decision).toBeUndefined();
});

it("reads no decision where the caller did not ask for them", async () => {
  const page = await reader([message("thanks", 1, "person")]).history(
    person,
    "group",
    null,
  );
  expect(forMessages).not.toHaveBeenCalled();
  expect(page.messages[0]?.decision).toBeUndefined();
});
