import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useAuthorizationRefresh } from "@/app/components/common/use-authorization-refresh";

const boundary = vi.hoisted(() => ({ revalidate: vi.fn() }));
vi.mock("react-router", () => ({
  useRevalidator: (): typeof boundary => boundary,
}));

beforeEach(() => {
  vi.useFakeTimers();
  boundary.revalidate.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

it("polls visible tabs, reports an outage and clears it after recovery", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ version: "v1" })));
  vi.stubGlobal("fetch", fetchMock);
  const { result, unmount } = renderHook(() =>
    useAuthorizationRefresh("v1", false),
  );

  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(result.current).toBe(true);
  expect(boundary.revalidate).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(result.current).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  unmount();
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("revalidates changed permissions and stops polling while live", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ version: "v2" })));
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = renderHook(
    ({ live }) => useAuthorizationRefresh("v1", live),
    {
      initialProps: { live: false },
    },
  );
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(boundary.revalidate).toHaveBeenCalledTimes(1);
  rerender({ live: true });
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("checks on focus and throttles repeated focus events", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAuthorizationRefresh("v1", false));
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(result.current).toBe(true);
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("revalidates a rejected response and clears an earlier offline state when live", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("offline"))
    .mockResolvedValueOnce(new Response(null, { status: 401 }));
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(
    ({ live }) => useAuthorizationRefresh("v1", live),
    { initialProps: { live: false } },
  );
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(result.current).toBe(true);
  rerender({ live: true });
  expect(result.current).toBe(false);
  rerender({ live: false });
  await act(async () => vi.advanceTimersByTimeAsync(30_000));
  expect(boundary.revalidate).toHaveBeenCalledOnce();
  expect(result.current).toBe(false);
});
