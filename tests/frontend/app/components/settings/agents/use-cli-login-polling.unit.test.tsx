import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useCliLoginPolling } from "@/app/components/settings/agents/use-cli-login-polling";
import { GLOBAL_CONNECTION_SCOPE } from "@/definition/AgentConnectionScope";

import type {
  AgentConnectionSummary,
  CliLoginView,
} from "@/definition/AgentConnection";

const revalidate = vi.hoisted(() => vi.fn());
vi.mock("react-router", () => ({ useRevalidator: () => ({ revalidate }) }));

function connection(
  id: string,
  login: CliLoginView | null,
): AgentConnectionSummary {
  return {
    id,
    name: id,
    isActive: true,
    provider: "codex_cli",
    accessKind: "cli_account",
    hasApiKey: false,
    testModel: null,
    reasoningEffort: null,
    scope: GLOBAL_CONNECTION_SCOPE,
    cli: {
      binaryFound: true,
      loggedInAt: null,
      accountLabel: null,
      login,
      terminalCommand: "codex",
    },
    checks: { auth: null, model: null },
    updatedAt: "2026-01-01",
  };
}

beforeEach(() => revalidate.mockReset());
afterEach(() => vi.unstubAllGlobals());

it("polls only active logins and exposes their challenge", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        state: "awaiting_user",
        userCode: "ABCD",
        isOwnLogin: true,
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() =>
    useCliLoginPolling([
      connection("a/b", { state: "starting" }),
      connection("done", { state: "succeeded" }),
      connection("none", null),
    ]),
  );

  await waitFor(() =>
    expect(result.current["a/b"]).toEqual({
      login: { state: "awaiting_user", userCode: "ABCD", isOwnLogin: true },
      hasError: false,
    }),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0]?.[0]).toBe("/settings-api/agents/a%2Fb/login");
  expect(revalidate).not.toHaveBeenCalled();
});

it.each([
  null,
  { state: "succeeded" },
  { state: "failed", errorCode: "login_failed" },
])("revalidates when the login ends: %j", async (login) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(login))),
  );
  const { result } = renderHook(() =>
    useCliLoginPolling([connection("c1", { state: "starting" })]),
  );

  await waitFor(() => expect(revalidate).toHaveBeenCalledTimes(1));
  expect(result.current.c1).toEqual({ login, hasError: false });
});

it.each([
  { state: "unknown" },
  { state: "starting", verificationUrl: 4 },
  { state: "starting", canSubmitRedirect: "yes" },
  { state: "failed", errorCode: "not-a-code" },
  {},
  "starting",
])("reports malformed responses without revalidating: %j", async (payload) => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))),
  );
  const { result } = renderHook(() =>
    useCliLoginPolling([connection("c1", { state: "starting" })]),
  );

  await waitFor(() =>
    expect(result.current.c1).toEqual({ login: null, hasError: true }),
  );
  expect(revalidate).not.toHaveBeenCalled();
});

it("reports network and HTTP errors", async () => {
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response("error", { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  const { result } = renderHook(() =>
    useCliLoginPolling([
      connection("first", { state: "starting" }),
      connection("second", { state: "verifying" }),
    ]),
  );

  await waitFor(() =>
    expect(result.current).toEqual({
      first: { login: null, hasError: true },
      second: { login: null, hasError: true },
    }),
  );
  expect(revalidate).not.toHaveBeenCalled();
});

it("aborts an obsolete request and clears sessions when the login ends", async () => {
  let resolveResponse: (response: Response) => void = () => {};
  let signal: AbortSignal | null | undefined;
  const fetchMock = vi.fn((url: string, options: RequestInit) => {
    expect(url).toBe("/settings-api/agents/c1/login");
    signal = options.signal;
    return new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const { result, rerender } = renderHook(
    ({ active }) =>
      useCliLoginPolling(
        active ? [connection("c1", { state: "starting" })] : [],
      ),
    { initialProps: { active: true } },
  );
  rerender({ active: false });
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    resolveResponse(new Response(JSON.stringify({ state: "succeeded" }))),
  );
  expect(result.current).toEqual({});
  expect(revalidate).not.toHaveBeenCalled();
});

it("polls again after two seconds and stops after unmount", async () => {
  vi.useFakeTimers();
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ state: "starting" })));
  vi.stubGlobal("fetch", fetchMock);
  const view = renderHook(() =>
    useCliLoginPolling([connection("c1", { state: "starting" })]),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(4000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  vi.useRealTimers();
});
