import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { usePlanPoll } from "@/app/components/agents/plans/use-plan-poll";

import { syntheticRun } from "../page72-run-fixture";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

const ANY_SIGNAL: unknown = expect.any(AbortSignal);

let fetchMock = vi.fn<typeof fetch>();
let visibility: "hidden" | "visible" = "visible";

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

function control(status: AgentPlanControl["status"]): AgentPlanControl {
  return {
    runId: status === "idle" ? null : "run",
    status,
    canPlay: status === "idle",
    canPause: false,
    canResume: false,
    canStop: false,
    canEdit: true,
    issue: null,
    planRevision: 1,
    continuationVersion: 0,
    frontierStepIds: [],
  };
}

async function flush(milliseconds = 0): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(milliseconds);
  });
}

async function setTabVisibility(state: "hidden" | "visible"): Promise<void> {
  visibility = state;
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", fetchMock);
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(
    () => visibility,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
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

it("retries at the active pace until a first answer is known", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce(answer({ ok: true, control: control("idle") }));
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("shows a refused poll and asks without a tag afterwards", async () => {
  fetchMock
    .mockResolvedValueOnce(answer({ ok: false, error: "forbidden" }, '"x"'))
    .mockResolvedValueOnce(answer({ ok: false }));
  const { result } = renderHook(() => usePlanPoll("/poll", undefined));
  await flush();
  expect(result.current.error).toBe("forbidden");
  await flush(15_999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await flush(1);
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

it("keeps polling an active address that answers without a run at the idle pace", async () => {
  fetchMock
    .mockResolvedValueOnce(answer({ ok: false, error: "missing" }))
    .mockResolvedValueOnce(answer({ ok: false, error: "missing" }));
  renderHook(() => usePlanPoll("/run", undefined, "active"));
  await flush();
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await flush(14_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("reads an active run's control every two seconds and an idle control every 16", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, control: control("running") })),
  );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  await flush(10_000);
  expect(fetchMock).toHaveBeenCalledTimes(6);
  fetchMock.mockReset();
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, control: control("failed") })),
  );
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await flush(15_999);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await flush(1);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("stays within 20 reads in five minutes without an active run", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, control: control("idle") })),
  );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  await flush(300_000);
  expect(fetchMock).toHaveBeenCalledTimes(19);
});

it("keeps the pace of an active run through unchanged answers", async () => {
  fetchMock
    .mockResolvedValueOnce(
      answer({ ok: true, control: control("running") }, '"c1"'),
    )
    .mockImplementation(() =>
      Promise.resolve(new Response(null, { status: 304 })),
    );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  await flush(4_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("reads nothing while the tab is hidden and at once on its return", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, control: control("running") }, '"c1"')),
  );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await setTabVisibility("hidden");
  await flush(120_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await setTabVisibility("visible");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(headersOf(1)).toEqual({
    "If-None-Match": '"c1"',
    "X-Plan-Observation": "open",
  });
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(headersOf(2)).toEqual({
    "If-None-Match": '"c1"',
    "X-Plan-Observation": "renew",
  });
});

it("does not start reading in a hidden tab", async () => {
  visibility = "hidden";
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, control: control("idle") })),
  );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush(60_000);
  expect(fetchMock).not.toHaveBeenCalled();
  await setTabVisibility("visible");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("stays silent after a read that answers in the hidden tab", async () => {
  let respond: (response: Response) => void = () => undefined;
  fetchMock.mockReturnValueOnce(
    new Promise((resolve) => {
      respond = resolve;
    }),
  );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  await setTabVisibility("hidden");
  respond(answer({ ok: true, control: control("running") }));
  await flush(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("does not start a second read when the tab returns during a read", async () => {
  let respond: (response: Response) => void = () => undefined;
  fetchMock
    .mockReturnValueOnce(
      new Promise((resolve) => {
        respond = resolve;
      }),
    )
    .mockImplementation(() =>
      Promise.resolve(answer({ ok: true, control: control("running") })),
    );
  renderHook(() => usePlanPoll("/control", undefined));
  await flush();
  await setTabVisibility("hidden");
  await setTabVisibility("visible");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  respond(answer({ ok: true, control: control("running") }));
  await flush(2_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(headersOf(1)).toEqual({ "X-Plan-Observation": "open" });
});

it("reads an ended run once on return and does not repeat it", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, run: run("succeeded") })),
  );
  renderHook(() => usePlanPoll("/run", undefined, "active"));
  await flush();
  await setTabVisibility("hidden");
  await setTabVisibility("visible");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  await flush(60_000);
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("reads at once on a read request and keeps the answer until the new one", async () => {
  fetchMock.mockResolvedValueOnce(
    answer({ ok: true, control: control("failed") }),
  );
  const { result, rerender } = renderHook(
    ({ request }: { readonly request: number }) =>
      usePlanPoll("/control", undefined, "always", request),
    { initialProps: { request: 0 } },
  );
  await flush();
  fetchMock.mockResolvedValueOnce(
    answer({ ok: true, control: control("running") }),
  );
  rerender({ request: 1 });
  expect(result.current.response).toMatchObject({
    control: { status: "failed" },
  });
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(result.current.response).toMatchObject({
    control: { status: "running" },
  });
});

it("reads at once after a command, also from the idle pace", async () => {
  fetchMock.mockImplementation(() =>
    Promise.resolve(answer({ ok: true, control: control("idle") })),
  );
  const initialProps: { readonly command: AgentPlanActionResult | undefined } =
    { command: undefined };
  const { rerender } = renderHook(
    ({ command }) => usePlanPoll("/control", command),
    { initialProps },
  );
  await flush();
  rerender({ command: { ok: true, intent: "play-plan" } });
  await flush();
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
  const { result, rerender } = renderHook<
    ReturnType<typeof usePlanPoll>,
    {
      readonly url: string;
      readonly command: AgentPlanActionResult | undefined;
    }
  >(
    (props: { url: string; command: AgentPlanActionResult | undefined }) =>
      usePlanPoll(props.url, props.command),
    { initialProps: { url: "/first", command: undefined } },
  );
  await flush();
  rerender({ url: "/second", command: undefined });
  expect(result.current).toEqual({ response: undefined, error: null });
  await flush();
  expect(result.current).toEqual({
    url: "/second",
    response: undefined,
    error: "plan_connection_unavailable",
  });
  fetchMock.mockResolvedValueOnce(answer({ ok: true, run: run("cancelled") }));
  rerender({
    url: "/second",
    command: { ok: true, intent: "stop-plan", run: run("cancelled") },
  });
  expect(result.current).toEqual({ response: undefined, error: null });
  await flush();
  expect(result.current.response).toMatchObject({
    run: { status: "cancelled" },
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
