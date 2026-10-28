import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { usePlanRecovery } from "@/app/components/agents/plans/use-plan-recovery";

import { recoveryView } from "./plan-panel-fixture";

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
