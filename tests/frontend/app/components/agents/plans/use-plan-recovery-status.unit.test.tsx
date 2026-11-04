import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { usePlanRecovery } from "@/app/components/agents/plans/use-plan-recovery";

import { recoveryView } from "./plan-panel-fixture";

import type { PlanRecoveryFollowing } from "@/app/components/agents/plans/use-plan-recovery";

const IDLE_FOLLOWING: PlanRecoveryFollowing = {
  isRunActive: false,
  readKey: "",
  onDecided: () => undefined,
};

let visibility: "hidden" | "visible" = "visible";

function viewAnswers(
  overrides: Parameters<typeof recoveryView>[0] = {},
): ReturnType<typeof vi.fn> {
  const fetcher = vi.fn(() =>
    Promise.resolve(Response.json({ recovery: recoveryView(overrides) })),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function pass(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function setTabVisibility(state: "hidden" | "visible"): Promise<void> {
  visibility = state;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("keeps a refused cleanup visible after refreshing the authoritative view", async () => {
  const view = recoveryView({ runId: "first" });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ recovery: view }))
    .mockResolvedValueOnce(
      Response.json(
        {
          error: "cleanup_unconfirmed",
          cleanupFailure: {
            stepId: "first",
            kind: "local_script",
            reason: "scan_access_denied",
            secret: "discarded",
          },
        },
        { status: 409 },
      ),
    )
    .mockResolvedValueOnce(Response.json({ recovery: view }));
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() => usePlanRecovery("first", vi.fn()));
  await waitFor(() => expect(result.current.view).toEqual(view));

  await act(async () => {
    await result.current.submit({ action: "release" });
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(result.current.error).toBe("cleanup_unconfirmed"));
  expect(result.current.cleanupFailure).toEqual({
    stepId: "first",
    kind: "local_script",
    reason: "scan_access_denied",
  });
  expect(result.current.result).toBeNull();
});

it("does not present an earlier release result for a refused request or another run", async () => {
  const first = recoveryView({ runId: "first" });
  const second = recoveryView({ runId: "second" });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ recovery: first }))
    .mockResolvedValueOnce(
      Response.json({
        result: { commandId: "one", revision: 1, outcome: "released" },
      }),
    )
    .mockResolvedValueOnce(Response.json({ recovery: first }))
    .mockResolvedValueOnce(
      Response.json({ error: "cleanup_unconfirmed" }, { status: 409 }),
    )
    .mockResolvedValueOnce(Response.json({ recovery: first }))
    .mockResolvedValueOnce(Response.json({ recovery: second }));
  vi.stubGlobal("fetch", fetcher);
  const { result, rerender } = renderHook(
    ({ runId }) => usePlanRecovery(runId, vi.fn()),
    { initialProps: { runId: "first" } },
  );
  await waitFor(() => expect(result.current.view).toEqual(first));
  await act(async () => {
    await result.current.submit({ action: "release" });
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  expect(result.current.result?.outcome).toBe("released");

  await act(async () => {
    await result.current.submit({ action: "release" });
  });
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(5));
  expect(result.current.result).toBeNull();
  rerender({ runId: "second" });
  await waitFor(() => expect(result.current.view).toEqual(second));
  expect(result.current.result).toBeNull();
  expect(result.current.error).toBeNull();
});

it("reads the view of an ended run without open cleanup only once", async () => {
  vi.useFakeTimers();
  const fetcher = viewAnswers({ state: "succeeded" });
  renderHook(() => usePlanRecovery("run", vi.fn(), IDLE_FOLLOWING));
  await pass();
  await pass(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("reads the view every five seconds while the run is active", async () => {
  vi.useFakeTimers();
  const fetcher = viewAnswers({ state: "cancelled" });
  renderHook(() =>
    usePlanRecovery("run", vi.fn(), { ...IDLE_FOLLOWING, isRunActive: true }),
  );
  await pass();
  await pass(10_000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("reads the view of an ended run every five seconds until its cleanup settles", async () => {
  vi.useFakeTimers();
  const open = recoveryView({
    state: "failed_terminal",
    isCleanupUnconfirmed: true,
  });
  const settled = recoveryView({ state: "failed_terminal" });
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ recovery: open }))
    .mockResolvedValueOnce(Response.json({ recovery: open }))
    .mockImplementation(() =>
      Promise.resolve(Response.json({ recovery: settled })),
    );
  vi.stubGlobal("fetch", fetcher);
  renderHook(() => usePlanRecovery("run", vi.fn(), IDLE_FOLLOWING));
  await pass();
  await pass(10_000);
  expect(fetcher).toHaveBeenCalledTimes(3);
  await pass(60_000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("pauses cyclic reads in a hidden tab and reads once on its return", async () => {
  vi.useFakeTimers();
  const fetcher = viewAnswers({ state: "running" });
  renderHook(() =>
    usePlanRecovery("run", vi.fn(), { ...IDLE_FOLLOWING, isRunActive: true }),
  );
  await pass();
  await setTabVisibility("hidden");
  await pass(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await setTabVisibility("visible");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await pass(5_000);
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it("reads the view of an ended run once more on return without repeating", async () => {
  vi.useFakeTimers();
  const fetcher = viewAnswers({ state: "succeeded" });
  renderHook(() => usePlanRecovery("run", vi.fn(), IDLE_FOLLOWING));
  await pass();
  await setTabVisibility("hidden");
  await setTabVisibility("visible");
  expect(fetcher).toHaveBeenCalledTimes(2);
  await pass(60_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("reads the view once when the read key changes", async () => {
  vi.useFakeTimers();
  const fetcher = viewAnswers({ state: "failed_terminal" });
  const { rerender } = renderHook(
    ({ readKey }: { readonly readKey: string }) =>
      usePlanRecovery("run", vi.fn(), { ...IDLE_FOLLOWING, readKey }),
    { initialProps: { readKey: "first" } },
  );
  await pass();
  rerender({ readKey: "first" });
  await pass(30_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  rerender({ readKey: "second" });
  await pass(30_000);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("stops after a refused read and retries after a failed connection or server", async () => {
  vi.useFakeTimers();
  const refusing = vi.fn(() =>
    Promise.resolve(Response.json({ error: "access_denied" }, { status: 403 })),
  );
  vi.stubGlobal("fetch", refusing);
  const first = renderHook(() =>
    usePlanRecovery("run", vi.fn(), IDLE_FOLLOWING),
  );
  await pass();
  await pass(30_000);
  expect(refusing).toHaveBeenCalledTimes(1);
  expect(first.result.current.error).toBe("access_denied");
  first.unmount();

  const failing = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(
      Response.json({ error: "diagnostic_unavailable" }, { status: 503 }),
    )
    .mockImplementation(() =>
      Promise.resolve(
        Response.json({ recovery: recoveryView({ state: "succeeded" }) }),
      ),
    );
  vi.stubGlobal("fetch", failing);
  renderHook(() => usePlanRecovery("run", vi.fn(), IDLE_FOLLOWING));
  await pass();
  await pass(10_000);
  expect(failing).toHaveBeenCalledTimes(3);
  await pass(30_000);
  expect(failing).toHaveBeenCalledTimes(3);
});

it("reports the end of a decision so the control is read at once", async () => {
  const view = recoveryView({ state: "recoverable" });
  const onDecided = vi.fn();
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ recovery: view }))
    .mockResolvedValueOnce(
      Response.json({
        result: { commandId: "one", revision: 1, outcome: "released" },
      }),
    )
    .mockImplementation(() =>
      Promise.resolve(Response.json({ recovery: view })),
    );
  vi.stubGlobal("fetch", fetcher);
  const { result } = renderHook(() =>
    usePlanRecovery("run", vi.fn(), { ...IDLE_FOLLOWING, onDecided }),
  );
  await waitFor(() => expect(result.current.view).toEqual(view));
  expect(onDecided).not.toHaveBeenCalled();
  await act(async () => {
    await result.current.submit({ action: "release" });
  });
  expect(onDecided).toHaveBeenCalledTimes(1);
});
