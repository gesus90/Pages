import { expect, it, vi } from "vitest";

import { ConversationRoundRepository } from "@/backend/database/repositories/conversation/ConversationRoundRepository";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationAccounts } from "@/backend/service/conversation/ConversationDirectory";
import { ConversationReplyRunner } from "@/backend/service/conversation/ConversationReplyRunner";
import { CONVERSATION_NO_RULE_OVERRIDES } from "@/definition/ConversationDecision";

import { deferred } from "../agents/page81-resource-fixture";

import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationAgentRepliesDependencies,
  ConversationAgentRequest,
} from "@/backend/service/conversation/ConversationAgentReplies";
import type { LiveAnswerSink } from "@/backend/service/conversation/ConversationLiveAnswer";
import type {
  ConversationReplyJob,
  ConversationReplyRunnerDependencies,
} from "@/backend/service/conversation/ConversationReplyRunner";
import type { ConversationMessage } from "@/definition/Conversation";
import type { User } from "@/definition/User";

const person: User = {
  id: "igor",
  username: "igor",
  displayName: "Igor",
  role: "employee",
  isActive: true,
  mustChangePassword: false,
};
const ed: User = { ...person, id: "ed", username: "ed", displayName: "Ed", isAgent: true };
const mei: User = { ...person, id: "mei", username: "mei", displayName: "Mei", isAgent: true };
const conversation = {
  id: "team",
  kind: "group",
  name: "Team",
  lastActivityAt: "2026-11-14",
  isMuted: false,
  unreadCount: 0,
} as const;
const MEMBERS = ["igor", "anna", "ed", "mei"];

function accounts(): ConversationAccounts {
  return new ConversationAccounts(
    new Map(
      [person, ed, mei].map((user) => [
        user.id,
        {
          user,
          participant: {
            id: user.id,
            name: user.displayName,
            kind: user.isAgent === true ? ("agent" as const) : ("human" as const),
            color: null,
          },
          role: "",
          isAvailable: true,
        },
      ]),
    ),
  );
}

function stored(id: string, text: string): StoredConversationMessage {
  return {
    id,
    sequence: 5,
    conversationId: "team",
    senderId: "igor",
    clientMessageId: `client-${id}`,
    text,
    mentions: [],
    createdAt: "2026-11-14T10:00:00.000Z",
    voice: null,
    notice: null,
  };
}

function runnerDependencies(
  answer: (request: ConversationAgentRequest) => Promise<string>,
): {
  readonly dependencies: ConversationReplyRunnerDependencies;
  readonly sink: LiveAnswerSink & { readonly finish: ReturnType<typeof vi.fn> };
  readonly open: ReturnType<typeof vi.fn>;
} {
  const sink = {
    journaled: vi.fn(),
    thought: vi.fn(),
    cancelTools: vi.fn(),
    finish: vi.fn(),
  };
  const open = vi.fn().mockReturnValue(sink);
  const history = [stored("m1", "Frage"), stored("m2", "Noch was")];
  const dependencies: ConversationReplyRunnerDependencies = {
    conversations: { findForMember: vi.fn().mockResolvedValue(conversation) },
    messages: {
      find: vi.fn(
        async (_conversationId: string, id: string) =>
          history.find((entry) => entry.id === id) ?? null,
      ),
      history: vi.fn().mockResolvedValue(history),
      contextCount: vi.fn().mockResolvedValue(history.length),
      insert: vi.fn().mockImplementation(async (message: { text: string }) => ({
        message: { ...stored("reply", message.text), senderId: "ed" },
        isNew: true,
      })),
    },
    directory: { read: vi.fn().mockResolvedValue(accounts()) },
    runner: {
      answer: vi.fn(answer),
      steer: vi.fn().mockResolvedValue(true),
      deliveredThrough: vi.fn().mockResolvedValue(4),
    },
    rounds: { setTargetState: vi.fn().mockResolvedValue(undefined) },
    contexts: { promptContext: vi.fn().mockResolvedValue({ context: null }) },
    events: { publish: vi.fn() },
    publisher: { publish: vi.fn() },
    agentFiles: {
      select: vi.fn().mockResolvedValue({ text: "x", files: [], lines: ["x"] }),
      open: vi.fn(),
    },
    attachments: { stage: vi.fn(), bind: vi.fn(), release: vi.fn(), open: vi.fn() },
    content: { describe: vi.fn().mockResolvedValue(new Map()) },
    now: () => new Date("2026-11-14T10:00:00Z"),
    answerStream: { open, ownerOf: vi.fn().mockResolvedValue("igor") },
  };
  return { dependencies, sink, open };
}

function job(messageId: string, agentId = "ed"): ConversationReplyJob {
  return {
    round: {
      originMessageId: messageId,
      conversation,
      memberIds: MEMBERS,
      person,
    },
    agentId,
    trigger: "mention",
    triggerMessageId: messageId,
    reason: "",
  };
}

it("streams a group answer to the members, its thoughts only to the owner, and ends it with the stored reply", async () => {
  const { dependencies, sink, open } = runnerDependencies(
    async () => "Fertig",
  );
  const runner = new ConversationReplyRunner(dependencies);
  await runner.run(job("m1"));
  expect(open).toHaveBeenCalledWith({
    agentId: "ed",
    chatKind: "conversation",
    chatId: "team",
    recipientIds: ["igor", "anna", "mei"],
    thoughtRecipientIds: ["igor"],
    isTurnStored: false,
  });
  const request = vi.mocked(dependencies.runner.answer).mock.calls[0]?.[0];
  expect(request?.liveAnswer).toBe(sink);
  expect(sink.finish).toHaveBeenCalledWith({
    messageId: "reply",
    state: "answered",
  });
});

it("ends a stopped group answer as stopped", async () => {
  const { dependencies, sink } = runnerDependencies(
    (request) =>
      new Promise<string>((_resolve, reject) => {
        request.signal?.addEventListener("abort", () =>
          reject(new Error("stopped")),
        );
      }),
  );
  const runner = new ConversationReplyRunner(dependencies);
  const answer = runner.run(job("m1"));
  await vi.waitFor(() => expect(dependencies.runner.answer).toHaveBeenCalled());
  runner.stop("team", "ed");
  await answer;
  expect(sink.finish).toHaveBeenCalledWith({ messageId: null, state: "stopped" });
});

it("names the messages a running answer took and forgets them when it ends", async () => {
  const running = deferred<string>();
  const { dependencies } = runnerDependencies(() => running.promise);
  const runner = new ConversationReplyRunner(dependencies);
  const first = runner.run(job("m1"));
  await vi.waitFor(() => expect(dependencies.runner.answer).toHaveBeenCalled());
  await runner.run(job("m2"));
  expect(runner.steeredMessages("team").get("m2")).toEqual(["ed"]);
  expect(runner.steeredMessages("other").size).toBe(0);
  running.resolve("Fertig");
  await first;
  expect(runner.steeredMessages("team").size).toBe(0);
});

it("holds a message sent after the answer until the agent ended it, showing it as waiting", async () => {
  const running = deferred<string>();
  const { dependencies } = runnerDependencies(() => running.promise);
  const runner = new ConversationReplyRunner(dependencies);
  const first = runner.run(job("m1"));
  await vi.waitFor(() => expect(runner.workingAgentIds("team")).toEqual(["ed"]));
  let isReleased = false;
  const held = runner.holdUntilIdle("team", "m2", ["ed"]).then(() => {
    isReleased = true;
  });
  await Promise.resolve();
  expect(runner.queuedMessages("team").get("m2")).toBe("chat");
  expect(isReleased).toBe(false);
  running.resolve("Fertig");
  await first;
  await held;
  expect(isReleased).toBe(true);
  expect(runner.queuedMessages("team").has("m2")).toBe(false);
});

it("lets a message sent after the answer go at once when nobody answers", async () => {
  const { dependencies } = runnerDependencies(async () => "x");
  const runner = new ConversationReplyRunner(dependencies);
  await runner.holdUntilIdle("team", "m2", ["ed"]);
  expect(runner.queuedMessages("team").size).toBe(0);
});

const message: ConversationMessage = {
  id: "steer",
  conversationId: "team",
  clientMessageId: "client",
  sender: { id: "igor", kind: "human", name: "Igor", color: null },
  text: "Nimm lieber Variante B",
  createdAt: "2026-11-14T10:00:00.000Z",
  mentions: [],
  attachments: [],
  links: [],
};

function repliesFixture(working: readonly string[]): {
  readonly service: ConversationAgentReplies;
  readonly dependencies: ConversationAgentRepliesDependencies;
  readonly rounds: ConversationRoundRepository;
  readonly hold: ReturnType<typeof vi.spyOn>;
} {
  const rounds = new ConversationRoundRepository({
    query: vi.fn(),
    execute: vi.fn(),
    transaction: vi.fn(),
  });
  vi.spyOn(rounds, "claim").mockResolvedValue("duplicate");
  vi.spyOn(rounds.handoffs, "paused").mockResolvedValue([]);
  vi.spyOn(rounds.followUps, "pending").mockResolvedValue([]);
  const dependencies: ConversationAgentRepliesDependencies = {
    conversations: {
      findForMember: vi.fn().mockResolvedValue(conversation),
      memberIds: vi.fn(),
    },
    messages: { find: vi.fn(), history: vi.fn(), insert: vi.fn(), contextCount: vi.fn() },
    directory: { read: vi.fn().mockResolvedValue(accounts()) },
    runner: { answer: vi.fn() },
    rounds,
    contexts: { promptContext: vi.fn() },
    replySettings: {
      find: vi.fn().mockResolvedValue({
        conversationId: "team",
        mode: "decision",
        overrides: CONVERSATION_NO_RULE_OVERRIDES,
      }),
    },
    decisions: {
      decide: vi.fn().mockResolvedValue([]),
      recordMention: vi.fn().mockResolvedValue(undefined),
    },
    events: { subscribe: vi.fn().mockReturnValue(vi.fn()), publish: vi.fn() },
    publisher: { publish: vi.fn() },
    agentFiles: { select: vi.fn(), open: vi.fn() },
    attachments: { stage: vi.fn(), bind: vi.fn(), release: vi.fn(), open: vi.fn() },
    content: { describe: vi.fn() },
    now: () => new Date("2026-11-14T10:00:00Z"),
  };
  const service = new ConversationAgentReplies(dependencies);
  const replies: ConversationReplyRunner = Reflect.get(service, "replies");
  vi.spyOn(replies, "workingAgentIds").mockReturnValue([...working]);
  const hold = vi.spyOn(replies, "holdUntilIdle").mockResolvedValue(undefined);
  return { service, dependencies, rounds, hold };
}

function claimedAgents(rounds: ConversationRoundRepository): string[] {
  return vi
    .mocked(rounds.claim)
    .mock.calls.map(([claim]) => `${claim.agentId}:${claim.trigger}`);
}

it("steers a message without @ into the answers of every agent answering now", async () => {
  const { service, dependencies, rounds } = repliesFixture(["ed", "mei"]);
  await service.answer(message, MEMBERS, "steer");
  expect(claimedAgents(rounds)).toEqual(["ed:mention", "mei:mention"]);
  expect(dependencies.decisions.decide).not.toHaveBeenCalled();
});

it("steers a message with @Name only into the answer of the named agent", async () => {
  const { service, rounds } = repliesFixture(["ed", "mei"]);
  await service.answer({ ...message, mentions: ["mei"] }, MEMBERS, "steer");
  expect(claimedAgents(rounds)).toEqual(["mei:mention"]);
});

it("routes a message as before when nobody answers or no delivery is named", async () => {
  const idle = repliesFixture([]);
  await idle.service.answer(message, MEMBERS, "steer");
  expect(idle.dependencies.decisions.decide).toHaveBeenCalledOnce();
  const mobile = repliesFixture(["ed"]);
  await mobile.service.answer(message, MEMBERS);
  expect(mobile.dependencies.decisions.decide).toHaveBeenCalledOnce();
  expect(mobile.hold).not.toHaveBeenCalled();
});

it("holds a message sent after the answers until the answering agents ended", async () => {
  const { service, dependencies, hold } = repliesFixture(["ed", "mei"]);
  await service.answer(message, MEMBERS, "after");
  expect(hold).toHaveBeenCalledWith("team", "steer", ["ed", "mei"]);
  expect(dependencies.decisions.decide).toHaveBeenCalledOnce();
});
