import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useDatabasePathCheck } from "@/app/components/setup/use-database-path-check";

import type { SetupActionData } from "@/app/lib/setup/setup-action-data";

const fetcher = vi.hoisted(() => ({
  data: undefined as SetupActionData | undefined,
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));

beforeEach(() => {
  fetcher.data = undefined;
  fetcher.submit.mockReset();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

it("does not check a blank path", () => {
  const { result } = renderHook(() =>
    useDatabasePathCheck("test-token", "  ", vi.fn()),
  );
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(result.current).toEqual({
    hasFailed: false,
    isChecking: false,
    status: "empty",
  });
  expect(fetcher.submit).not.toHaveBeenCalled();
});

it("debounces typing and cancels the check on unmount", () => {
  const rejected = vi.fn();
  const { result, rerender, unmount } = renderHook(
    ({ path, token }) => useDatabasePathCheck(token, path, rejected),
    { initialProps: { path: "/old.duckdb", token: "test-token" } },
  );
  expect(result.current.isChecking).toBe(true);
  act(() => {
    vi.advanceTimersByTime(399);
  });
  expect(fetcher.submit).not.toHaveBeenCalled();
  rerender({ path: "/new.duckdb", token: "new-test-token" });
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(fetcher.submit).toHaveBeenCalledExactlyOnceWith(
    {
      databasePath: "/new.duckdb",
      intent: "check-database-path",
      token: "new-test-token",
    },
    { action: "/setup", method: "post" },
  );
  rerender({ path: "/cancelled.duckdb", token: "new-test-token" });
  unmount();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(fetcher.submit).toHaveBeenCalledTimes(1);
});

it("never presents a stale answer as the status of the current path", () => {
  const { result, rerender } = renderHook(
    (path) => useDatabasePathCheck("test-token", path, vi.fn()),
    { initialProps: "/current.duckdb" },
  );
  fetcher.data = {
    intent: "check-database-path",
    location: { input: "/old.duckdb", status: "available" },
  };
  rerender("/current.duckdb");
  expect(result.current.status).toBeNull();
  expect(result.current.isChecking).toBe(true);
  fetcher.data = {
    intent: "check-database-path",
    location: { input: "/current.duckdb", status: "foreign" },
  };
  rerender("/current.duckdb");
  expect(result.current).toEqual({
    status: "foreign",
    isChecking: false,
    hasFailed: false,
  });
});

it("reports a network failure and delivers each new rejection once", () => {
  const rejected = vi.fn();
  const { result, rerender } = renderHook(() =>
    useDatabasePathCheck("test-token", "/pages.duckdb", rejected),
  );
  fetcher.data = { intent: "check-database-path", error: "network" };
  rerender();
  expect(result.current).toEqual({
    status: null,
    hasFailed: true,
    isChecking: false,
  });
  expect(rejected).not.toHaveBeenCalled();
  fetcher.data = { intent: "check-database-path", error: "invalidToken" };
  rerender();
  rerender();
  expect(rejected).toHaveBeenCalledExactlyOnceWith("invalidToken");
  fetcher.data = { intent: "check-database-path", error: "alreadyCompleted" };
  rerender();
  expect(rejected).toHaveBeenLastCalledWith("alreadyCompleted");
});
