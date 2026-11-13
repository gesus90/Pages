import { expect, it, vi } from "vitest";

import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { createConversationAgentPrompt } from "@/backend/service/conversation/ConversationAgentPrompt";
import { ConversationReplyRunner } from "@/backend/service/conversation/ConversationReplyRunner";

import { deferred } from "../agents/page81-resource-fixture";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "@/backend/service/conversation/ConversationReplyRunner";
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
  lastActivityAt: "2026-01-01",
  isMuted: false,
  unreadCount: 0,
} as const;

function stored(sequence: number, text: string): StoredConversationMessage {
  return {
    id: `message-${String(sequence)}`,
    sequence,
    conversationId: "group",
    senderId: "person",
    clientMessageId: `client-${String(sequence)}`,
    text,
    mentions: [],
    createdAt: `2026-01-01T10:0${String(sequence)}:00.000Z`,
    voice: null,
    notice: null,
  };
}

function accounts(): ConversationAccounts {
  return new ConversationAccounts(
    new Map([
      [
        "agent",
        {
          user: agent,
          participant: { id: "agent", name: "Agent", kind: "agent", color: null },
          role: "",
          isAvailable: true,
        },
      ],
      [
        "person",
        {
          user: person,
          participant: {
            id: "person",
            name: "Person",
            kind: "human",
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ],
    ]),
  );
}

function promptOf(deliveredThrough: number | undefined): string {
  return createConversationAgentPrompt({
    conversation,
    agentId: "agent",
    newestFirst: [6, 5, 4, 3].map((sequence) =>
      stored(sequence, `Text ${String(sequence)}`),
    ),
    accounts: accounts(),
    trigger: {
      kind: "mention",
      reason: "",
      personId: "person",
      originSequence: 6,
    },
    context: null,
    memberIds: ["person", "agent"],
    ...(deliveredThrough === undefined ? {} : { deliveredThrough }),
  });
}

it("opens a chat with its context and gives every later round only the news", () => {
  const opening = promptOf(undefined);
  expect(opening).toContain("Letzte Nachrichten");
  for (const sequence of [3, 4, 5, 6])
    expect(opening).toContain(`#${String(sequence)} `);

  const round = promptOf(4);
  // Only the messages after the position of the session, with sender and time.
  expect(round).toContain("#5 [2026-01-01 10:05] Person: Text 5");
  expect(round).toContain("#6 [2026-01-01 10:06] Person: Text 6");
  expect(round).not.toContain("Text 3");
  expect(round).not.toContain("Text 4");
  expect(round).toContain("nach #4");
  expect(round).not.toContain("Letzte Nachrichten");
  expect(round).not.toContain("Gruppenkontext");
});

it("names the tool chat_lesen when more arrived than a round carries", () => {
  const newestFirst = Array.from({ length: 20 }, (_, index) =>
    stored(40 - index, `Neu ${String(40 - index)}`),
  );
  const prompt = createConversationAgentPrompt({
    conversation,
    agentId: "agent",
    newestFirst,
    accounts: accounts(),
    trigger: {
      kind: "mention",
      reason: "",
      personId: "person",
      originSequence: 40,
    },
    context: null,
    memberIds: ["person", "agent"],
    deliveredThrough: 5,
  });
  expect(prompt).toContain("chat_lesen (ab 5)");
});

interface RunnerFixture {
  readonly runner: ConversationReplyRunner;
  readonly answer: ReturnType<typeof vi.fn>;
  readonly steer: ReturnType<typeof vi.fn>;
  readonly insert: ReturnType<typeof vi.fn>;
  readonly setTargetState: ReturnType<typeof vi.fn>;
  readonly promptContext: ReturnType<typeof vi.fn>;
}

function runnerFixture(delivered: number): RunnerFixture {
  const answer = vi.fn().mockResolvedValue("Antwort");
  const steer = vi.fn().mockResolvedValue(true);
  const insert = vi.fn().mockImplementation(async (message: { text: string }) => ({
    message: { ...stored(99, message.text), id: "reply", senderId: "agent" },
    isNew: true,
  }));
  const setTargetState = vi.fn().mockResolvedValue(undefined);
  const promptContext = vi.fn().mockResolvedValue({ context: null });
  const history = [6, 5, 4, 3].map((sequence) =>
    stored(sequence, `Text ${String(sequence)}`),
  );
  const dependencies: ConversationReplyRunnerDependencies = {
    conversations: { findForMember: vi.fn().mockResolvedValue(conversation) },
    messages: {
      find: vi.fn(async (_conversation: string, id: string) =>
        history.find((entry) => entry.id === id),
      ),
      history: vi.fn().mockResolvedValue(history),
      insert,
    },
    directory: { read: vi.fn().mockResolvedValue(accounts()) },
    runner: {
      answer,
      steer,
      deliveredThrough: vi.fn().mockResolvedValue(delivered),
    },
    rounds: { setTargetState },
    contexts: { promptContext },
    events: { publish: vi.fn() },
    publisher: { publish: vi.fn() },
    agentFiles: {
      select: vi
        .fn()
        .mockResolvedValue({ text: "Antwort", files: [], lines: ["Antwort"] }),
      open: vi.fn(),
    },
    attachments: { stage: vi.fn(), bind: vi.fn(), release: vi.fn() },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
    now: () => new Date("2026-01-01T00:00:00Z"),
  };
  return {
    runner: new ConversationReplyRunner(dependencies),
    answer,
    steer,
    insert,
    setTargetState,
    promptContext,
  };
}

function jobFor(messageId: string, origin = messageId): ConversationReplyJob {
  return {
    round: {
      originMessageId: origin,
      conversation,
      memberIds: ["person", "agent"],
      person,
    },
    agentId: "agent",
    trigger: "mention",
    triggerMessageId: messageId,
    reason: "",
  };
}

it("asks a session that knows the chat up to #4 only for #5 and #6 and loads no stored context", async () => {
  const { runner, answer, promptContext } = runnerFixture(4);
  await runner.run(jobFor("message-6"));
  const request: { prompt: string; throughSequence: number } =
    answer.mock.calls[0]?.[0];
  expect(request.prompt).toContain("Text 5");
  expect(request.prompt).toContain("Text 6");
  expect(request.prompt).not.toContain("Text 4");
  expect(request.throughSequence).toBe(6);
  expect(promptContext).not.toHaveBeenCalled();
});

it("opens a session that knows nothing with the stored context of the group", async () => {
  const { runner, answer, promptContext } = runnerFixture(0);
  await runner.run(jobFor("message-6"));
  expect(promptContext).toHaveBeenCalledWith("group");
  expect(answer.mock.calls[0]?.[0].prompt).toContain("Letzte Nachrichten");
});

it("hands a message that arrives during an answer to the running answer instead of starting a second one", async () => {
  const fixture = runnerFixture(4);
  const running = deferred<string>();
  fixture.answer.mockReturnValueOnce(running.promise);
  const first = fixture.runner.run(jobFor("message-5"));
  await vi.waitFor(() => expect(fixture.answer).toHaveBeenCalledOnce());
  const second = fixture.runner.run(jobFor("message-6"));
  await expect(second).resolves.toBeNull();
  // The second message went into the running answer; no second answer was asked for.
  expect(fixture.steer).toHaveBeenCalledOnce();
  expect(fixture.steer.mock.calls[0]?.[0]).toMatchObject({
    throughSequence: 6,
  });
  expect(fixture.answer).toHaveBeenCalledOnce();
  expect(fixture.runner.queuedMessages("group").get("message-6")).toBe("chat");
  running.resolve("Eine Antwort");
  await expect(first).resolves.toMatchObject({ id: "reply" });
  // One stored answer, and the round of the second message points at it.
  expect(fixture.insert).toHaveBeenCalledOnce();
  expect(fixture.setTargetState).toHaveBeenCalledWith(
    { originMessageId: "message-6", agentId: "agent" },
    expect.objectContaining({ state: "answered", replyMessageId: "reply" }),
  );
  expect(fixture.runner.queuedMessages("group").size).toBe(0);
});

it("lets a message wait for its own turn when the running answer takes no steer", async () => {
  const fixture = runnerFixture(4);
  fixture.steer.mockResolvedValue(false);
  const running = deferred<string>();
  fixture.answer.mockReturnValueOnce(running.promise);
  const first = fixture.runner.run(jobFor("message-5"));
  await vi.waitFor(() => expect(fixture.answer).toHaveBeenCalledOnce());
  const second = fixture.runner.run(jobFor("message-6"));
  await vi.waitFor(() => expect(fixture.steer).toHaveBeenCalledOnce());
  expect(fixture.answer).toHaveBeenCalledOnce();
  running.resolve("Erste Antwort");
  await first;
  await second;
  expect(fixture.answer).toHaveBeenCalledTimes(2);
  expect(fixture.insert).toHaveBeenCalledTimes(2);
});
