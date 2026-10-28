import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { usePlanPoll } from "@/app/components/agents/plans/use-plan-poll";

import { syntheticRun } from "../page72-run-fixture";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const ANY_SIGNAL: unknown = expect.any(AbortSignal);

let fetchMock = vi.fn<typeof fetch>();

function answer(body: unknown, etag?: string): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: etag ? { ETag: etag } : {},
  });
}

function run(status: AgentPlanRun["status"]): AgentPlanRun {
  return { ...syntheticRun(), status };
}

function headersOf(call: number): unknown {
  return fetchMock.mock.calls[call]?.[1]?.headers;
}

async function flush(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
});

it("does not poll without an address", () => {
  const { result } = renderHook(() => usePlanPoll(null, undefined));
  expect(result.current).toMatchObject({ response: undefined, error: null });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("opens an observation, renews it with the entity tag and keeps the state on 304", async () => {
  const running = run("running");
  fetchMock
    .mockResolvedValueOnce(answer({ ok: true, run: running }, '"r1"'))
    .mockResolvedValueOnce(new Response(null, { status: 304 }));
  const { result } = renderHook(() => usePlanPoll("/poll", undefined));
  await flush();
  expect(fetchMock).toHaveBeenCalledWith("/poll", {
    cache: "no-store",
    signal: ANY_SIGNAL,
    headers: { "X-Plan-Observation": "open" },
  });
  expect(result.current.response).toMatchObject({
    ok: true,
    intent: "poll",
    run: { id: running.id, status: "running" },
  });
  expect(result.current.error).toBeNull();
  await flush(2_000);
  expect(headersOf(1)).toEqual({
    "If-None-Match": '"r1"',
    "X-Plan-Observation": "renew",
  });
  expect(result.current.response).toMatchObject({
    ok: true,
    intent: "poll",
    run: { id: running.id, status: "running" },
  });
});

it("shows a refused poll and asks without a tag afterwards", async () => {
  fetchMock
    .mockResolvedValueOnce(answer({ ok: false, error: "forbidden" }, '"x"'))
    .mockResolvedValueOnce(answer({ ok: false }));
  const { result } = renderHook(() => usePlanPoll("/poll", undefined));
  await flush();
  expect(result.current.error).toBe("forbidden");
  await flush(2_000);
  expect(headersOf(1)).toEqual({ "X-Plan-Observation": "renew" });
  expect(result.current.error).toBe("general");
});

it("follows an active run only until it ends", async () => {
  fetchMock
    .mockResolvedValueOnce(answer({ ok: true, run: run("running") }))
    .mockResolvedValueOnce(answer({ ok: true, run: run("succeeded") }));
  const command: AgentPlanActionResult = { ok: true, intent: "play-plan" };
  const { result } = renderHook(() => usePlanPoll("/run", command, "active"));
  await flush();
  expect(headersOf(0)).toEqual({});
  await flush(2_000);
  expect(result.current.response).toMatchObject({
    run: { status: "succeeded" },
  });
  await flush(10_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps polling an active address that answers without a run", async () => {
  fetchMock
    .mockResolvedValueOnce(answer({ ok: false, error: "missing" }))
    .mockResolvedValueOnce(answer({ ok: false, error: "missing" }));
  renderHook(() => usePlanPoll("/run", undefined, "active"));
  await flush();
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("keeps the last answer through a connection failure and retries", async () => {
  const running = run("running");
  fetchMock
    .mockResolvedValueOnce(answer({ ok: true, run: running }))
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(new Response("not json"));
  const { result } = renderHook(() => usePlanPoll("/poll", undefined));
  await flush();
  await flush(2_000);
  expect(result.current).toMatchObject({
    url: "/poll",
    response: { ok: true, run: { id: running.id } },
    error: "plan_connection_unavailable",
  });
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(result.current.error).toBe("plan_connection_unavailable");
});

it("drops the previous address's answer when the new one fails", async () => {
  fetchMock
    .mockResolvedValueOnce(answer({ ok: true, run: run("running") }))
    .mockRejectedValueOnce(new Error("offline"));
  const { result, rerender } = renderHook(
    (props: { url: string }) => usePlanPoll(props.url, undefined),
    { initialProps: { url: "/first" } },
  );
  await flush();
  rerender({ url: "/second" });
  expect(result.current).toEqual({ response: undefined, error: null });
  await flush();
  expect(result.current).toEqual({
    url: "/second",
    response: undefined,
    error: "plan_connection_unavailable",
  });
});

it("ignores answers and failures that arrive after unmounting", async () => {
  let respond: (response: Response) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  fetchMock
    .mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    )
    .mockReturnValueOnce(
      new Promise((resolve, reject) => {
        fail = reject;
      }),
    );
  const first = renderHook(() => usePlanPoll("/first", undefined));
  const second = renderHook(() => usePlanPoll("/second", undefined));
  first.unmount();
  second.unmount();
  respond(answer({ ok: true, run: run("running") }));
  fail(new Error("aborted"));
  await flush(10_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
