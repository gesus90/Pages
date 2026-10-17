import { expect, it } from "vitest";

import {
  AgentSessionJournal,
  MAXIMUM_EVENT_TEXT,
  MAXIMUM_PAGE,
  RETAINED_EVENTS,
} from "@/backend/service/agents/sessions/AgentSessionJournal";
import { UNKNOWN_CONTEXT } from "@/backend/service/agents/sessions/AgentSessionUsage";

import { MemorySessionStore } from "./page85-session-fixture";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

async function journalWorld(): Promise<{
  readonly store: MemorySessionStore;
  readonly journal: AgentSessionJournal;
}> {
  const store = new MemorySessionStore();
  await store.saveAttempt({
    key: {
      planId: "plan-1",
      runId: "run-1",
      stepId: "step-a",
      attemptId: "attempt-1",
    },
    userId: "executor",
    provider: "claude_code",
    instanceId: "instance-1",
    groupId: null,
    state: "running",
    context: UNKNOWN_CONTEXT,
    confirmedModel: { value: null, source: null, reportedAt: null },
    confirmedReasoning: { value: null, source: null, reportedAt: null },
    workspace: null,
    updatedAt: "2026-10-17T01:00:00.000Z",
  });
  return {
    store,
    journal: new AgentSessionJournal(store, {
      redact: (text) => text.replaceAll("project-secret", "[project]"),
    }),
  };
}

it("numbers events in call order with stable identifiers and drops repeated facts", async () => {
  const { journal } = await journalWorld();
  const first = journal.append("attempt-1", [
    { turn: 1, kind: "user_instruction", text: "Prüfe den Build" },
  ]);
  const second = journal.append("attempt-1", [
    {
      turn: 1,
      kind: "tool_started",
      text: "execute pnpm build",
      dedupeKey: "t1",
    },
    {
      turn: 1,
      kind: "tool_started",
      text: "execute pnpm build",
      dedupeKey: "t1",
    },
    {
      turn: 1,
      kind: "tool_failed",
      text: "pnpm build",
      dedupeKey: "t1:failed",
    },
  ]);
  await Promise.all([first, second]);
  const page = await journal.page("attempt-1", 0, 50);
  expect(
    page.events.map((event) => [event.sequence, event.id, event.kind]),
  ).toEqual([
    [1, "attempt-1:1", "user_instruction"],
    [2, "attempt-1:2", "tool_started"],
    [3, "attempt-1:3", "tool_failed"],
  ]);
  expect(page.events.every((event) => event.stepId === "step-a")).toBe(true);
  expect(page).toMatchObject({ cursor: 3, hasMore: false, source: "journal" });
});

it("redacts before it shortens and marks a cut text", async () => {
  const { journal } = await journalWorld();
  const [secret, long] = await journal.append("attempt-1", [
    {
      turn: 1,
      kind: "agent_message",
      text: "token sk-abcdefghijklmnopqrstuvwx and project-secret",
    },
    {
      turn: 1,
      kind: "agent_message",
      text: "x".repeat(MAXIMUM_EVENT_TEXT + 10),
    },
  ]);
  expect(secret?.text).toBe("token [redacted] and [project]");
  expect(secret?.isTruncated).toBe(false);
  expect(long?.text).toHaveLength(MAXIMUM_EVENT_TEXT);
  expect(long?.isTruncated).toBe(true);
});

it("pages with a cursor, bounds the page size and keeps retention visible", async () => {
  const { journal } = await journalWorld();
  await journal.append(
    "attempt-1",
    Array.from({ length: RETAINED_EVENTS + 5 }, (_, index) => ({
      turn: 1,
      kind: "status" as const,
      text: `event ${index + 1}`,
    })),
  );
  const first = await journal.page("attempt-1", 0, 10_000);
  expect(first.events).toHaveLength(MAXIMUM_PAGE);
  expect(first.retainedFrom).toBe(6);
  expect(first.events[0]?.text).toBe("event 6");
  expect(first.hasMore).toBe(true);
  const next = await journal.page("attempt-1", first.cursor ?? 0, 2);
  expect(next.events.map((event) => event.sequence)).toEqual([
    MAXIMUM_PAGE + 6,
    MAXIMUM_PAGE + 7,
  ]);
  const end = await journal.page("attempt-1", RETAINED_EVENTS + 5, 10);
  expect(end).toMatchObject({ events: [], cursor: RETAINED_EVENTS + 5 });
});

it("follows stored and live events in order without duplicates across a reconnect", async () => {
  const { journal } = await journalWorld();
  await journal.append("attempt-1", [
    { turn: 1, kind: "status", text: "one" },
    { turn: 1, kind: "status", text: "two" },
  ]);
  const received: AgentSessionEvent[] = [];
  // An event that arrives while the stored ones are read is delivered once, after them.
  const following = journal.follow("attempt-1", 0, (event) =>
    received.push(event),
  );
  const during = journal.append("attempt-1", [
    { turn: 1, kind: "status", text: "three" },
  ]);
  const stop = await following;
  await during;
  await journal.append("attempt-1", [
    { turn: 2, kind: "status", text: "four" },
  ]);
  stop();
  await journal.append("attempt-1", [
    { turn: 2, kind: "status", text: "five" },
  ]);
  expect(received.map((event) => event.text)).toEqual([
    "one",
    "two",
    "three",
    "four",
  ]);
  // The reader reconnects with its last cursor and gets exactly what it missed.
  const resumed: AgentSessionEvent[] = [];
  const again = await journal.follow(
    "attempt-1",
    received.at(-1)?.sequence ?? 0,
    (event) => resumed.push(event),
  );
  again();
  expect(resumed.map((event) => event.text)).toEqual(["five"]);
});

it("reads the history after a restart from storage alone", async () => {
  const { store, journal } = await journalWorld();
  await journal.append("attempt-1", [
    { turn: 1, kind: "status", text: "kept" },
  ]);
  // A new journal over the same storage stands for a restarted server.
  const restarted = new AgentSessionJournal(store);
  const page = await restarted.page("attempt-1", 0, 10);
  expect(page.events.map((event) => event.text)).toEqual(["kept"]);
});
