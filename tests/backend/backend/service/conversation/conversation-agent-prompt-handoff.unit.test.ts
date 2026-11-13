import { expect, it } from "vitest";

import {
  CONVERSATION_GROUP_HANDOFF_RULE,
  createConversationAgentPrompt,
} from "@/backend/service/conversation/ConversationAgentPrompt";

import { accountsOf, handoffFixture } from "./conversation-handoff-fixture";

it("tells agents in a group that they may address each other with @ again and again (PAGE-349)", () => {
  const { users, memberIds } = handoffFixture();
  const origin = {
    id: "origin",
    sequence: 1,
    conversationId: "group",
    senderId: "person",
    clientMessageId: "client",
    text: "@a Bitte abstimmen",
    mentions: ["a"],
    createdAt: "2026-11-13T10:00:00.000Z",
    voice: null,
    notice: null,
  };
  const prompt = createConversationAgentPrompt({
    conversation: { id: "group", kind: "group", name: "Team" },
    agentId: "a",
    newestFirst: [origin],
    accounts: accountsOf(users),
    trigger: {
      kind: "mention",
      reason: "",
      personId: "person",
      originSequence: 1,
    },
    context: null,
    memberIds,
  });
  expect(prompt).toContain(CONVERSATION_GROUP_HANDOFF_RULE);
  expect(prompt).toContain("auch mehrfach in derselben Runde");
  expect(prompt).toContain("bei fachlichem Bedarf mit @Benutzername");
  expect(prompt).not.toContain("höchstens einmal");
  expect(prompt).not.toContain("weitere Beiträge sind möglich");
  expect(prompt).not.toMatch(/Je Ursprungsnachricht/u);
});
