import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { ConversationAnswerStream } from "@/backend/service/conversation/ConversationAnswerStream";

import type { ConversationEvent } from "@/backend/service/conversation/ConversationEvents";
import type { LiveAnswerTarget } from "@/backend/service/conversation/ConversationLiveAnswer";

type AnswerEvent = Extract<ConversationEvent, { kind: "answer" }>;

const DIRECT: LiveAnswerTarget = {
  agentId: "ed",
  chatKind: "agent",
  chatId: "ed",
  recipientIds: ["igor"],
  thoughtRecipientIds: ["igor"],
  isTurnStored: true,
};

const GROUP: LiveAnswerTarget = {
  agentId: "ed",
  chatKind: "conversation",
  chatId: "team",
  recipientIds: ["igor", "anna"],
  thoughtRecipientIds: ["igor"],
  isTurnStored: false,
};

function fixture(): {
  readonly stream: ConversationAnswerStream;
  readonly events: AnswerEvent[];
  advance(milliseconds: number): void;
} {
  const events: AnswerEvent[] = [];
  let time = Date.parse("2026-11-14T10:00:00.000Z");
  let id = 0;
  const stream = new ConversationAnswerStream({
    events: {
      publish: (event) => {
        if (event.kind === "answer") events.push(event);
      },
    },
    now: () => new Date(time),
    createId: () => {
      id += 1;
      return `answer-${String(id)}`;
    },
  });
  return {
    stream,
    events,
    advance: (milliseconds) => {
      time += milliseconds;
      vi.advanceTimersByTime(milliseconds);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("streams the text of a direct answer word by word and ends it with the stored message", () => {
  const { stream, events } = fixture();
  const live = stream.open(DIRECT);
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Hallo " });
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Igor" });
  live.journaled({ kind: "answer", turn: 1, messageId: "message-1" });

  expect(events.map((event) => event.payload.type)).toEqual([
    "answer_text",
    "answer_text",
    "answer_end",
  ]);
  expect(events.every((event) => event.recipientIds.includes("igor"))).toBe(
    true,
  );
  const [first, second, end] = events.map((event) => event.payload.data);
  expect(first).toMatchObject({
    chatKind: "agent",
    chatId: "ed",
    agentId: "ed",
    answerId: "answer-1",
    seq: 1,
    delta: "Hallo ",
    isReset: false,
  });
  expect(second).toMatchObject({ seq: 2, delta: "Igor" });
  expect(end).toMatchObject({
    seq: 3,
    messageId: "message-1",
    state: "answered",
  });
  expect(stream.snapshots("igor")[0]).toMatchObject({
    text: "Hallo Igor",
    end: { messageId: "message-1", state: "answered" },
  });
});

it("begins a new answer for the next turn of a direct chat", () => {
  const { stream, events } = fixture();
  const live = stream.open(DIRECT);
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Eins" });
  live.journaled({ kind: "answer", turn: 1, messageId: "message-1" });
  live.journaled({ kind: "text", turn: 2, isReset: false, delta: "Zwei" });
  // The end of the job changes nothing for a turn that was stored.
  live.journaled({ kind: "answer", turn: 2, messageId: "message-2" });
  live.journaled({ kind: "end", state: "completed", errorCode: null });

  const answerIds = new Set(
    events.map((event) => event.payload.data.answerId),
  );
  expect([...answerIds]).toEqual(["answer-1", "answer-2"]);
  expect(
    events.filter((event) => event.payload.type === "answer_end"),
  ).toHaveLength(2);
});

it("sends thoughts only to their readers and closes them once the answer goes on", () => {
  const { stream, events, advance } = fixture();
  const live = stream.open(GROUP);
  live.thought(1, "Ich prüfe die Datei ");
  live.thought(1, "zuerst");
  advance(300);
  advance(2_000);
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Fertig" });

  const thoughts = events.filter(
    (event) => event.payload.type === "answer_thought",
  );
  expect(thoughts.map((event) => event.recipientIds)).toEqual([
    ["igor"],
    ["igor"],
  ]);
  expect(
    thoughts.map((event) =>
      event.payload.type === "answer_thought" ? event.payload.data.delta : "",
    ),
  ).toEqual(["Ich prüfe die Datei ", "zuerst"]);
  const text = events.find((event) => event.payload.type === "answer_text");
  expect(text?.recipientIds).toEqual(["igor", "anna"]);

  const owner = stream.snapshots("igor")[0];
  expect(owner?.thought?.text).toBe("Ich prüfe die Datei zuerst");
  expect(owner?.thought?.startedAt).toBe("2026-11-14T10:00:00.000Z");
  expect(owner?.thought?.endedAt).toBe("2026-11-14T10:00:02.300Z");
  // Another member sees the answer but never its thoughts.
  expect(stream.snapshots("anna")[0]).toMatchObject({
    text: "Fertig",
    thought: null,
  });
  expect(stream.snapshots("mallory")).toEqual([]);
});

it("masks a credential in the thoughts before anybody reads it", () => {
  const { stream, events } = fixture();
  const live = stream.open(DIRECT);
  live.thought(1, "Der Schlüssel ist sk-ant-api03-");
  live.thought(1, "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG und mehr");
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Gut" });
  const thought = events
    .flatMap((event) =>
      event.payload.type === "answer_thought" ? [event.payload.data.delta] : [],
    )
    .join("");
  expect(thought).not.toContain("abcdefghijklmnopqrstuvwxyz0123456789");
  expect(thought).toContain("Der Schlüssel ist");
});

it("shows a group answer without thoughts at all where the model reports none", () => {
  const { stream } = fixture();
  const live = stream.open(GROUP);
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Antwort" });
  expect(stream.snapshots("igor")[0]?.thought).toBeNull();
});

it("follows tool calls with their state and duration and cancels a running one at the end", () => {
  const { stream, events, advance } = fixture();
  const live = stream.open(GROUP);
  live.journaled({
    kind: "tool",
    callId: "read",
    tool: "Read",
    status: "running",
    error: null,
    input: "ConversationEvents.ts",
    isNative: true,
  });
  advance(1_200);
  live.journaled({
    kind: "tool",
    callId: "read",
    tool: "Read",
    status: "completed",
    error: null,
    output: "108 Zeilen",
    isNative: true,
  });
  live.journaled({
    kind: "tool",
    callId: "test",
    tool: "Bash",
    status: "running",
    error: null,
    input: "pnpm vitest",
  });
  // A group answer ignores the stored turn; the caller ends it with the reply.
  live.journaled({ kind: "answer", turn: 1, messageId: "session-message" });
  expect(
    events.some((event) => event.payload.type === "answer_end"),
  ).toBe(false);
  live.finish({ messageId: "reply", state: "answered" });

  const tools = stream.snapshots("anna")[0]?.tools ?? [];
  expect(tools).toEqual([
    expect.objectContaining({
      callId: "read",
      status: "completed",
      input: "ConversationEvents.ts",
      output: "108 Zeilen",
      startedAt: "2026-11-14T10:00:00.000Z",
      endedAt: "2026-11-14T10:00:01.200Z",
    }),
    expect.objectContaining({ callId: "test", status: "cancelled" }),
  ]);
  expect(events.at(-1)?.payload).toMatchObject({
    type: "answer_end",
    data: { messageId: "reply", state: "answered" },
  });
});

it("marks the running calls cancelled when the person cancels them", () => {
  const { stream, events } = fixture();
  const live = stream.open(DIRECT);
  live.journaled({
    kind: "tool",
    callId: "call",
    tool: "Bash",
    status: "running",
    error: null,
  });
  live.cancelTools();
  const last = events.at(-1)?.payload;
  expect(last).toMatchObject({
    type: "answer_tool",
    data: { tool: { callId: "call", status: "cancelled" } },
  });
});

it("tells how a message sent during the answer reached the agent", () => {
  const { stream, events } = fixture();
  const live = stream.open(DIRECT);
  live.journaled({ kind: "steer", messageId: "m1", status: "accepted" });
  live.journaled({ kind: "steer", messageId: "m2", status: "followUp" });
  expect(
    events.map((event) =>
      event.payload.type === "answer_steer"
        ? [event.payload.data.messageId, event.payload.data.delivery]
        : null,
    ),
  ).toEqual([
    ["m1", "injected"],
    ["m2", "waiting"],
  ]);
});

it("replaces the text of a group answer when a new turn begins, as the stored answer does", () => {
  const { stream, events } = fixture();
  const live = stream.open(GROUP);
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Alt" });
  live.journaled({ kind: "text", turn: 2, isReset: false, delta: "Neu" });
  expect(events.at(-1)?.payload).toMatchObject({
    type: "answer_text",
    data: { delta: "Neu", isReset: true },
  });
  expect(stream.snapshots("igor")[0]?.text).toBe("Neu");
});

it("forgets an ended answer after ten minutes", () => {
  const { stream, advance } = fixture();
  const live = stream.open(DIRECT);
  live.journaled({ kind: "text", turn: 1, isReset: false, delta: "Hi" });
  live.finish({ messageId: null, state: "stopped" });
  advance(9 * 60_000);
  expect(stream.snapshots("igor")).toHaveLength(1);
  advance(2 * 60_000);
  expect(stream.snapshots("igor")).toEqual([]);
});
