import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useRevalidator } from "react-router";

import { usePlanCatalogRefresh } from "@/app/components/agents/plans/use-plan-catalog-refresh";

import type { PlanCatalogRefresh } from "@/app/components/agents/plans/use-plan-catalog-refresh";

const ANY_SIGNAL: unknown = expect.any(AbortSignal);

vi.mock("react-router", () => ({ useRevalidator: vi.fn() }));

const INPUT: PlanCatalogRefresh = { url: "/agent-api/catalog", etag: "v1" };
const revalidate = vi.fn(() => Promise.resolve());
let visibility: DocumentVisibilityState = "visible";
let fetchMock = vi.fn<typeof fetch>();

function revalidator(state: "idle" | "loading"): void {
  vi.mocked(useRevalidator).mockReturnValue({ revalidate, state });
}

async function tick(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetAllMocks();
  revalidate.mockResolvedValue(undefined);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  revalidator("idle");
});

afterEach(() => {
  vi.useRealTimers();
});

it("asks conditionally every 15 seconds and revalidates only on a change", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response("{}", { status: 200 }));
  renderHook(() => usePlanCatalogRefresh(INPUT));
  await tick();
  expect(fetchMock).toHaveBeenCalledWith("/agent-api/catalog", {
    cache: "no-store",
    signal: ANY_SIGNAL,
    headers: { "If-None-Match": "v1" },
  });
  expect(revalidate).not.toHaveBeenCalled();
  await tick();
  expect(revalidate).toHaveBeenCalledOnce();
});

it("revalidates after a failed request", async () => {
  fetchMock.mockRejectedValueOnce(new Error("offline"));
  renderHook(() => usePlanCatalogRefresh(INPUT));
  await tick();
  expect(revalidate).toHaveBeenCalledOnce();
});

it("asks once at a time and not while hidden or without a baseline", async () => {
  let answer: (response: Response) => void = () => undefined;
  fetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      answer = resolve;
    }),
  );
  renderHook(() => usePlanCatalogRefresh(INPUT));
  await tick();
  await tick();
  expect(fetchMock).toHaveBeenCalledOnce();
  await act(async () => {
    answer(new Response(null, { status: 304 }));
    await Promise.resolve();
  });
  visibility = "hidden";
  await tick();
  expect(fetchMock).toHaveBeenCalledOnce();
  visibility = "visible";
  renderHook(() => usePlanCatalogRefresh());
  fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
  await tick();
  // Only the hook with a baseline asks again.
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("drops an answer that arrives after unmounting", async () => {
  let answer: (response: Response) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  fetchMock
    .mockReturnValueOnce(
      new Promise((resolve) => {
        answer = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve, reject) => {
        fail = reject;
      }),
    );
  const first = renderHook(() => usePlanCatalogRefresh(INPUT));
  const second = renderHook(() => usePlanCatalogRefresh(INPUT));
  await tick();
  first.unmount();
  second.unmount();
  await act(async () => {
    answer(new Response("{}", { status: 200 }));
    fail(new Error("aborted"));
    await Promise.resolve();
  });
  expect(revalidate).not.toHaveBeenCalled();
});

it("revalidates when the visible window regains focus", () => {
  renderHook(() => usePlanCatalogRefresh(INPUT));
  window.dispatchEvent(new Event("focus"));
  expect(revalidate).toHaveBeenCalledOnce();
  visibility = "hidden";
  window.dispatchEvent(new Event("focus"));
  expect(revalidate).toHaveBeenCalledOnce();
});

it("waits while a revalidation is already running", async () => {
  revalidator("loading");
  renderHook(() => usePlanCatalogRefresh(INPUT));
  window.dispatchEvent(new Event("focus"));
  await tick();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(revalidate).not.toHaveBeenCalled();
});
