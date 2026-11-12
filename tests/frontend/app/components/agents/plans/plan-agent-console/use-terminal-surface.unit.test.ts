import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useNow } from "@/app/components/agents/plans/plan-agent-console/use-terminal-surface";

afterEach(() => vi.useRealTimers());

it("updates the clock while ticking and stops the timer when disabled", () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  const { result, rerender, unmount } = renderHook(
    ({ ticking }) => useNow(ticking),
    { initialProps: { ticking: false } },
  );
  expect(result.current).toBe(1_000);
  act(() => {
    vi.advanceTimersByTime(2_000);
  });
  expect(result.current).toBe(1_000);
  rerender({ ticking: true });
  expect(result.current).toBe(3_000);
  act(() => {
    vi.advanceTimersByTime(1_000);
  });
  expect(result.current).toBe(4_000);
  rerender({ ticking: false });
  expect(vi.getTimerCount()).toBe(0);
  unmount();
});
