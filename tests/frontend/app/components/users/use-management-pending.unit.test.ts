import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useManagementPending } from "@/app/components/users/use-management-pending";

const navigation = vi.hoisted(() => ({ state: "idle" }));
vi.mock("react-router", () => ({ useNavigation: () => navigation }));
beforeEach(() => {
  navigation.state = "idle";
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("delays loading feedback by 200 ms and removes it immediately on idle", () => {
  const { result, rerender } = renderHook(useManagementPending);
  expect(result.current).toBe(false);
  navigation.state = "loading";
  rerender();
  act(() => {
    vi.advanceTimersByTime(199);
  });
  expect(result.current).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(result.current).toBe(true);
  navigation.state = "idle";
  rerender();
  expect(result.current).toBe(false);
});

it("never flashes for a quick load and cancels timers after unmount", () => {
  const { result, rerender, unmount } = renderHook(useManagementPending);
  navigation.state = "loading";
  rerender();
  act(() => {
    vi.advanceTimersByTime(100);
  });
  navigation.state = "idle";
  rerender();
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(result.current).toBe(false);
  navigation.state = "submitting";
  rerender();
  act(() => {
    vi.advanceTimersByTime(500);
  });
  expect(result.current).toBe(false);
  navigation.state = "loading";
  rerender();
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
