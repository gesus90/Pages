import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { useAgentDetail } from "@/app/components/users/agents/use-agent-detail";

import { syntheticDetail } from "./agent-detail-fixture";

function answer(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it("reads nothing and is idle while no agent is open", () => {
  const fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAgentDetail(null, 0));
  expect(result.current).toEqual({
    detail: null,
    isLoading: false,
    hasFailed: false,
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reads the encoded endpoint of the agent and delivers its detail", async () => {
  const detail = syntheticDetail();
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(answer(detail));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() => useAgentDetail("agent/1", 0));
  expect(result.current.isLoading).toBe(true);
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current).toEqual({
    detail,
    isLoading: false,
    hasFailed: false,
  });
  const [url, init] = fetchMock.mock.calls[0] ?? [];
  expect(url).toBe("/users-api/agents/agent%2F1");
  expect(init?.cache).toBe("no-store");
  expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
});

it("reports a failure for a refused answer", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(answer({ error: "x" }, 403)),
  );
  const { result } = renderHook(() => useAgentDetail("agent-1", 0));
  await waitFor(() => expect(result.current.hasFailed).toBe(true));
  expect(result.current).toEqual({
    detail: null,
    isLoading: false,
    hasFailed: true,
  });
});

it("reports a failure for an answer that is no agent detail", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(answer({ agent: {} })),
  );
  const { result } = renderHook(() => useAgentDetail("agent-1", 0));
  await waitFor(() => expect(result.current.hasFailed).toBe(true));
  expect(result.current.detail).toBeNull();
});

it("reports a failure and logs when the network fails", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const failure = new Error("offline");
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(failure));
  const { result } = renderHook(() => useAgentDetail("agent-1", 0));
  await waitFor(() => expect(result.current.hasFailed).toBe(true));
  expect(result.current.isLoading).toBe(false);
  expect(warn).toHaveBeenCalledWith(
    "[pages] The agent could not be read.",
    failure,
  );
});

it("reads again for a new reload key and keeps the old detail while loading", async () => {
  const first = syntheticDetail();
  const second = syntheticDetail({ canEdit: false });
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(answer(first))
    .mockResolvedValueOnce(answer(second));
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(
    ({ key }) => useAgentDetail("agent-1", key),
    { initialProps: { key: 0 } },
  );
  await waitFor(() => expect(result.current.detail).toEqual(first));
  rerender({ key: 1 });
  expect(result.current.isLoading).toBe(true);
  expect(result.current.detail).toEqual(first);
  await waitFor(() => expect(result.current.detail).toEqual(second));
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("aborts the read silently when the panel closes", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  let signal: AbortSignal | null | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockImplementation((...request) => {
      signal = request[1]?.signal;
      return new Promise<Response>((...handlers) => {
        signal?.addEventListener("abort", () =>
          handlers[1](new DOMException("aborted", "AbortError")),
        );
      });
    }),
  );
  const initialProps: { id: string | null } = { id: "agent-1" };
  const { result, rerender } = renderHook(
    ({ id }: { id: string | null }) => useAgentDetail(id, 0),
    { initialProps },
  );
  rerender({ id: null });
  await waitFor(() => expect(signal?.aborted).toBe(true));
  expect(result.current).toEqual({
    detail: null,
    isLoading: false,
    hasFailed: false,
  });
  expect(warn).not.toHaveBeenCalled();
});
