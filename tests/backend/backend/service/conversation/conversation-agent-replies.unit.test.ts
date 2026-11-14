import { expect, it, vi } from "vitest";

import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";

import { CONVERSATION_AGENT_SEND_PREFIX } from "@/definition/Conversation";
import { CONVERSATION_NO_RULE_OVERRIDES } from "@/definition/ConversationDecision";

import type { ConversationAgentRepliesDependencies } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationReplySettings } from "@/definition/ConversationDecision";
import type { User } from "@/definition/User";

const person: User = {
  id: "person",
  username: "person",
  displayName: "Person",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const agent: User = {
  ...person,
  id: "agent",
  username: "agent",
  displayName: "Agent",
  isAgent: true,
};
const conversation = {
  id: "group",
  kind: "group",
  name: "Team",
  lastActivityAt: "today",
  isMuted: false,
  unreadCount: 0,
} as const;
const message: ConversationMessage = {
  id: "origin",
  conversationId: "group",
  clientMessageId: "client",
  sender: { id: "person", kind: "human", name: "Person", color: null },
  text: "Question",
  createdAt: "today",
  mentions: [],
  attachments: [],
  links: [],
};

const decisionSettings: ConversationReplySettings = {
  conversationId: "group",
  mode: "decision",
  overrides: CONVERSATION_NO_RULE_OVERRIDES,
};
const mentionsSettings: ConversationReplySettings = {
  ...decisionSettings,
  mode: "mentions",
};
const agentMessage: ConversationMessage = {
  ...message,
  id: "agent-message",
  clientMessageId: `${CONVERSATION_AGENT_SEND_PREFIX}1`,
  sender: { id: "agent", kind: "agent", name: "Agent", color: null },
};

function fixture(): {
  service: ConversationAgentReplies;
  dependencies: ConversationAgentRepliesDependencies;
  rounds: ConversationRoundRepository;
} {
  const accounts = new ConversationAccounts(
    new Map([
      [
        person.id,
        {
          user: person,
          participant: message.sender,
          role: "",
          isAvailable: true,
        },
      ],
      [
        agent.id,
        {
          user: agent,
          participant: {
            id: agent.id,
            name: agent.displayName,
            kind: "agent",
            color: null,
          },
          role: "Research",
          isAvailable: true,
        },
      ],
    ]),
  );
  const rounds = new ConversationRoundRepository({
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  });
  vi.spyOn(rounds, "claim").mockResolvedValue("duplicate");
  vi.spyOn(rounds.followUps, "pending").mockResolvedValue([]);
  vi.spyOn(rounds, "round").mockResolvedValue(null);
  vi.spyOn(rounds, "claimRouting").mockResolvedValue(true);
  vi.spyOn(rounds, "finishRouting").mockResolvedValue(undefined);
  vi.spyOn(rounds.handoffs, "pauseUnstarted").mockResolvedValue([]);
  vi.spyOn(rounds.handoffs, "paused").mockResolvedValue([]);
  vi.spyOn(rounds.handoffs, "request").mockResolvedValue([]);
  vi.spyOn(rounds, "interruptStale").mockResolvedValue(2);
  const dependencies: ConversationAgentRepliesDependencies = {
    conversations: {
      findForMember: vi.fn().mockResolvedValue(conversation),
      memberIds: vi.fn(),
    },
    messages: {
      find: vi.fn(),
      history: vi.fn(),
      insert: vi.fn(),
      contextCount: vi.fn(),
    },
    directory: { read: vi.fn().mockResolvedValue(accounts) },
    runner: { answer: vi.fn() },
    rounds,
    contexts: { promptContext: vi.fn() },
    replySettings: { find: vi.fn().mockResolvedValue(decisionSettings) },
    decisions: {
      decide: vi
        .fn()
        .mockResolvedValue([
          { agentId: "agent", trigger: "context", reason: "Das Modell." },
        ]),
      recordMention: vi.fn().mockResolvedValue(undefined),
    },
    events: { subscribe: vi.fn().mockReturnValue(vi.fn()), publish: vi.fn() },
    publisher: { publish: vi.fn() },
    agentFiles: { select: vi.fn(), open: vi.fn() },
    attachments: {
      stage: vi.fn(),
      bind: vi.fn(),
      release: vi.fn(),
      open: vi.fn(),
    },
    content: { describe: vi.fn() },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return {
    service: new ConversationAgentReplies(dependencies),
    dependencies,
    rounds,
  };
}

it("deduplicates valid mentions, claims only the named agent and never asks the decision model", async () => {
  const { service, dependencies, rounds } = fixture();
  await service.answer(
    { ...message, mentions: ["agent", "agent", "person", "unknown"] },
    ["person", "agent"],
  );
  expect(rounds.claim).toHaveBeenCalledOnce();
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "agent",
      trigger: "mention",
      isAutomatic: false,
      originMessageId: "origin",
    }),
  );
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
  expect(dependencies.runner.answer).not.toHaveBeenCalled();
});

it("records an @ addressing of a person in the decision mode, and only there", async () => {
  const { service, dependencies } = fixture();
  await service.answer({ ...message, mentions: ["agent"] }, [
    "person",
    "agent",
  ]);
  expect(dependencies.decisions.recordMention).toHaveBeenCalledWith({
    conversationId: "group",
    messageId: "origin",
    agentIds: ["agent"],
  });
  vi.mocked(dependencies.replySettings.find).mockResolvedValue(
    mentionsSettings,
  );
  vi.mocked(dependencies.decisions.recordMention).mockClear();
  await service.answer({ ...message, mentions: ["agent"] }, [
    "person",
    "agent",
  ]);
  expect(dependencies.decisions.recordMention).not.toHaveBeenCalled();
  vi.mocked(dependencies.replySettings.find).mockResolvedValue(
    decisionSettings,
  );
  await service.answer({ ...agentMessage, mentions: ["agent"] }, [
    "person",
    "agent",
  ]);
  expect(dependencies.decisions.recordMention).not.toHaveBeenCalled();
});

it("answers a message that names agents even when recording the @ addressing fails", async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.decisions.recordMention).mockRejectedValueOnce(
    new Error("database down"),
  );
  await service.answer({ ...message, mentions: ["agent"] }, [
    "person",
    "agent",
  ]);
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "agent", trigger: "mention" }),
  );
});

it("asks the decision model exactly once for a person's message without an @ and starts what it settles on", async () => {
  const { service, dependencies, rounds } = fixture();
  await service.answer(message, ["person", "agent"]);
  expect(dependencies.decisions.decide).toHaveBeenCalledOnce();
  expect(dependencies.decisions.decide).toHaveBeenCalledWith(
    expect.objectContaining({
      originMessageId: "origin",
      settings: decisionSettings,
      memberIds: ["person", "agent"],
    }),
  );
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({
      agentId: "agent",
      trigger: "context",
      reason: "Das Modell.",
      isAutomatic: true,
    }),
  );
});

it("starts nobody when the decision settles on nobody", async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.decisions.decide).mockResolvedValueOnce([]);
  await service.answer(message, ["person", "agent"]);
  expect(rounds.claim).not.toHaveBeenCalled();
});

it('never asks the decision model in the mode "Nur @"', async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.replySettings.find).mockResolvedValue(
    mentionsSettings,
  );
  await service.answer(message, ["person", "agent"]);
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
  expect(rounds.claim).not.toHaveBeenCalled();
});

it("treats a message that names only people as addressed to them: no decision, no agent", async () => {
  const { service, dependencies, rounds } = fixture();
  await service.answer({ ...message, mentions: ["person"] }, [
    "person",
    "agent",
  ]);
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
  expect(rounds.claim).not.toHaveBeenCalled();
});

it("wakes no other agent with a message an agent sent without an @", async () => {
  const { service, dependencies, rounds } = fixture();
  await service.answer(agentMessage, ["person", "agent"]);
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
  expect(rounds.claim).not.toHaveBeenCalled();
});

it("wakes exactly the agent a message of an agent names with @", async () => {
  const { service, dependencies, rounds } = fixture();
  const other: User = {
    ...agent,
    id: "other",
    username: "other",
    displayName: "Other",
  };
  const accounts = await dependencies.directory.read();
  vi.mocked(dependencies.directory.read).mockResolvedValue(
    new ConversationAccounts(
      new Map([
        ...[...["person", "agent"]].flatMap((id) => {
          const account = accounts.find(id);
          return account ? [[id, account] as const] : [];
        }),
        [
          other.id,
          {
            user: other,
            participant: {
              id: other.id,
              name: "Other",
              kind: "agent",
              color: null,
            },
            role: "",
            isAvailable: true,
          },
        ],
      ]),
    ),
  );
  await service.answer({ ...agentMessage, mentions: ["other"] }, [
    "person",
    "agent",
    "other",
  ]);
  expect(rounds.claim).toHaveBeenCalledOnce();
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "other", trigger: "mention" }),
  );
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
});

it("claims a direct partner and ignores unknown senders or missing conversations", async () => {
  const { service, dependencies, rounds } = fixture();
  vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce({
    ...conversation,
    kind: "direct",
  });
  await service.answer(message, ["person", "agent"]);
  expect(rounds.claim).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: "agent", trigger: "direct" }),
  );
  await service.answer(
    { ...message, sender: { ...message.sender, id: "unknown" } },
    ["person", "agent"],
  );
  vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce(
    null,
  );
  await service.answer(message, ["person", "agent"]);
  expect(rounds.claim).toHaveBeenCalledOnce();
});

it("requires membership to stop and interrupts stale work during recovery", async () => {
  const { service, dependencies, rounds } = fixture();
  expect(await service.stop(person, "group", "agent")).toBe(false);
  vi.mocked(dependencies.conversations.findForMember).mockResolvedValueOnce(
    null,
  );
  await expect(service.stop(person, "group", "agent")).rejects.toMatchObject({
    code: "not_found",
  });
  await service.recover(new Date("2026-01-01T00:00:00Z"));
  expect(rounds.interruptStale).toHaveBeenCalledWith(
    "2026-01-01T00:00:00.000Z",
  );
  expect(service.workingAgentIds("group")).toEqual([]);
  expect(service.queuedMessages("group").size).toBe(0);
});

it("PAGE-344 starts a reply for an image-only message", async () => {
  const { service, dependencies, rounds } = fixture();
  service.start();
  const receive = vi.mocked(dependencies.events.subscribe).mock.calls[0]?.[0];
  if (!receive) throw new Error("Missing subscriber");
  receive({
    kind: "message",
    recipientIds: ["person", "agent"],
    message: {
      ...message,
      text: "",
      mentions: ["agent"],
      attachments: [
        {
          id: "image",
          name: "image.png",
          mimeType: "image/png",
          kind: "image",
          sizeBytes: 3,
          url: "/chat/files/image",
        },
      ],
    },
  });
  await vi.waitFor(() =>
    expect(rounds.claim).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: "mention", agentId: "agent" }),
    ),
  );
});

it("PAGE-326 keeps collective mentions in one origin and never invokes automatic routing", async () => {
  const { service, dependencies, rounds } = fixture();
  const accounts = await dependencies.directory.read();
  const other = { ...agent, id: "designer", username: "designer" };
  const otherAccount = {
    user: other,
    participant: {
      id: other.id,
      name: other.displayName,
      kind: "agent",
      color: null,
    },
    role: "Design",
    isAvailable: true,
  } as const;
  const original = accounts.find("agent");
  const sender = accounts.find("person");
  if (!original || !sender) throw new Error("Missing fixture accounts");
  const directory = new ConversationAccounts(
    new Map([
      ["agent", original],
      ["person", sender],
      [other.id, otherAccount],
    ]),
  );
  vi.mocked(dependencies.directory.read).mockResolvedValue(directory);
  const { findConversationMentions } =
    await import("@/backend/service/conversation/ConversationMentions");
  const memberIds = ["person", "agent", "designer"];
  const mentions = findConversationMentions(
    "@alle @all @team @agent",
    memberIds,
    { accounts: directory, senderId: "person" },
  );
  await service.answer(
    { ...message, text: "@alle @all @team @agent", mentions },
    memberIds,
  );
  expect(rounds.claim).toHaveBeenCalledTimes(2);
  for (const agentId of ["agent", "designer"])
    expect(rounds.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        originMessageId: "origin",
        agentId,
        trigger: "mention",
        isAutomatic: false,
      }),
    );
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
});

it("PAGE-326 starts and stores the chosen agent's answer to a message without @ exactly once", async () => {
  const { service, dependencies, rounds } = fixture();
  const stored = {
    id: "origin",
    sequence: 1,
    conversationId: "group",
    clientMessageId: "client",
    senderId: "person",
    text: "Bitte repariere den Chat.",
    mentions: [],
    createdAt: "today",
    voice: null,
    notice: null,
  };
  vi.mocked(dependencies.replySettings.find).mockResolvedValue({
    conversationId: "group",
    mode: "decision",
    overrides: CONVERSATION_NO_RULE_OVERRIDES,
  });
  vi.mocked(dependencies.decisions.decide).mockResolvedValue([
    {
      agentId: "agent",
      trigger: "context",
      reason: "Der Agent entwickelt den Chat.",
    },
  ]);
  vi.mocked(rounds.claim)
    .mockResolvedValueOnce("claimed")
    .mockResolvedValue("duplicate");
  vi.spyOn(rounds, "setTargetState").mockResolvedValue(undefined);
  vi.mocked(dependencies.messages.find).mockResolvedValue(stored);
  vi.mocked(dependencies.messages.history).mockResolvedValue([stored]);
  vi.mocked(dependencies.contexts.promptContext).mockResolvedValue({
    context: null,
    view: {
      conversationId: "group",
      status: "unavailable",
      summary: "",
      decisions: [],
      openItems: [],
      responsibilities: [],
      updatedAt: null,
      throughSequence: 0,
      pendingMessages: 1,
      hasExcerpts: false,
      sources: [],
      errorCode: null,
    },
  });
  vi.mocked(dependencies.runner.answer).mockResolvedValue(
    "Ich übernehme die Chat-Reparatur.",
  );
  vi.mocked(dependencies.agentFiles.select).mockResolvedValue({
    text: "Ich übernehme die Chat-Reparatur.",
    files: [],
    lines: ["Ich übernehme die Chat-Reparatur."],
  });
  vi.mocked(dependencies.messages.insert).mockResolvedValue({
    isNew: true,
    message: {
      ...stored,
      id: "answer",
      senderId: "agent",
      text: "Ich übernehme die Chat-Reparatur.",
    },
  });
  vi.mocked(dependencies.content.describe).mockResolvedValue(new Map());
  await service.answer({ ...message, text: stored.text }, ["person", "agent"]);
  await service.answer({ ...message, text: stored.text }, ["person", "agent"]);
  expect(dependencies.runner.answer).toHaveBeenCalledOnce();
  expect(dependencies.runner.answer).toHaveBeenCalledWith(
    expect.objectContaining({
      agent,
      lastMessage: stored.text,
      prompt: expect.stringContaining(
        "Der Agent entwickelt den Chat.",
      ) as unknown,
    }),
  );
  expect(dependencies.messages.insert).toHaveBeenCalledOnce();
  expect(dependencies.messages.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      senderId: "agent",
      clientMessageId: expect.stringContaining("origin") as unknown,
      text: "Ich übernehme die Chat-Reparatur.",
    }),
    expect.anything(),
  );
});
