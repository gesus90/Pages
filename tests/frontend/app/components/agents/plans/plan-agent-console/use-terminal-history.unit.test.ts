import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { readSessionPage } from "@/app/components/agents/plans/plan-agent-console/session-client";
import { useTerminalHistory } from "@/app/components/agents/plans/plan-agent-console/use-terminal-history";

import { historyEvent, SESSION_VIEW } from "../../page161-session-fixture";

import type { AgentSessionReadResult } from "@/app/lib/agent-session-response";

vi.mock(
  "@/app/components/agents/plans/plan-agent-console/session-client",
  () => ({ readSessionPage: vi.fn() }),
);

function page(
  sequences: readonly number[],
  hasEarlier: boolean,
): AgentSessionReadResult {
  return {
    ok: true,
    view: SESSION_VIEW,
    page: {
      events: sequences.map(historyEvent),
      cursor: null,
      hasMore: false,
      retainedFrom: null,
      source: "journal",
      hasEarlier,
    },
  };
}

beforeEach(() => {
  vi.mocked(readSessionPage).mockReset();
});

it("loads older pages by cursor, merges overlapping events and stops at the beginning", async () => {
  vi.mocked(readSessionPage)
    .mockResolvedValueOnce(page([4, 5], true))
    .mockResolvedValueOnce(page([2, 4], false));
  const { result } = renderHook(() =>
    useTerminalHistory(SESSION_VIEW.key, {
      firstSequence: 6,
      hasEarlier: true,
      earlier: [],
    }),
  );
  act(() => {
    result.current.loadOlder();
    result.current.loadOlder();
  });
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(readSessionPage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(readSessionPage).mock.calls[0]?.[3]).toEqual({ before: 6 });
  expect(result.current.older.map((event) => event.sequence)).toEqual([4, 5]);
  act(() => result.current.loadOlder());
  await waitFor(() => expect(result.current.hasOlder).toBe(false));
  expect(vi.mocked(readSessionPage).mock.calls[1]?.[3]).toEqual({ before: 4 });
  expect(result.current.older.map((event) => event.sequence)).toEqual([
    2, 4, 5,
  ]);
  act(() => result.current.loadOlder());
  expect(readSessionPage).toHaveBeenCalledTimes(2);
});

it("keeps a failed page retryable and requests a tail without a cursor", async () => {
  vi.mocked(readSessionPage)
    .mockResolvedValueOnce({ ok: false, error: "offline" })
    .mockResolvedValueOnce(page([], false));
  const { result } = renderHook(() =>
    useTerminalHistory(SESSION_VIEW.key, {
      firstSequence: null,
      hasEarlier: false,
      earlier: [],
    }),
  );
  act(() => result.current.loadOlder());
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.hasOlder).toBe(true);
  expect(vi.mocked(readSessionPage).mock.calls[0]?.[3]).toEqual({ tail: true });
  act(() => result.current.loadOlder());
  await waitFor(() => expect(result.current.hasOlder).toBe(false));
});

it("loads earlier attempt tails and then pages their remaining history", async () => {
  vi.mocked(readSessionPage)
    .mockResolvedValueOnce(page([7, 8], true))
    .mockResolvedValueOnce(page([3], false));
  const earlier = [
    {
      attemptId: "earlier",
      number: 1,
      endedAt: "2026-10-26T00:00:00Z",
      ending: { kind: "stopped" as const },
    },
  ];
  const { result } = renderHook(() =>
    useTerminalHistory(SESSION_VIEW.key, {
      firstSequence: 1,
      hasEarlier: false,
      earlier,
    }),
  );
  await waitFor(() =>
    expect(
      result.current.earlier.get("earlier")?.map((event) => event.sequence),
    ).toEqual([7, 8]),
  );
  expect(vi.mocked(readSessionPage).mock.calls[0]?.[3]).toEqual({ tail: true });
  act(() => result.current.loadOlder());
  await waitFor(() => expect(result.current.hasOlder).toBe(false));
  expect(vi.mocked(readSessionPage).mock.calls[1]?.[3]).toEqual({ before: 7 });
  expect(
    result.current.earlier.get("earlier")?.map((event) => event.sequence),
  ).toEqual([3, 7, 8]);
});
