// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidate = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate }) }));

import { useCliLoginPolling } from "@/app/components/settings/agents/use-cli-login-polling";

import { createAgentConnection, createCliConnection } from "../helpers/agents";

import type { AgentConnectionSummary } from "@/definition/AgentConnection";

function activeConnection(): AgentConnectionSummary {
  return createCliConnection({
    cli: {
      binaryFound: true,
      loggedInAt: null,
      accountLabel: null,
      terminalCommand: "synthetic",
      login: { state: "starting" },
    },
  });
}

describe("protected login polling", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", fetchMock);
    revalidate.mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());

  it("makes no request until a server-owned session is active, then drops challenges on exit", async () => {
    const connection = activeConnection();
    fetchMock.mockResolvedValue(
      Response.json({
        state: "awaiting_user",
        userCode: "SYNTHETIC",
        verificationUrl: "https://auth.openai.com/codex/device",
        expiresAt: "later",
      }),
    );
    const hook = renderHook(
      ({ connections }) => useCliLoginPolling(connections),
      {
        initialProps: {
          connections: [
            createAgentConnection(),
            createCliConnection(),
            createCliConnection({
              id: "finished",
              cli: {
                binaryFound: true,
                loggedInAt: null,
                accountLabel: null,
                terminalCommand: "synthetic",
                login: { state: "succeeded" },
              },
            }),
          ],
        },
      },
    );
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      hook.rerender({ connections: [connection] });
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `/settings-api/agents/${connection.id}/login`,
      { cache: "no-store", signal: expect.any(AbortSignal) },
    );
    expect(hook.result.current[connection.id]?.login?.userCode).toBe(
      "SYNTHETIC",
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await act(async () => {
      hook.rerender({ connections: [] });
    });
    expect(hook.result.current).toEqual({});
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it.each([
    null,
    { state: "succeeded" },
    { state: "expired", errorCode: "login_expired" },
  ])(
    "revalidates persisted metadata after termination or restart: %j",
    async (response) => {
      fetchMock.mockResolvedValue(Response.json(response));
      const hook = renderHook(() => useCliLoginPolling([activeConnection()]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(revalidate).toHaveBeenCalledTimes(1);
      expect(Object.values(hook.result.current)[0]?.login).toEqual(response);
    },
  );

  it.each([
    false,
    "text",
    {},
    { state: 5 },
    { state: "unknown" },
    { state: "awaiting_user", userCode: 1 },
    { state: "failed", errorCode: "raw-provider-error" },
  ])(
    "rejects malformed polling responses without displaying their contents: %j",
    async (response) => {
      fetchMock.mockResolvedValue(Response.json(response));
      const hook = renderHook(() => useCliLoginPolling([activeConnection()]));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(Object.values(hook.result.current)).toEqual([
        { login: null, hasError: true },
      ]);
      expect(revalidate).not.toHaveBeenCalled();
    },
  );

  it("retries network and permission failures without retaining a displayed code", async () => {
    fetchMock
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }))
      .mockResolvedValue(Response.json({ state: "verifying" }));
    const hook = renderHook(() => useCliLoginPolling([activeConnection()]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(Object.values(hook.result.current)[0]?.hasError).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(Object.values(hook.result.current)[0]?.hasError).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(Object.values(hook.result.current)[0]?.hasError).toBe(false);
  });

  it("does not reschedule or update a closed panel's pending request", async () => {
    const resolveResponse = vi.fn<(response: Response) => void>();
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => resolveResponse.mockImplementation(resolve)),
    );
    const hook = renderHook(() => useCliLoginPolling([activeConnection()]));
    hook.unmount();
    await act(async () => {
      resolveResponse(Response.json({ state: "succeeded" }));
    });
    expect(revalidate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not reschedule after unmount while revalidation is pending", async () => {
    const resolveRevalidation = vi.fn<() => void>();
    revalidate.mockImplementation(
      () =>
        new Promise<void>((resolve) =>
          resolveRevalidation.mockImplementation(resolve),
        ),
    );
    fetchMock.mockResolvedValue(Response.json({ state: "succeeded" }));
    const hook = renderHook(() => useCliLoginPolling([activeConnection()]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    hook.unmount();
    await act(async () => {
      resolveRevalidation();
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
