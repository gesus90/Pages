import { expect, it, vi } from "vitest";

import {
  readSessionCursor,
  readSessionHistoryWindow,
} from "@/app/lib/agent-session-request.server";
import {
  appendSessionHistoryChunks,
  readSessionHistoryChunks,
} from "@/backend/database/repositories/agent/AgentSessionHistoryChunks";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  sessionHistoryDownload,
  sessionHistoryStream,
} from "@/backend/service/agents/sessions/SessionHistoryStream";
import { applyRunnerMessage } from "@/backend/service/runner/RunnerProtocol";
import { runnerMessageSchema } from "@/definition/RunnerProtocol";

import { HistoryDatabase } from "./page161-history-database";

import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";
import type {
  RunnerJob,
  RunnerMessage,
  RunnerState,
} from "@/definition/RunnerProtocol";

function event(
  sequence: number,
  attemptId = "attempt-page161",
): AgentSessionEvent {
  return {
    id: `${attemptId}:${sequence}`,
    attemptId,
    stepId: "node",
    turn: 1,
    sequence,
    kind: "tool_completed",
    channel: sequence % 2 ? "stdout" : "stderr",
    text: `${sequence} 🙂 ${"x".repeat(3980)}`,
    createdAt: "2026-10-26T00:00:00.000Z",
    isTruncated: false,
  };
}

it("rotates the public journal at 4 MiB and reads bounded older and newer windows after a restart", async () => {
  const database = new HistoryDatabase();
  const events = Array.from({ length: 1100 }, (_, index) => event(index + 1));
  await appendSessionHistoryChunks(
    database,
    { attemptId: "attempt-page161", launchId: "launch-page161" },
    events,
  );
  expect(database.chunks.size).toBe(2);
  expect(
    [...database.chunks.values()].every(
      (chunk) => Number(chunk.byte_length) <= 4194304,
    ),
  ).toBe(true);
  const tail = await readSessionHistoryChunks(database, "attempt-page161", {
    after: 0,
    tail: true,
    limit: 150,
  });
  expect(tail?.events.map((entry) => entry.sequence)).toEqual(
    Array.from({ length: 150 }, (_, index) => 951 + index),
  );
  expect(tail).toMatchObject({
    hasEarlier: true,
    hasMore: false,
    retainedFrom: null,
    cursor: 1100,
  });
  const earlier = await readSessionHistoryChunks(database, "attempt-page161", {
    after: 0,
    before: 951,
    limit: 150,
  });
  expect(earlier?.events[0]?.sequence).toBe(801);
  const forward = await readSessionHistoryChunks(database, "attempt-page161", {
    after: 950,
    limit: 150,
  });
  expect(forward?.events).toEqual(tail?.events);
  await expect(
    readSessionHistoryChunks(database, "attempt-page161", {
      after: 1200,
      limit: 10,
    }),
  ).rejects.toMatchObject({ code: "plan_invalid" });
  expect(
    await readSessionHistoryChunks(database, "foreign", {
      after: 0,
      limit: 10,
    }),
  ).toBeNull();
  await expect(
    appendSessionHistoryChunks(
      database,
      { attemptId: "attempt-page161", launchId: "foreign" },
      [event(1101)],
    ),
  ).rejects.toThrow("launch changed");
  await expect(
    appendSessionHistoryChunks(
      database,
      { attemptId: "attempt-page161", launchId: "launch-page161" },
      [event(1100)],
    ),
  ).rejects.toThrow("out of sequence");
  const second = database.chunks.get("attempt-page161:2");
  if (!second) throw new Error("Expected two chunks");
  database.chunks.set("attempt-page161:2", {
    ...second,
    events_jsonl: `${String(second.events_jsonl)}damage`,
  });
  await expect(
    readSessionHistoryChunks(database, "attempt-page161", {
      after: 1000,
      limit: 5,
    }),
  ).rejects.toMatchObject({ code: "plan_history_corrupt" });
});

it("reports missing chunks and storage failures and keeps legacy retention visible", async () => {
  const database = new HistoryDatabase();
  await appendSessionHistoryChunks(
    database,
    { attemptId: "attempt-page161", launchId: "launch" },
    Array.from({ length: 1100 }, (_, index) => event(index + 8)),
  );
  expect(
    (
      await readSessionHistoryChunks(database, "attempt-page161", {
        after: 0,
        limit: 2,
      })
    )?.retainedFrom,
  ).toBe(8);
  database.chunks.delete("attempt-page161:1");
  await expect(
    readSessionHistoryChunks(database, "attempt-page161", {
      after: 0,
      tail: true,
      limit: 2,
    }),
  ).rejects.toMatchObject({ code: "plan_history_corrupt" });
  database.failure = "ENOSPC";
  await expect(
    appendSessionHistoryChunks(
      database,
      { attemptId: "other", launchId: "launch" },
      [event(1, "other")],
    ),
  ).rejects.toThrow("ENOSPC");
});

it.each(["-1", "1.1", "NaN", "Infinity", "9007199254740992", "", " 1"])(
  "rejects malformed cursor %s",
  (input) => {
    expect(() => readSessionCursor(input)).toThrow(AgentError);
  },
);

it("exports incrementally and rechecks rights on each page without holding the full history", async () => {
  let calls = 0;
  const read = vi.fn(async (after: number) => {
    calls += 1;
    if (calls > 2) throw new AgentError("plan_access_denied");
    return {
      events: [event(after + 1)],
      cursor: after + 1,
      hasMore: true,
      retainedFrom: null,
      source: "journal" as const,
    };
  });
  const stream = sessionHistoryDownload({
    signal: new AbortController().signal,
    lastSequence: 10,
    read,
  });
  const reader = stream.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "[1 ",
  );
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "[2 ",
  );
  await expect(reader.read()).rejects.toMatchObject({
    code: "plan_history_unavailable",
  });
  expect(read.mock.calls.map(([after]) => after)).toEqual([0, 1, 2]);
});

it("applies SSE backpressure and makes a read failure visible instead of claiming complete history", async () => {
  const read = vi.fn(async () => {
    throw new AgentError("plan_history_corrupt");
  });
  const stream = sessionHistoryStream({
    signal: new AbortController().signal,
    after: 20,
    read,
  });
  const reader = stream.getReader();
  expect(read).not.toHaveBeenCalled();
  await reader.read();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "history-error",
  );
  expect(await reader.read()).toEqual({ done: true, value: undefined });
  expect(read).toHaveBeenCalledTimes(1);
});

const JOB: RunnerJob = {
  jobId: "10000000-0000-4000-8000-000000000001",
  sessionId: "10000000-0000-4000-8000-000000000002",
  status: "running",
  liveHistoryVersion: 1,
  outputJournalVersion: 2,
  historyCursor: 2500,
};

function packet(
  job: RunnerJob,
  sequence: number,
): Extract<RunnerMessage, { type: "event" }> {
  return {
    type: "event",
    version: 1,
    sessionId: job.sessionId,
    eventId: "10000000-0000-4000-8000-000000000003",
    sequence,
    delta: true,
    job,
    history: [
      {
        sequence: job.historyCursor ?? 0,
        kind: "status",
        text: "checkpoint",
        createdAt: "2026-10-26T00:00:00.000Z",
        isTruncated: false,
      },
    ],
  };
}

it("replays a lost ACK idempotently and rejects duplicate, missing, reordered or foreign history", () => {
  const state: RunnerState = {
    version: 1,
    sessionId: JOB.sessionId,
    sequence: 4,
    lastEventId: null,
    jobs: [JOB],
  };
  const message = runnerMessageSchema.parse(
    packet({ ...JOB, historyCursor: 2501 }, 5),
  );
  if (message.type !== "event") throw new Error("Expected event fixture");
  const accepted = applyRunnerMessage(
    state,
    runnerMessageSchema.parse(message),
  );
  expect(accepted.state.jobs[0]?.historyCursor).toBe(2501);
  expect(applyRunnerMessage(accepted.state, message).state).toBe(
    accepted.state,
  );
  for (const badSequence of [2500, 2502, 1]) {
    const bad = packet({ ...JOB, historyCursor: badSequence }, 5);
    expect(() => applyRunnerMessage(state, bad)).toThrow();
  }
  expect(() =>
    applyRunnerMessage(state, { ...message, sessionId: "foreign" }),
  ).toThrow("session mismatch");
  expect(() =>
    applyRunnerMessage(accepted.state, { ...message, history: [] }),
  ).toThrow("reconciliation");
  const terminal = {
    ...JOB,
    status: "completed" as const,
    historyLength: 3000,
  };
  const terminalState = { ...state, jobs: [terminal] };
  const historyOnly = packet({ ...terminal, historyCursor: 2501 }, 5);
  expect(
    applyRunnerMessage(terminalState, historyOnly).state.jobs[0]?.status,
  ).toBe("completed");
  expect(() =>
    applyRunnerMessage(terminalState, {
      ...historyOnly,
      result: { output: "second result", closeout: "confirmed" },
    }),
  ).toThrow("transition");
});

it.each([
  "before=0",
  "tail=unknown",
  "before=3&after=2",
  "before=3&tail=1",
  "after=2&tail=1",
])("rejects conflicting history selectors %s", (query) => {
  expect(() =>
    readSessionHistoryWindow(new URLSearchParams(query), 150),
  ).toThrow(AgentError);
});

it("refuses an old runner while a new chunk journal is outstanding without restarting or losing its claim", () => {
  const state: RunnerState = {
    version: 1,
    sessionId: JOB.sessionId,
    sequence: 4,
    lastEventId: null,
    jobs: [JOB],
  };
  const reconcile: RunnerMessage = {
    version: 1,
    type: "reconcile",
    sessionId: JOB.sessionId,
    sequence: 4,
    jobs: [JOB],
  };
  expect(() => applyRunnerMessage(state, reconcile)).toThrow(
    "Runner update required",
  );
  const capable = applyRunnerMessage(state, {
    ...reconcile,
    outputJournalVersion: 2,
  });
  expect(capable.state.jobs).toEqual([JOB]);
  expect(capable.reply.type).toBe("reconcile");
});
