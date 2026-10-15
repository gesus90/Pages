import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { useSetupAccess } from "@/app/components/setup/use-setup-access";

import type { SetupActionData } from "@/app/lib/setup/setup-action-data";

const fetcher = vi.hoisted(() => ({
  data: undefined as SetupActionData | undefined,
}));
vi.mock("react-router", () => ({ useFetcher: () => fetcher }));
beforeEach(() => {
  fetcher.data = undefined;
});

const initialAccess = {
  token: "synthetic-link-token",
  suggestedDatabasePath: "/pages.duckdb",
};

it.each([false, true])(
  "shows the token form without initial access (rejected: %s)",
  (hasRejectedToken) => {
    const { result } = renderHook(() => useSetupAccess(null, hasRejectedToken));
    expect(result.current.access).toBeNull();
    expect(result.current.notice).toBe(hasRejectedToken ? "invalid" : null);
  },
);

it("revokes an expired token and accepts a newly verified token", () => {
  const { result, rerender } = renderHook(() =>
    useSetupAccess(initialAccess, false),
  );
  expect(result.current.access).toEqual(initialAccess);
  act(() => result.current.revoke(initialAccess.token));
  expect(result.current.access).toBeNull();
  expect(result.current.notice).toBe("expired");
  fetcher.data = {
    intent: "verify-token",
    access: { ...initialAccess, token: "synthetic-replacement-token" },
  };
  rerender();
  expect(result.current.access?.token).toBe("synthetic-replacement-token");
});

it.each(["network", "invalidToken", "failed"] as const)(
  "shows the %s refusal",
  (error) => {
    const { result, rerender } = renderHook(() => useSetupAccess(null, false));
    fetcher.data = { intent: "verify-token", error };
    rerender();
    expect(result.current.access).toBeNull();
    expect(result.current.notice).toBe(
      error === "network" ? "network" : "invalid",
    );
  },
);
