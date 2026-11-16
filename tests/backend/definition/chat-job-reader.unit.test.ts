import { expect, it } from "vitest";

import {
  readChatJob,
  readChatJobEvent,
  readChatJobUpdate,
  readChatJobUsage,
  readChatSelectionItems,
  readChatSessionState,
  readChatSteer,
} from "@/definition/ChatJobReader";

it("reads usage including legacy costs and rejects malformed counters", () => {
  expect(readChatJobUsage({})).toEqual({
    context: null,
    tokens: null,
    cost: null,
  });
  expect(
    readChatJobUsage({
      context: { used: 2, size: 8 },
      tokens: { input: 2, output: 3, total: 5, isPartial: false },
      cost: { amount: 1.5, currency: "USD", scope: "session" },
    }),
  ).toEqual({
    context: { used: 2, size: 8 },
    tokens: { input: 2, output: 3, total: 5, isPartial: false },
    cost: {
      amount: 1.5,
      currency: "USD",
      scope: "session",
      isEstimated: false,
    },
  });
  for (const usage of [
    { tokens: { input: -1, output: 1, total: 0, isPartial: false } },
    { cost: { amount: Infinity, currency: "USD" } },
    { context: { used: 1.5, size: 2 } },
  ])
    expect(() => readChatJobUsage(usage)).toThrow(TypeError);
});

it.each([
  [
    { kind: "phase", phase: "running" },
    { kind: "phase", phase: "running" },
  ],
  [
    { kind: "turn", turn: 1, origin: "message", startedAt: "now" },
    { kind: "turn", turn: 1, origin: "message", startedAt: "now" },
  ],
  [
    { kind: "text", turn: 1, isReset: false, delta: "hello" },
    { kind: "text", turn: 1, isReset: false, delta: "hello" },
  ],
  [
    {
      kind: "tool",
      callId: "c",
      tool: "read",
      status: "completed",
      durationMs: 1.6,
    },
    {
      kind: "tool",
      callId: "c",
      tool: "read",
      status: "completed",
      error: null,
      durationMs: 2,
    },
  ],
  [
    { kind: "steer", messageId: "m", status: "pending" },
    { kind: "steer", messageId: "m", status: "pending" },
  ],
  [
    { kind: "answer", messageId: "m", turn: 2 },
    { kind: "answer", messageId: "m", turn: 2 },
  ],
  [
    { kind: "compaction", status: "completed", tokensBefore: 20 },
    {
      kind: "compaction",
      status: "completed",
      tokensBefore: 20,
      tokensAfter: null,
    },
  ],
  [
    { kind: "session", isResumed: true },
    { kind: "session", isResumed: true },
  ],
  [
    { kind: "capabilities", canSteer: false },
    { kind: "capabilities", canSteer: false },
  ],
  [
    { kind: "end", state: "completed" },
    { kind: "end", state: "completed", errorCode: null },
  ],
])("reads a journal event", (input, expected) => {
  expect(readChatJobEvent(input)).toEqual(expected);
});

it.each([
  null,
  [],
  { kind: "unknown" },
  { kind: "text", turn: 0, delta: "x" },
  { kind: "session", isResumed: "yes" },
  { kind: "phase", phase: "unknown" },
])("rejects invalid journal entries", (input) => {
  expect(() => readChatJobEvent(input)).toThrow(TypeError);
});

it("reads a job, cursor and conversation state", () => {
  const job = {
    id: "job",
    sessionId: "session",
    state: "completed",
    createdAt: "now",
    usage: {},
  };
  expect(readChatJob(job)).toMatchObject({
    ...job,
    errorCode: null,
    endedAt: null,
    usage: { tokens: null },
  });
  expect(
    readChatJobUpdate({
      job,
      events: [{ sequence: 1, event: { kind: "session", isResumed: false } }],
      cursor: 1,
      hasMore: false,
    }),
  ).toMatchObject({ cursor: 1, hasMore: false, events: [{ sequence: 1 }] });
  expect(
    readChatSessionState({
      sessionId: "session",
      lastMessageAt: "now",
      jobState: null,
    }),
  ).toEqual({
    sessionId: "session",
    lastMessageAt: "now",
    jobId: null,
    jobState: null,
  });
  expect(() =>
    readChatJobUpdate({ job, events: [], cursor: -1, hasMore: false }),
  ).toThrow(TypeError);
});

it("reads selection scope and queued steering", () => {
  expect(
    readChatSelectionItems([
      {
        attachmentId: "a",
        fileName: "file",
        contentType: "text/plain",
        size: 5,
        transfer: "full",
        scope: { characters: 5, pages: { read: 1, total: 2 } },
      },
    ]),
  ).toMatchObject([{ scope: { characters: 5, pages: { read: 1, total: 2 } } }]);
  expect(
    readChatSteer({ messageId: "m", jobId: "j", status: "pending" }),
  ).toMatchObject({ messageId: "m", jobId: "j" });
});
