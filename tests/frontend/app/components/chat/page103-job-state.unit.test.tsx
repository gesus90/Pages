import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import {
  applyChatJobUpdate,
  isChatJobRunning,
  startChatLiveJob,
} from "@/app/components/chat/chat-job-state";
import { useChatJob } from "@/app/components/chat/use-chat-job";
import { chatApi } from "@/app/lib/chat-client";

import { FIRST_SESSION } from "./chat-fixture";

import type { ChatJob } from "@/definition/ChatJob";
import type { ChatView } from "@/app/components/chat/use-chat-uploads";

vi.mock("@/app/lib/chat-client", () => ({
  chatApi: vi.fn(),
  chatErrorCode: () => "general",
}));

const JOB: ChatJob = {
  id: "12345678-1234-4234-8234-123456789abc",
  sessionId: FIRST_SESSION,
  state: "running",
  createdAt: "2026-10-18T10:00:00Z",
  endedAt: null,
  errorCode: null,
  usage: { context: null, tokens: null, cost: null },
};
const VIEW: ChatView = {
  session: {
    id: FIRST_SESSION,
    createdAt: JOB.createdAt,
    lastMessageAt: JOB.createdAt,
    preview: "",
  },
  messages: [],
  pending: [],
  activity: { job: JOB, steers: [], selections: [] },
};

afterEach(() => vi.useRealTimers());

it("keeps the server start and journal cursor over panel closure, reopening and session refresh", async () => {
  vi.useFakeTimers();
  vi.mocked(chatApi).mockResolvedValue({
    update: {
      job: JOB,
      events: [
        {
          sequence: 1,
          event: { kind: "text", turn: 1, isReset: true, delta: "Partial" },
        },
      ],
      cursor: 1,
      hasMore: false,
    },
  });
  const reload = vi.fn(async () => undefined);
  const setError = vi.fn();
  const { result, rerender } = renderHook(
    ({ isOpen, view }) => useChatJob({ isOpen, view, reload, setError }),
    { initialProps: { isOpen: true, view: VIEW } },
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(result.current.live?.cursor).toBe(1);
  expect(result.current.live?.text).toBe("Partial");
  rerender({ isOpen: false, view: VIEW });
  const reads = vi.mocked(chatApi).mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(9000);
  });
  expect(chatApi).toHaveBeenCalledTimes(reads);
  vi.mocked(chatApi).mockResolvedValue({
    update: { job: JOB, events: [], cursor: 1, hasMore: false },
  });
  rerender({ isOpen: true, view: { ...VIEW, messages: [] } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(800);
  });
  expect(chatApi).toHaveBeenLastCalledWith({
    intent: "job",
    sessionId: FIRST_SESSION,
    jobId: JOB.id,
    after: 1,
  });
  expect(result.current.live?.job.createdAt).toBe(JOB.createdAt);
  expect(result.current.live?.text).toBe("Partial");
  expect(result.current.isRunning).toBe(true);
});

it.each(["failed", "stopped", "interrupted"] as const)(
  "retains unsaved text on %s and asks to reload the stored conversation",
  (state) => {
    const initial = {
      ...startChatLiveJob(JOB),
      text: "Retained partial",
      textTurn: 1,
    };
    const applied = applyChatJobUpdate(initial, {
      job: { ...JOB, state },
      events: [{ sequence: 1, event: { kind: "end", state, errorCode: null } }],
      cursor: 1,
      hasMore: false,
    });
    expect(applied.live.text).toBe("Retained partial");
    expect(isChatJobRunning(applied.live)).toBe(false);
    expect(applied.needsReload).toBe(true);
  },
);

it("replaces a persisted partial with its stored message and does not erase a newer turn", () => {
  const live = { ...startChatLiveJob(JOB), text: "First answer", textTurn: 1 };
  const update = {
    job: JOB,
    events: [
      {
        sequence: 1,
        event: { kind: "answer" as const, turn: 1, messageId: "answer" },
      },
    ],
    cursor: 1,
    hasMore: false,
  };
  expect(applyChatJobUpdate(live, update).live.text).toBe("");
  expect(
    applyChatJobUpdate({ ...live, text: "Next partial", textTurn: 2 }, update)
      .live.text,
  ).toBe("Next partial");
});

it("applies journal events in order and retains the latest tool and session facts", () => {
  const applied = applyChatJobUpdate(startChatLiveJob(JOB), {
    job: JOB,
    events: [
      { sequence: 1, event: { kind: "phase", phase: "running" } },
      {
        sequence: 2,
        event: { kind: "text", turn: 1, isReset: true, delta: "Hello" },
      },
      {
        sequence: 3,
        event: { kind: "text", turn: 1, isReset: false, delta: " world" },
      },
      {
        sequence: 4,
        event: {
          kind: "tool",
          callId: "a",
          tool: "search",
          status: "running",
          error: null,
        },
      },
      {
        sequence: 5,
        event: {
          kind: "tool",
          callId: "a",
          tool: "search",
          status: "completed",
          error: null,
        },
      },
      {
        sequence: 6,
        event: { kind: "steer", messageId: "m", status: "accepted" },
      },
      { sequence: 7, event: { kind: "session", isResumed: true } },
      { sequence: 8, event: { kind: "capabilities", canSteer: true } },
      {
        sequence: 9,
        event: {
          kind: "usage",
          usage: { context: { used: 4, size: 10 }, tokens: null, cost: null },
        },
      },
      {
        sequence: 10,
        event: {
          kind: "compaction",
          status: "completed",
          tokensBefore: 9,
          tokensAfter: 4,
        },
      },
    ],
    cursor: 10,
    hasMore: true,
  });
  expect(applied.isStale).toBe(false);
  expect(applied.needsReload).toBe(false);
  expect(applied.live).toMatchObject({
    cursor: 10,
    hasRead: true,
    hasMore: true,
    phase: "running",
    text: "Hello world",
    steers: { m: "accepted" },
    isResumed: true,
    canSteer: true,
    usage: { context: { used: 4, size: 10 } },
    compaction: { status: "completed" },
    tools: [{ callId: "a", status: "completed" }],
  });
});

it("starts a follow-up turn with fresh text and clears previous tools", () => {
  const live = {
    ...startChatLiveJob(JOB),
    cursor: 10,
    text: "Hello world",
    textTurn: 1,
    tools: [
      {
        kind: "tool" as const,
        callId: "a",
        tool: "search",
        status: "completed" as const,
        error: null,
      },
    ],
  };
  const next = applyChatJobUpdate(live, {
    job: JOB,
    events: [
      {
        sequence: 11,
        event: {
          kind: "turn",
          turn: 2,
          origin: "followUp",
          startedAt: "later",
        },
      },
      {
        sequence: 12,
        event: { kind: "text", turn: 2, isReset: false, delta: "Next" },
      },
    ],
    cursor: 12,
    hasMore: false,
  });
  expect(next.live).toMatchObject({
    text: "Next",
    textTurn: 2,
    tools: [],
    turnStartedAt: "later",
  });
});

it("restarts stale journal reads and requests a reload for a different job", () => {
  const live = { ...startChatLiveJob(JOB), cursor: 3, text: "old" };
  const event = {
    sequence: 2,
    event: { kind: "phase" as const, phase: "running" as const },
  };
  const stale = applyChatJobUpdate(live, {
    job: JOB,
    events: [event],
    cursor: 2,
    hasMore: false,
  });
  expect(stale).toMatchObject({
    isStale: true,
    needsReload: false,
    live: { cursor: 0, text: "" },
  });
  const other = applyChatJobUpdate(live, {
    job: { ...JOB, id: "other" },
    events: [],
    cursor: 0,
    hasMore: false,
  });
  expect(other).toMatchObject({
    isStale: true,
    needsReload: true,
    live: { job: { id: "other" } },
  });
  expect(isChatJobRunning(null)).toBe(false);
});
