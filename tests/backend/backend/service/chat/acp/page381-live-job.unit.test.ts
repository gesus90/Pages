import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PicaAcpJournal } from "@/backend/service/chat/acp/PicaAcpJournal";
import { PicaAcpSteering } from "@/backend/service/chat/acp/PicaAcpSteering";
import { PicaAcpUpdates } from "@/backend/service/chat/acp/PicaAcpUpdates";

import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import type { ChatJobEvent } from "@/definition/ChatJob";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("tells the live answer every journal entry in its order, text after complete words", async () => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const observed: ChatJobEvent[] = [];
  const journal = new PicaAcpJournal({ append }, "job", (event) =>
    observed.push(event),
  );
  journal.text(1, false, "Hallo Wel");
  await vi.advanceTimersByTimeAsync(400);
  journal.note({
    kind: "tool",
    callId: "c1",
    tool: "Read",
    status: "running",
    error: null,
  });
  journal.text(1, true, "Antwort");
  await journal.record({ kind: "answer", turn: 1, messageId: "m1" });
  await journal.drain();
  // An unfinished word waits for the next text, as the stored journal keeps it.
  expect(observed).toEqual([
    { kind: "text", turn: 1, isReset: false, delta: "Hallo " },
    expect.objectContaining({ kind: "tool", callId: "c1" }),
    { kind: "text", turn: 1, isReset: false, delta: "Wel" },
    { kind: "text", turn: 1, isReset: true, delta: "Antwort" },
    { kind: "answer", turn: 1, messageId: "m1" },
  ]);
  // The stored journal is the same as before.
  expect(append.mock.calls.map(([, , event]) => event)).toEqual(observed);
});

it("keeps the journal going when the live answer fails", async () => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job", () => {
    throw new Error("live view gone");
  });
  await journal.record({ kind: "phase", phase: "starting" });
  expect(append).toHaveBeenCalledOnce();
});

it("passes the thoughts of the model on, and nothing for a model without them", () => {
  const thought = vi.fn();
  const text = vi.fn();
  const updates = new PicaAcpUpdates(
    {
      text,
      thought,
      context: vi.fn(),
      compaction: vi.fn(),
      promptEnded: vi.fn(),
      threadStatus: vi.fn(),
      closed: vi.fn(),
    },
    { isCostEstimated: false },
  );
  updates.update({
    sessionUpdate: "agent_thought_chunk",
    content: { type: "text", text: "Ich überlege" },
  });
  updates.update({
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text: "Antwort" },
  });
  expect(thought).toHaveBeenCalledExactlyOnceWith(1, "Ich überlege");
  expect(text).toHaveBeenCalledWith(1, false, "Antwort");
});

it("queues a message sent after the answer for a turn of its own instead of steering it in", async () => {
  const status = vi.fn(async () => undefined);
  const deliver = vi.fn(async () => "injected" as const);
  const steering = new PicaAcpSteering({
    gate: (task) => task(),
    status,
    isTurnRunning: () => true,
    deliver,
  });
  await steering.accept({ id: "later", text: "Danach", attachments: [] }, true);
  await steering.accept({ id: "now", text: "Umlenken", attachments: [] });
  await steering.settle();
  expect(deliver).toHaveBeenCalledOnce();
  expect(deliver).toHaveBeenCalledWith(expect.objectContaining({ id: "now" }));
  expect(status).toHaveBeenCalledWith("later", "followUp");
  expect(status).toHaveBeenCalledWith("now", "accepted");
  await expect(steering.next()).resolves.toMatchObject({
    origin: "pages",
    message: { id: "later" },
  });
});
