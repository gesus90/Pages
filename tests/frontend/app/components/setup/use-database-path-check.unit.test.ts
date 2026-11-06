import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useDatabaseUrlCheck } from "@/app/components/setup/use-database-path-check";

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

it("does not check a blank connection", () => {
  const { result } = renderHook(() =>
    useDatabaseUrlCheck("test-token", "  ", vi.fn()),
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
    ({ path, token }) => useDatabaseUrlCheck(token, path, rejected),
    {
      initialProps: { path: "postgresql://localhost/old", token: "test-token" },
    },
  );
  expect(result.current.isChecking).toBe(true);
  act(() => {
    vi.advanceTimersByTime(399);
  });
  expect(fetcher.submit).not.toHaveBeenCalled();
  rerender({ path: "postgresql://localhost/new", token: "new-test-token" });
  act(() => {
    vi.advanceTimersByTime(400);
  });
  expect(fetcher.submit).toHaveBeenCalledExactlyOnceWith(
    {
      databaseUrl: "postgresql://localhost/new",
      requestId: "1",
      intent: "check-database-connection",
      token: "new-test-token",
    },
    { action: "/setup", method: "post" },
  );
  rerender({
    path: "postgresql://localhost/cancelled",
    token: "new-test-token",
  });
  unmount();
  act(() => {
    vi.advanceTimersByTime(1000);
  });
  expect(fetcher.submit).toHaveBeenCalledTimes(1);
});

it("never presents a stale answer as the status of the current connection", () => {
  const { result, rerender } = renderHook(
    (path) => useDatabaseUrlCheck("test-token", path, vi.fn()),
    { initialProps: "postgresql://localhost/current" },
  );
  act(() => {
    vi.advanceTimersByTime(400);
  });
  fetcher.data = {
    intent: "check-database-connection",
    location: { input: "0", status: "available" },
  };
  rerender("postgresql://localhost/current");
  expect(result.current.status).toBeNull();
  expect(result.current.isChecking).toBe(true);
  fetcher.data = {
    intent: "check-database-connection",
    location: { input: "1", status: "foreign" },
  };
  rerender("postgresql://localhost/current");
  expect(result.current).toEqual({
    status: "foreign",
    isChecking: false,
    hasFailed: false,
  });
});

it("reports a network failure and delivers each new rejection once", () => {
  const rejected = vi.fn();
  const { result, rerender } = renderHook(() =>
    useDatabaseUrlCheck("test-token", "postgresql://localhost/pages", rejected),
  );
  fetcher.data = { intent: "check-database-connection", error: "network" };
  rerender();
  expect(result.current).toEqual({
    status: null,
    hasFailed: true,
    isChecking: false,
  });
  expect(rejected).not.toHaveBeenCalled();
  fetcher.data = { intent: "check-database-connection", error: "invalidToken" };
  rerender();
  rerender();
  expect(rejected).toHaveBeenCalledExactlyOnceWith("invalidToken");
  fetcher.data = {
    intent: "check-database-connection",
    error: "alreadyCompleted",
  };
  rerender();
  expect(rejected).toHaveBeenLastCalledWith("alreadyCompleted");
});
