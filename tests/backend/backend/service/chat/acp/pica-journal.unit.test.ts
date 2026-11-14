import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PicaAcpJournal } from "@/backend/service/chat/acp/PicaAcpJournal";

import type { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

it("streams complete words while retaining unfinished text until the next update or drain", async () => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job");
  journal.text(1, false, "Hello wor");
  await vi.advanceTimersByTimeAsync(400);
  expect(append.mock.calls.map(([, , event]) => event)).toEqual([
    { kind: "text", turn: 1, isReset: false, delta: "Hello " },
  ]);
  journal.text(1, false, "ld");
  await journal.drain();
  expect(append.mock.calls.map(([, , event]) => event)).toEqual([
    { kind: "text", turn: 1, isReset: false, delta: "Hello " },
    { kind: "text", turn: 1, isReset: false, delta: "world" },
  ]);
});

it("keeps reset semantics when a reset is flushed in multiple batches", async () => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job");
  journal.text(1, false, "old");
  journal.text(1, true, "New ans");
  await vi.advanceTimersByTimeAsync(400);
  journal.text(1, false, "wer");
  await journal.drain();
  expect(append.mock.calls.map(([, , event]) => event)).toEqual([
    { kind: "text", turn: 1, isReset: false, delta: "old" },
    { kind: "text", turn: 1, isReset: true, delta: "New " },
    { kind: "text", turn: 1, isReset: false, delta: "answer" },
  ]);
});

it("finishes the retained text of a turn before accepting the next turn", async () => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job");
  journal.text(1, false, "first");
  await vi.advanceTimersByTimeAsync(400);
  expect(append).not.toHaveBeenCalled();
  journal.text(2, false, "second");
  await journal.drain();
  await journal.drain();
  expect(append.mock.calls.map(([, , event]) => event)).toEqual([
    { kind: "text", turn: 1, isReset: false, delta: "first" },
    { kind: "text", turn: 2, isReset: false, delta: "second" },
  ]);
});

it("preserves an empty reset and whitespace without inventing later text events", async () => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job");
  journal.text(1, true, "");
  await journal.drain();
  journal.text(1, false, " \n");
  await vi.advanceTimersByTimeAsync(400);
  await journal.drain();
  expect(append.mock.calls.map(([, , event]) => event)).toEqual([
    { kind: "text", turn: 1, isReset: true, delta: "" },
    { kind: "text", turn: 1, isReset: false, delta: " \n" },
  ]);
});

it.each([
  { kind: "end", state: "completed", errorCode: null },
  { kind: "turn", turn: 2, origin: "followUp" },
] as const)("finishes retained text before a $kind marker", async (event) => {
  const append = vi.fn<ChatJobRepository["append"]>(async () => undefined);
  const journal = new PicaAcpJournal({ append }, "job");
  journal.text(1, false, "last");
  await vi.advanceTimersByTimeAsync(400);
  await journal.record(event);
  await journal.drain();
  expect(append.mock.calls.map(([, , stored]) => stored)).toEqual([
    { kind: "text", turn: 1, isReset: false, delta: "last" },
    event,
  ]);
});
