import { expect, it } from "vitest";

import {
  readChatJobResult,
  readChatSendResult,
} from "@/app/lib/chat-job-client";

const JOB = {
  id: "job-1",
  sessionId: "aa-bb-cc-dd-ee",
  state: "running",
  errorCode: null,
  createdAt: "2026-10-28 00:00:00",
  endedAt: null,
  usage: { context: null, tokens: null, cost: null },
};

const MESSAGE = {
  role: "user",
  content: "Hello",
  createdAt: "2026-10-28 00:00:00",
  attachments: [],
};

it("reads a started job with the message it answers", () => {
  expect(
    readChatSendResult({ job: { job: JOB, messageId: "message-1" } }),
  ).toEqual({
    kind: "job",
    job: {
      messageId: "message-1",
      job: { ...JOB, usage: { context: null, tokens: null, cost: null } },
    },
  });
});

it("refuses a job start without the message identifier", () => {
  expect(() => readChatSendResult({ job: { job: JOB } })).toThrow(
    "Invalid job start",
  );
  expect(() => readChatSendResult({ job: "started" })).toThrow(
    "Invalid job start",
  );
});

it("reads a steer that joined a running job", () => {
  const steer = { messageId: "message-2", jobId: "job-1", status: "pending" };

  expect(readChatSendResult({ steer })).toEqual({ kind: "steer", steer });
});

it("reads a direct reply when neither a job nor a steer was started", () => {
  const reply = {
    session: {
      id: "aa-bb-cc-dd-ee",
      createdAt: "2026-10-28 00:00:00",
      lastMessageAt: "2026-10-28 00:00:01",
      preview: "Hello",
    },
    question: { ...MESSAGE, id: "question" },
    answer: { ...MESSAGE, id: "answer", role: "assistant" },
  };

  expect(readChatSendResult({ reply })).toEqual({ kind: "reply", reply });
});

it("reads a job update and no update for a conversation without a job", () => {
  const update = { job: JOB, events: [], cursor: 0, hasMore: false };

  expect(readChatJobResult({ update })).toEqual(update);
  expect(readChatJobResult({ update: null })).toBeNull();
  expect(readChatJobResult({})).toBeNull();
});
