import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useLiveChanges } from "@/app/components/common/use-live-changes";

import type { LiveConnectionHandlers } from "@/app/lib/live-changes/live-change-connection";

const boundary = vi.hoisted(() => ({
  open: vi.fn<
    (version: string, handlers: LiveConnectionHandlers) => () => void
  >(),
  revalidate: vi.fn(),
  close: vi.fn(),
}));
vi.mock("react-router", () => ({
  useLocation: () => ({ pathname: "/wiki/article" }),
  useRevalidator: () => ({ revalidate: boundary.revalidate }),
}));
vi.mock("@/app/lib/live-changes/live-change-connection", () => ({
  openLiveConnection: boundary.open,
}));
vi.mock("@/app/lib/live-changes/live-revalidation", () => ({
  revalidateLive: async (revalidate: () => void): Promise<void> => {
    revalidate();
  },
}));

afterEach(() => {
  vi.useRealTimers();
});

it("coalesces relevant notices and resumes fallback after disconnect", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("EventSource", class {});
  boundary.revalidate.mockReset();
  boundary.close.mockReset();
  boundary.open.mockReset().mockReturnValue(boundary.close);
  const { result, unmount } = renderHook(() => useLiveChanges("v1"));
  const handlers = boundary.open.mock.calls[0]?.[1];
  if (!handlers) throw new Error("Live handlers missing");
  act(() => {
    handlers.onLiveChange(true);
    handlers.onChange({ kind: "ticket", id: "1" });
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(result.current).toBe(true);
  expect(boundary.revalidate).not.toHaveBeenCalled();
  act(() => {
    handlers.onChange({ kind: "wiki", id: "1" });
    handlers.onResync();
  });
  await act(async () => vi.advanceTimersByTimeAsync(100));
  expect(boundary.revalidate).toHaveBeenCalledTimes(1);
  act(() => handlers.onLiveChange(false));
  await act(async () => vi.advanceTimersByTimeAsync(60_100));
  expect(boundary.revalidate).toHaveBeenCalledTimes(2);
  unmount();
  expect(boundary.close).toHaveBeenCalledOnce();
});
