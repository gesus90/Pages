import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useSessionRefresh } from "@/app/components/agents/plans/plan-agent-console/use-session-refresh";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

it("refreshes once, 1.5 seconds after the first of several activities, with the latest callback", () => {
  const first = vi.fn<() => void>();
  const latest = vi.fn<() => void>();
  const { result, rerender } = renderHook(
    (props: { refresh: () => void }) => useSessionRefresh(true, props.refresh),
    { initialProps: { refresh: first } },
  );
  result.current();
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  result.current();
  rerender({ refresh: latest });
  act(() => {
    vi.advanceTimersByTime(499);
  });
  expect(latest).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(first).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledOnce();
  result.current();
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
  expect(latest).toHaveBeenCalledTimes(2);
});

it("never refreshes while disabled", () => {
  const refresh = vi.fn<() => void>();
  const { result } = renderHook(() => useSessionRefresh(false, refresh));
  result.current();
  act(() => {
    vi.advanceTimersByTime(5_000);
  });
  expect(refresh).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("drops a pending refresh when unmounted", () => {
  const refresh = vi.fn<() => void>();
  const { result, unmount } = renderHook(() =>
    useSessionRefresh(true, refresh),
  );
  result.current();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1_500);
  expect(refresh).not.toHaveBeenCalled();
});

it("unmounts cleanly without a pending refresh", () => {
  const refresh = vi.fn<() => void>();
  const { unmount } = renderHook(() => useSessionRefresh(true, refresh));
  unmount();
  vi.advanceTimersByTime(1_500);
  expect(refresh).not.toHaveBeenCalled();
});
