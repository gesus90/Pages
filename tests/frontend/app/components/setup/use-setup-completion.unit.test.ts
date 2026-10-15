import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useSetupCompletion } from "@/app/components/setup/use-setup-completion";

import type { SetupActionData } from "@/app/lib/setup/setup-action-data";

const fetcher = vi.hoisted(() => ({
  data: undefined as SetupActionData | undefined,
  state: "idle",
  submit: vi.fn(),
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
beforeEach(() => {
  fetcher.data = undefined;
  fetcher.state = "idle";
  fetcher.submit.mockReset();
});

it("submits the in-memory draft and exposes pending state", () => {
  const handlers = { onFieldErrors: vi.fn(), onRejected: vi.fn() };
  const { result, rerender } = renderHook(() => useSetupCompletion(handlers));
  const values = {
    companyName: "Pages",
    username: "admin",
    password: "synthetic-password",
    email: "",
    databasePath: "/pages.duckdb",
  };
  act(() => result.current.finish("synthetic-token", values));
  expect(fetcher.submit).toHaveBeenCalledExactlyOnceWith(
    { ...values, intent: "complete", token: "synthetic-token" },
    { action: "/setup", method: "post" },
  );
  expect(result.current.isFinishing).toBe(false);
  fetcher.state = "submitting";
  rerender();
  expect(result.current.isFinishing).toBe(true);
});

it("delivers server field errors once and exposes a refused location", () => {
  const handlers = { onFieldErrors: vi.fn(), onRejected: vi.fn() };
  const { result, rerender } = renderHook(() => useSetupCompletion(handlers));
  fetcher.data = {
    intent: "complete",
    error: "invalidInput",
    fieldErrors: { username: "usernameTaken" },
  };
  rerender();
  rerender();
  expect(handlers.onFieldErrors).toHaveBeenCalledExactlyOnceWith({
    username: "usernameTaken",
  });
  fetcher.data = {
    intent: "complete",
    error: "databaseLocation",
    location: { input: "/pages.duckdb", status: "foreign" },
  };
  rerender();
  expect(result.current.refusedLocation).toEqual({
    input: "/pages.duckdb",
    status: "foreign",
  });
  expect(result.current.error).toBeNull();
  expect(handlers.onRejected).not.toHaveBeenCalled();
});

it.each(["network", "failed", "invalidToken", "alreadyCompleted"] as const)(
  "handles completion refusal %s",
  (error) => {
    const handlers = { onFieldErrors: vi.fn(), onRejected: vi.fn() };
    const { result, rerender } = renderHook(() => useSetupCompletion(handlers));
    fetcher.data = { intent: "complete", error };
    rerender();
    if (error === "network" || error === "failed") {
      expect(result.current.error).toBe(error);
      expect(handlers.onRejected).not.toHaveBeenCalled();
    } else {
      expect(handlers.onRejected).toHaveBeenCalledExactlyOnceWith(error);
      expect(result.current.error).toBeNull();
    }
  },
);
