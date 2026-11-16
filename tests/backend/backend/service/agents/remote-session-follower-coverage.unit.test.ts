import { afterEach, expect, it, vi } from "vitest";

import { followRemoteSession } from "@/backend/service/agents/sessions/RemoteSessionFollower";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type {
  AgentSessionEvent,
  AgentSessionEventPage,
} from "@/definition/AgentSessionJournal";

afterEach(() => vi.useRealTimers());

it("drains pages in order and polls from the last observed sequence", async () => {
  vi.useFakeTimers();
  const first = partial<AgentSessionEvent>({ sequence: 2, text: "first" });
  const second = partial<AgentSessionEvent>({ sequence: 3, text: "second" });
  const read = vi
    .fn<(after: number) => Promise<AgentSessionEventPage>>()
    .mockResolvedValueOnce(partial({ events: [first], hasMore: true }))
    .mockResolvedValueOnce(partial({ events: [second], hasMore: false }))
    .mockResolvedValue(partial({ events: [], hasMore: false }));
  const listener = vi.fn();
  const close = await followRemoteSession(read, 1, listener);
  expect(read.mock.calls).toEqual([[1], [2]]);
  expect(listener.mock.calls).toEqual([[first], [second]]);
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenLastCalledWith(3);
  close();
  await vi.advanceTimersByTimeAsync(2000);
  expect(read).toHaveBeenCalledTimes(3);
});

it("does not deliver a read that completes after closure", async () => {
  vi.useFakeTimers();
  let finish: (page: AgentSessionEventPage) => void = () => {};
  const read = vi
    .fn<(after: number) => Promise<AgentSessionEventPage>>()
    .mockResolvedValueOnce(partial({ events: [], hasMore: false }))
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
  const listener = vi.fn();
  const close = await followRemoteSession(read, 0, listener);
  await vi.advanceTimersByTimeAsync(2000);
  close();
  finish(
    partial({
      events: [partial<AgentSessionEvent>({ sequence: 1 })],
      hasMore: false,
    }),
  );
  await vi.runAllTicks();
  expect(listener).not.toHaveBeenCalled();
});
