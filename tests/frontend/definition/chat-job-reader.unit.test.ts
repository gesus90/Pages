import { describe, expect, it } from "vitest";

import {
  readChatJob,
  readChatJobEvent,
  readChatJobUpdate,
  readChatJobUsage,
  readChatSelectionItems,
  readChatSessionState,
  readChatSteer,
} from "@/definition/ChatJobReader";

const EMPTY_USAGE = { context: null, tokens: null, cost: null };

const JOB = {
  id: "job-1",
  sessionId: "session-1",
  state: "completed",
  errorCode: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  endedAt: "2026-11-01T10:01:00.000Z",
  usage: EMPTY_USAGE,
};

describe("reading the consumption of a job", () => {
  it("keeps missing values as null and never as zero", () => {
    expect(readChatJobUsage({})).toEqual(EMPTY_USAGE);
    expect(
      readChatJobUsage({ context: null, tokens: null, cost: null }),
    ).toEqual(EMPTY_USAGE);
  });

  it("reads context, tokens and a cost without flag as not estimated", () => {
    expect(
      readChatJobUsage({
        context: { used: 10, size: 200 },
        tokens: { input: 1, output: 2, total: 3, isPartial: true },
        cost: { amount: 0.25, currency: "USD" },
      }),
    ).toEqual({
      context: { used: 10, size: 200 },
      tokens: { input: 1, output: 2, total: 3, isPartial: true },
      cost: { amount: 0.25, currency: "USD", isEstimated: false },
    });
  });

  it("keeps the estimate flag and the session scope of a cost", () => {
    expect(
      readChatJobUsage({
        cost: {
          amount: 1,
          currency: "EUR",
          isEstimated: true,
          scope: "session",
        },
      }).cost,
    ).toEqual({
      amount: 1,
      currency: "EUR",
      isEstimated: true,
      scope: "session",
    });
    expect(
      readChatJobUsage({
        cost: { amount: 1, currency: "EUR", scope: "job" },
      }).cost,
    ).toEqual({ amount: 1, currency: "EUR", isEstimated: false });
  });

  it.each([
    { label: "usage that is no object", usage: "none" },
    { label: "usage that is an array", usage: [] },
    {
      label: "context with a negative size",
      usage: { context: { used: 1, size: -1 } },
    },
    {
      label: "context with a fractional use",
      usage: { context: { used: 1.5, size: 2 } },
    },
    { label: "context that is a text", usage: { context: "x" } },
    {
      label: "tokens without the partial flag",
      usage: { tokens: { input: 1, output: 1, total: 2 } },
    },
    {
      label: "tokens with a text count",
      usage: { tokens: { input: "1", output: 1, total: 2, isPartial: false } },
    },
    {
      label: "a non finite cost",
      usage: { cost: { amount: Infinity, currency: "USD" } },
    },
    {
      label: "a cost amount as text",
      usage: { cost: { amount: "1", currency: "USD" } },
    },
    {
      label: "a cost estimate flag as text",
      usage: { cost: { amount: 1, currency: "USD", isEstimated: "yes" } },
    },
    { label: "a cost without currency", usage: { cost: { amount: 1 } } },
  ])("refuses $label", ({ usage }) => {
    expect(() => readChatJobUsage(usage)).toThrow(
      new TypeError("Invalid chat job data"),
    );
  });
});

describe("reading the progress entries of a journal", () => {
  it("reads a phase", () => {
    expect(readChatJobEvent({ kind: "phase", phase: "running" })).toEqual({
      kind: "phase",
      phase: "running",
    });
    expect(() => readChatJobEvent({ kind: "phase", phase: "idle" })).toThrow(
      TypeError,
    );
  });

  it("reads a turn with or without its start time", () => {
    expect(
      readChatJobEvent({
        kind: "turn",
        turn: 2,
        origin: "followUp",
        startedAt: "2026-11-01T10:00:00.000Z",
      }),
    ).toEqual({
      kind: "turn",
      turn: 2,
      origin: "followUp",
      startedAt: "2026-11-01T10:00:00.000Z",
    });
    expect(
      readChatJobEvent({
        kind: "turn",
        turn: 1,
        origin: "message",
        startedAt: 5,
      }),
    ).toEqual({ kind: "turn", turn: 1, origin: "message" });
    expect(() =>
      readChatJobEvent({ kind: "turn", turn: 1, origin: "other" }),
    ).toThrow(TypeError);
  });

  it("reads a text delta and needs the reset flag", () => {
    expect(
      readChatJobEvent({ kind: "text", turn: 1, isReset: false, delta: "Hi" }),
    ).toEqual({ kind: "text", turn: 1, isReset: false, delta: "Hi" });
    expect(() =>
      readChatJobEvent({ kind: "text", turn: 1, delta: "Hi" }),
    ).toThrow(TypeError);
    expect(() =>
      readChatJobEvent({ kind: "text", turn: 1, isReset: true, delta: 3 }),
    ).toThrow(TypeError);
  });

  it("reads a tool call, its error and its privilege mark", () => {
    expect(
      readChatJobEvent({
        kind: "tool",
        callId: "c1",
        tool: "search",
        status: "failed",
        error: "boom",
        isPrivileged: true,
      }),
    ).toEqual({
      kind: "tool",
      callId: "c1",
      tool: "search",
      status: "failed",
      error: "boom",
      isPrivileged: true,
    });
    expect(
      readChatJobEvent({
        kind: "tool",
        callId: "c1",
        tool: "search",
        status: "running",
        isPrivileged: "yes",
      }),
    ).toEqual({
      kind: "tool",
      callId: "c1",
      tool: "search",
      status: "running",
      error: null,
    });
    expect(() =>
      readChatJobEvent({
        kind: "tool",
        callId: "c1",
        tool: "t",
        status: "queued",
      }),
    ).toThrow(TypeError);
  });
});

describe("reading the outcome entries of a journal", () => {
  it("reads a steer with a known status only", () => {
    expect(
      readChatJobEvent({ kind: "steer", messageId: "m", status: "followUp" }),
    ).toEqual({ kind: "steer", messageId: "m", status: "followUp" });
    expect(() =>
      readChatJobEvent({ kind: "steer", messageId: "m", status: "lost" }),
    ).toThrow(TypeError);
  });

  it("reads an answer", () => {
    expect(
      readChatJobEvent({ kind: "answer", turn: 3, messageId: "m" }),
    ).toEqual({ kind: "answer", turn: 3, messageId: "m" });
  });

  it("reads a usage entry through the usage reader", () => {
    expect(
      readChatJobEvent({
        kind: "usage",
        usage: { context: { used: 1, size: 2 } },
      }),
    ).toEqual({
      kind: "usage",
      usage: { context: { used: 1, size: 2 }, tokens: null, cost: null },
    });
  });

  it("reads a compaction with known and unknown token counts", () => {
    expect(
      readChatJobEvent({
        kind: "compaction",
        status: "completed",
        tokensBefore: 900,
        tokensAfter: 100,
      }),
    ).toEqual({
      kind: "compaction",
      status: "completed",
      tokensBefore: 900,
      tokensAfter: 100,
    });
    expect(readChatJobEvent({ kind: "compaction", status: "running" })).toEqual(
      {
        kind: "compaction",
        status: "running",
        tokensBefore: null,
        tokensAfter: null,
      },
    );
    expect(() =>
      readChatJobEvent({
        kind: "compaction",
        status: "running",
        tokensBefore: -1,
      }),
    ).toThrow(TypeError);
  });

  it("reads session and capability flags and refuses non-boolean ones", () => {
    expect(readChatJobEvent({ kind: "session", isResumed: true })).toEqual({
      kind: "session",
      isResumed: true,
    });
    expect(readChatJobEvent({ kind: "capabilities", canSteer: false })).toEqual(
      {
        kind: "capabilities",
        canSteer: false,
      },
    );
    expect(() => readChatJobEvent({ kind: "session", isResumed: 1 })).toThrow(
      TypeError,
    );
    expect(() => readChatJobEvent({ kind: "capabilities" })).toThrow(TypeError);
  });

  it("reads the end of a job with or without an error code", () => {
    expect(
      readChatJobEvent({
        kind: "end",
        state: "interrupted",
        errorCode: "gone",
      }),
    ).toEqual({ kind: "end", state: "interrupted", errorCode: "gone" });
    expect(readChatJobEvent({ kind: "end", state: "stopped" })).toEqual({
      kind: "end",
      state: "stopped",
      errorCode: null,
    });
    expect(() => readChatJobEvent({ kind: "end", state: "running" })).toThrow(
      TypeError,
    );
  });

  it.each([
    { label: "an unknown kind", value: { kind: "mystery" } },
    { label: "a missing kind", value: {} },
    { label: "null", value: null },
    { label: "a list", value: [] },
    { label: "a text", value: "end" },
  ])("refuses $label", ({ value }) => {
    expect(() => readChatJobEvent(value)).toThrow(
      new TypeError("Invalid chat job data"),
    );
  });
});

describe("reading a job and the state of a conversation", () => {
  it("reads a job without its journal", () => {
    expect(readChatJob(JOB)).toEqual(JOB);
    expect(
      readChatJob({
        ...JOB,
        state: "failed",
        errorCode: "x",
        endedAt: undefined,
      }).endedAt,
    ).toBeNull();
  });

  it("refuses a job with an unknown state or a missing identifier", () => {
    expect(() => readChatJob({ ...JOB, state: "paused" })).toThrow(TypeError);
    expect(() => readChatJob({ ...JOB, id: undefined })).toThrow(TypeError);
  });

  it("reads the state of a conversation with and without a job", () => {
    expect(
      readChatSessionState({
        sessionId: "s",
        lastMessageAt: "2026-11-01T10:00:00.000Z",
        jobId: "j",
        jobState: "running",
      }),
    ).toEqual({
      sessionId: "s",
      lastMessageAt: "2026-11-01T10:00:00.000Z",
      jobId: "j",
      jobState: "running",
    });
    expect(
      readChatSessionState({
        sessionId: "s",
        lastMessageAt: "t",
        jobState: null,
      }),
    ).toEqual({
      sessionId: "s",
      lastMessageAt: "t",
      jobId: null,
      jobState: null,
    });
    expect(() =>
      readChatSessionState({
        sessionId: "s",
        lastMessageAt: "t",
        jobId: null,
        jobState: "paused",
      }),
    ).toThrow(TypeError);
  });
});

describe("reading a journal page", () => {
  it("reads the job, the numbered entries, the cursor and the continuation flag", () => {
    expect(
      readChatJobUpdate({
        job: JOB,
        events: [
          { sequence: 1, event: { kind: "phase", phase: "starting" } },
          { sequence: 2, event: { kind: "end", state: "completed" } },
        ],
        cursor: 2,
        hasMore: false,
      }),
    ).toEqual({
      job: JOB,
      events: [
        { sequence: 1, event: { kind: "phase", phase: "starting" } },
        {
          sequence: 2,
          event: { kind: "end", state: "completed", errorCode: null },
        },
      ],
      cursor: 2,
      hasMore: false,
    });
  });

  it.each([
    { label: "no continuation flag", patch: { hasMore: undefined } },
    { label: "events that are no list", patch: { events: {} } },
    {
      label: "an entry without a sequence",
      patch: { events: [{ event: { kind: "end", state: "failed" } }] },
    },
    {
      label: "an entry with an unknown event",
      patch: { events: [{ sequence: 1, event: { kind: "x" } }] },
    },
    { label: "a negative cursor", patch: { cursor: -1 } },
  ])("refuses $label", ({ patch }) => {
    expect(() =>
      readChatJobUpdate({
        job: JOB,
        events: [],
        cursor: 0,
        hasMore: false,
        ...patch,
      }),
    ).toThrow(TypeError);
  });
});

describe("reading the attachments of a selection snapshot", () => {
  const item = {
    attachmentId: "a1",
    fileName: "notes.pdf",
    contentType: "application/pdf",
    size: 2048,
    transfer: "truncated",
  };

  it("reads an item of a snapshot made before page scopes existed", () => {
    expect(readChatSelectionItems([item])).toEqual([item]);
  });

  it("reads the characters and pages that reached the agent", () => {
    expect(
      readChatSelectionItems([
        { ...item, scope: { characters: 500 } },
        { ...item, scope: { characters: 900, pages: { read: 2, total: 9 } } },
      ]).map((entry) => entry.scope),
    ).toEqual([
      { characters: 500 },
      { characters: 900, pages: { read: 2, total: 9 } },
    ]);
  });

  it("refuses an unknown transfer, a broken scope and a snapshot that is no list", () => {
    expect(() =>
      readChatSelectionItems([{ ...item, transfer: "lost" }]),
    ).toThrow(TypeError);
    expect(() =>
      readChatSelectionItems([{ ...item, scope: { characters: -1 } }]),
    ).toThrow(TypeError);
    expect(() =>
      readChatSelectionItems([
        { ...item, scope: { characters: 1, pages: { read: 1 } } },
      ]),
    ).toThrow(TypeError);
    expect(() => readChatSelectionItems({})).toThrow(TypeError);
    expect(readChatSelectionItems([])).toEqual([]);
  });
});

describe("reading a stored steer message", () => {
  it("reads identifiers and a known status", () => {
    expect(
      readChatSteer({ messageId: "m", jobId: "j", status: "delivered" }),
    ).toEqual({ messageId: "m", jobId: "j", status: "delivered" });
  });

  it("refuses an unknown status or a missing job", () => {
    expect(() =>
      readChatSteer({ messageId: "m", jobId: "j", status: "gone" }),
    ).toThrow(TypeError);
    expect(() => readChatSteer({ messageId: "m", status: "failed" })).toThrow(
      TypeError,
    );
  });
});
