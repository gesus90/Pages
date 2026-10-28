import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAgentSession } from "@/app/components/agents/plans/plan-agent-console/use-agent-session";

import {
  SESSION_VIEW,
  SessionEventSource,
  historyEvent,
} from "../../page161-session-fixture";

import type { AgentSessionEventPage } from "@/definition/AgentSessionJournal";

type FetchStub = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

const OTHER_KEY = { ...SESSION_VIEW.key, attemptId: "attempt-other" };

beforeEach(() => {
  SessionEventSource.instances.length = 0;
  vi.stubGlobal("EventSource", SessionEventSource);
});

afterEach(() => {
  vi.useRealTimers();
});

function answer(
  sequences: readonly number[],
  page: Partial<AgentSessionEventPage> = {},
): Response {
  return Response.json({
    ok: true,
    view: SESSION_VIEW,
    page: {
      events: sequences.map(historyEvent),
      cursor: sequences.at(-1) ?? null,
      hasMore: false,
      retainedFrom: null,
      source: "journal",
      ...page,
    },
  });
}

function stubFetch(first: Response): ReturnType<typeof vi.fn<FetchStub>> {
  const fetchStub = vi.fn<FetchStub>(async () => first);
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

function latestSource(): SessionEventSource {
  const source = SessionEventSource.instances.at(-1);
  if (!source) throw new Error("Stream not opened");
  return source;
}

it("loads an empty session, follows it live and refreshes local facts after activity", async () => {
  const fetchStub = stubFetch(answer([]));
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, { isLive: true, status: "running" }),
  );
  expect(result.current.connection).toBe("loading");
  expect(result.current.isHistoryLoading).toBe(true);
  expect(result.current.downloadAddress).toBe(
    "/agent-api/plan-runs/run-page161/steps/node/session/download?planId=plan-page161&attemptId=attempt-page161",
  );
  await waitFor(() => expect(result.current.view).toEqual(SESSION_VIEW));
  expect(result.current.hasEarlier).toBe(false);
  expect(result.current.isHistoryLoading).toBe(false);
  expect(result.current.connection).toBe("connecting");
  const source = latestSource();
  expect(source.url).toContain("/session/events?");
  expect(source.url).toContain("&after=0");
  act(() => source.onopen?.());
  expect(result.current.connection).toBe("live");
  vi.useFakeTimers();
  act(() => source.send(1));
  expect(result.current.events.map((event) => event.sequence)).toEqual([1]);
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
  vi.useRealTimers();
  await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(2));
  act(() => {
    source.dispatchEvent(
      new MessageEvent("history-gap", {
        data: JSON.stringify({ retainedFrom: 2 }),
      }),
    );
  });
  expect(result.current.retainedFrom).toBe(2);
});

it("does not refresh remote sessions after activity", async () => {
  const fetchStub = stubFetch(answer([1]));
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, {
      isLive: true,
      status: "running",
      isRemote: true,
    }),
  );
  await waitFor(() => expect(result.current.events).toHaveLength(1));
  vi.useFakeTimers();
  act(() => latestSource().send(2));
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
  expect(vi.getTimerCount()).toBe(0);
  expect(fetchStub).toHaveBeenCalledOnce();
  expect(result.current.events).toHaveLength(2);
});

it("keeps the reader's window while not following, through live events and refreshes", async () => {
  const fetchStub = stubFetch(answer([1, 2], { hasEarlier: true }));
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, { isLive: true, status: "running" }),
  );
  await waitFor(() => expect(result.current.events).toHaveLength(2));
  expect(result.current.hasEarlier).toBe(true);
  act(() => result.current.stopFollowing());
  expect(result.current.isFollowing).toBe(false);
  act(() => latestSource().send(3));
  fetchStub.mockImplementation(async () =>
    answer([1, 2, 3, 4], { source: "legacy_record", retainedFrom: 1 }),
  );
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.source).toBe("legacy_record"));
  expect(result.current.retainedFrom).toBe(1);
  expect(result.current.hasEarlier).toBe(false);
  expect(result.current.events.map((event) => event.sequence)).toEqual([1, 2]);
});

it("reads the tail again when older history is requested before any event exists", async () => {
  const fetchStub = stubFetch(answer([]));
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, { isLive: false, status: "completed" }),
  );
  await waitFor(() => expect(result.current.view).not.toBeNull());
  expect(result.current.connection).toBe("closed");
  act(() => result.current.loadEarlier());
  await waitFor(() => expect(fetchStub).toHaveBeenCalledTimes(2));
  expect(String(fetchStub.mock.calls[1]?.[0])).toContain("tail=1");
  expect(result.current.isFollowing).toBe(false);
});

it("shows a failed first read as an error instead of loading", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchStub>(async () => {
      throw new TypeError("network");
    }),
  );
  const { result } = renderHook(() =>
    useAgentSession(SESSION_VIEW.key, { isLive: true, status: "running" }),
  );
  await waitFor(() => expect(result.current.error).toBe("offline"));
  expect(result.current.view).toBeNull();
  expect(result.current.connection).toBe("closed");
  expect(SessionEventSource.instances).toHaveLength(0);
});

it("ignores a read that answers after the console switched to another session", async () => {
  const pending: ((response: Response) => void)[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<FetchStub>(
      () =>
        new Promise<Response>((resolve) => {
          pending.push(resolve);
        }),
    ),
  );
  const { result, rerender } = renderHook(
    (props: { key: typeof OTHER_KEY }) =>
      useAgentSession(props.key, { isLive: false, status: "completed" }),
    { initialProps: { key: SESSION_VIEW.key } },
  );
  rerender({ key: OTHER_KEY });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => {
    pending[1]?.(answer([7]));
    await Promise.resolve();
  });
  await waitFor(() => expect(result.current.events).toHaveLength(1));
  await act(async () => {
    pending[0]?.(answer([1, 2, 3]));
    await Promise.resolve();
  });
  expect(result.current.events.map((event) => event.sequence)).toEqual([7]);
});
