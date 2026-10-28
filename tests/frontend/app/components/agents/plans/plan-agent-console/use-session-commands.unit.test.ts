import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { useSessionCommands } from "@/app/components/agents/plans/plan-agent-console/use-session-commands";

import { SESSION_VIEW } from "../../page161-session-fixture";

type FetchStub = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function stubFetch(
  answer: unknown,
  status = 200,
): ReturnType<typeof vi.fn<FetchStub>> {
  const fetchStub = vi.fn<FetchStub>(async () =>
    Response.json(answer, { status }),
  );
  vi.stubGlobal("fetch", fetchStub);
  return fetchStub;
}

function formOf(fetchStub: ReturnType<typeof vi.fn<FetchStub>>): unknown {
  const body = fetchStub.mock.calls.at(-1)?.[1]?.body;
  if (!(body instanceof FormData)) throw new Error("Form body missing");
  return Object.fromEntries(body.entries());
}

it("sends an instruction to the session route and shows the confirmed delivery", async () => {
  const fetchStub = stubFetch({ ok: true, intent: "send", delivery: "queued" });
  const onSettled = vi.fn<() => void>();
  const { result } = renderHook(() =>
    useSessionCommands(SESSION_VIEW.key, onSettled),
  );
  expect(result.current.isPending).toBe(false);
  expect(result.current.notice).toBeNull();
  let isSent = false;
  await act(async () => {
    isSent = await result.current.send("Continue");
  });
  expect(isSent).toBe(true);
  expect(String(fetchStub.mock.calls[0]?.[0])).toBe(
    "/agent-api/plan-runs/run-page161/steps/node/session?planId=plan-page161&attemptId=attempt-page161",
  );
  expect(formOf(fetchStub)).toEqual({ intent: "send", text: "Continue" });
  expect(result.current.notice).toEqual({ tone: "status", code: "queued" });
  expect(result.current.isPending).toBe(false);
  expect(onSettled).toHaveBeenCalledOnce();
});

it("cancels a turn and reports the confirmed outcome", async () => {
  const fetchStub = stubFetch({
    ok: true,
    intent: "cancel",
    outcome: "turn_cancelled",
  });
  const onSettled = vi.fn<() => void>();
  const { result } = renderHook(() =>
    useSessionCommands(SESSION_VIEW.key, onSettled),
  );
  await act(async () => {
    await result.current.cancel("turn");
  });
  expect(formOf(fetchStub)).toEqual({ intent: "cancel", scope: "turn" });
  expect(result.current.notice).toEqual({
    tone: "status",
    code: "turn_cancelled",
  });
  expect(onSettled).toHaveBeenCalledOnce();
});

it("shows a refused command as an alert and reports it as not sent", async () => {
  stubFetch({ ok: false, intent: "send", error: "plan_session_busy" }, 409);
  const onSettled = vi.fn<() => void>();
  const { result } = renderHook(() =>
    useSessionCommands(SESSION_VIEW.key, onSettled),
  );
  let isSent = true;
  await act(async () => {
    isSent = await result.current.send("Again");
  });
  expect(isSent).toBe(false);
  expect(result.current.notice).toEqual({
    tone: "alert",
    code: "plan_session_busy",
  });
  expect(onSettled).toHaveBeenCalledOnce();
});

it("blocks a second command while the first one waits for the backend", async () => {
  let answer: (response: Response) => void = () => undefined;
  const fetchStub = vi.fn<FetchStub>(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetchStub);
  const onSettled = vi.fn<() => void>();
  const { result } = renderHook(() =>
    useSessionCommands(SESSION_VIEW.key, onSettled),
  );
  let first: Promise<boolean> = Promise.resolve(false);
  act(() => {
    first = result.current.send("First");
  });
  expect(result.current.isPending).toBe(true);
  let second = true;
  await act(async () => {
    second = await result.current.send("Second");
  });
  expect(second).toBe(false);
  expect(fetchStub).toHaveBeenCalledOnce();
  await act(async () => {
    answer(Response.json({ ok: true, intent: "send", delivery: "started" }));
    await first;
  });
  expect(result.current.isPending).toBe(false);
  expect(result.current.notice).toEqual({ tone: "status", code: "started" });
  expect(onSettled).toHaveBeenCalledOnce();
});
