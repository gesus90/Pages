import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSessionStream } from "@/app/components/agents/plans/plan-agent-console/session-stream";

import {
  SessionEventSource,
  historyEvent,
} from "../../page161-session-fixture";

import type { RenderHookResult } from "@testing-library/react";
import type { SessionConnection } from "@/app/components/agents/plans/plan-agent-console/session-stream";
import type { AgentSessionEvent } from "@/definition/AgentSessionJournal";

const ADDRESS = "/session/events?planId=plan";

interface StreamProbe {
  readonly cursor: { current: number };
  readonly onEvent: ReturnType<
    typeof vi.fn<(event: AgentSessionEvent) => void>
  >;
  readonly onGap: ReturnType<typeof vi.fn<(retainedFrom: number) => void>>;
  readonly onError: ReturnType<typeof vi.fn<(error: string) => void>>;
}

beforeEach(() => {
  SessionEventSource.instances.length = 0;
  vi.stubGlobal("EventSource", SessionEventSource);
});

afterEach(() => {
  vi.useRealTimers();
});

function probe(cursor = 3): StreamProbe {
  return {
    cursor: { current: cursor },
    onEvent: vi.fn<(event: AgentSessionEvent) => void>(),
    onGap: vi.fn<(retainedFrom: number) => void>(),
    onError: vi.fn<(error: string) => void>(),
  };
}

function renderStream(
  callbacks: StreamProbe,
  isLive = true,
): RenderHookResult<SessionConnection, { isLive: boolean }> {
  return renderHook(
    (props: { isLive: boolean }) =>
      useSessionStream({ address: ADDRESS, ...callbacks, ...props }),
    { initialProps: { isLive } },
  );
}

function latestSource(): SessionEventSource {
  const source = SessionEventSource.instances.at(-1);
  if (!source) throw new Error("Stream not opened");
  return source;
}

function emit(
  source: SessionEventSource,
  type: string,
  payload: unknown,
): void {
  act(() => {
    source.dispatchEvent(
      new MessageEvent(type, {
        data: typeof payload === "string" ? payload : JSON.stringify(payload),
      }),
    );
  });
}

it("stays closed without opening a stream while the session is not live", () => {
  const { result } = renderStream(probe(), false);
  expect(result.current).toBe("closed");
  expect(SessionEventSource.instances).toHaveLength(0);
});

it("opens after the cursor, goes live and closes the stream when it stops being live", () => {
  const { result, rerender } = renderStream(probe(7));
  const source = latestSource();
  expect(source.url).toBe(`${ADDRESS}&after=7`);
  expect(result.current).toBe("connecting");
  act(() => source.onopen?.());
  expect(result.current).toBe("live");
  rerender({ isLive: false });
  expect(result.current).toBe("closed");
  expect(source.readyState).toBe(SessionEventSource.CLOSED);
});

it("delivers the next event in sequence, skips known ones and closes on a gap", () => {
  const callbacks = probe(3);
  const { result } = renderStream(callbacks);
  const source = latestSource();
  act(() => source.send(2));
  act(() => source.send(3));
  expect(callbacks.onEvent).not.toHaveBeenCalled();
  act(() => source.send(4));
  expect(callbacks.onEvent).toHaveBeenCalledWith(historyEvent(4));
  expect(callbacks.cursor.current).toBe(4);
  act(() => source.send(6));
  expect(callbacks.onEvent).toHaveBeenCalledTimes(1);
  expect(callbacks.onError).toHaveBeenCalledWith("plan_history_corrupt");
  expect(source.readyState).toBe(SessionEventSource.CLOSED);
  expect(result.current).toBe("closed");
});

it("closes on an event that is not a valid journal record", () => {
  const callbacks = probe(0);
  const { result } = renderStream(callbacks);
  emit(latestSource(), "session", "{broken");
  expect(callbacks.onError).toHaveBeenCalledWith("plan_history_corrupt");
  expect(result.current).toBe("closed");
});

it("moves the cursor to a valid retention marker and refuses malformed ones", () => {
  const callbacks = probe(2);
  const { result } = renderStream(callbacks);
  const source = latestSource();
  emit(source, "history-gap", { retainedFrom: 40 });
  expect(callbacks.onGap).toHaveBeenCalledWith(40);
  expect(callbacks.cursor.current).toBe(39);
  for (const marker of [
    5,
    null,
    {},
    { retainedFrom: "40" },
    { retainedFrom: 1.5 },
    "{broken",
  ])
    emit(source, "history-gap", marker);
  expect(callbacks.onGap).toHaveBeenCalledTimes(1);
  expect(callbacks.onError).toHaveBeenCalledTimes(6);
  expect(callbacks.onError).toHaveBeenLastCalledWith("plan_history_corrupt");
  expect(callbacks.cursor.current).toBe(39);
  expect(result.current).toBe("connecting");
});

it("closes on a history error with a known code, or the matching fallback", () => {
  const callbacks = probe();
  const { result } = renderStream(callbacks);
  const source = latestSource();
  emit(source, "history-error", { error: "plan_access_denied" });
  expect(result.current).toBe("closed");
  expect(source.readyState).toBe(SessionEventSource.CLOSED);
  for (const marker of [
    { error: "plan_invalid" },
    "7",
    null,
    {},
    { error: 7 },
    { error: "unknown_code" },
    "{broken",
  ])
    emit(source, "history-error", marker);
  expect(callbacks.onError.mock.calls.map((call) => call[0])).toEqual([
    "plan_access_denied",
    "plan_invalid",
    "plan_history_unavailable",
    "plan_history_unavailable",
    "plan_history_unavailable",
    "plan_history_unavailable",
    "plan_history_unavailable",
    "plan_history_corrupt",
  ]);
});

it("reconnects once, five seconds after the browser gave up the stream", () => {
  vi.useFakeTimers();
  const callbacks = probe(9);
  const { result } = renderStream(callbacks);
  const source = latestSource();
  act(() => source.onerror?.());
  expect(result.current).toBe("reconnecting");
  act(() => {
    vi.advanceTimersByTime(10_000);
  });
  expect(SessionEventSource.instances).toHaveLength(1);
  source.close();
  act(() => source.onerror?.());
  act(() => source.onerror?.());
  act(() => {
    vi.advanceTimersByTime(4_999);
  });
  expect(SessionEventSource.instances).toHaveLength(1);
  callbacks.cursor.current = 12;
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(SessionEventSource.instances).toHaveLength(2);
  expect(latestSource().url).toBe(`${ADDRESS}&after=12`);
  expect(vi.getTimerCount()).toBe(0);
});

it("cancels a pending reconnect when the console closes", () => {
  vi.useFakeTimers();
  const { unmount } = renderStream(probe());
  const source = latestSource();
  source.close();
  act(() => source.onerror?.());
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(5_000);
  expect(SessionEventSource.instances).toHaveLength(1);
});

it("uses the latest callbacks without reopening the stream", () => {
  const first = probe(0);
  const { rerender } = renderHook(
    (props: { callbacks: StreamProbe }) =>
      useSessionStream({
        address: ADDRESS,
        isLive: true,
        ...props.callbacks,
        cursor: first.cursor,
      }),
    { initialProps: { callbacks: first } },
  );
  const second = probe(0);
  rerender({ callbacks: second });
  act(() => latestSource().send(1));
  expect(SessionEventSource.instances).toHaveLength(1);
  expect(first.onEvent).not.toHaveBeenCalled();
  expect(second.onEvent).toHaveBeenCalledWith(historyEvent(1));
});
