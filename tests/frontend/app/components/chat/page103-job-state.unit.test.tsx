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
