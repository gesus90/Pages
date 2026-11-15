import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useVisibleChatPresence } from "@/app/components/chat-page/use-visible-chat-presence";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 204 })),
  );
});
afterEach(() => {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function bodyAt(index: number): unknown {
  const body = vi.mocked(fetch).mock.calls[index]?.[1]?.body;
  if (typeof body !== "string") throw new Error("Expected a JSON heartbeat");
  return JSON.parse(body);
}

it("renews every 20 seconds while visible and clears presence when hidden", () => {
  const view = renderHook(() =>
    useVisibleChatPresence({ kind: "group", id: "chat" }, "chat"),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(bodyAt(0)).toMatchObject({
    chatKey: "group:chat",
    conversationId: "chat",
  });
  act(() => {
    vi.advanceTimersByTime(20_000);
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(bodyAt(2)).toMatchObject({ chatKey: null, conversationId: null });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  view.unmount();
  expect(vi.getTimerCount()).toBe(0);
});
