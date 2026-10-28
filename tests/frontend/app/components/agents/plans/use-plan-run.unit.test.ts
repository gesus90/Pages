import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { usePlanPoll } from "@/app/components/agents/plans/use-plan-poll";
import { usePlanRun } from "@/app/components/agents/plans/use-plan-run";

import { syntheticRun } from "../page72-run-fixture";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";

vi.mock("@/app/components/agents/plans/use-plan-poll", () => ({
  usePlanPoll: vi.fn(),
}));

function run(
  id: string,
  status: AgentPlanRun["status"] = "running",
): AgentPlanRun {
  return { ...syntheticRun(), id, status };
}

function polling(polled?: AgentPlanRun, error: string | null = null): void {
  vi.mocked(usePlanPoll).mockReturnValue({
    response: polled ? { ok: true, intent: "poll", run: polled } : undefined,
    error,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  polling();
});

it("follows the newest run of the history while it is active", () => {
  const history = [run("new"), run("old", "succeeded")];
  const { result } = renderHook(() => usePlanRun(history, undefined));
  expect(usePlanPoll).toHaveBeenCalledWith(
    "/agent-api/plan-runs?runId=new",
    undefined,
    "active",
  );
  expect(result.current.selectedId).toBe("new");
  expect(result.current.run).toBe(history[0]);
  expect(result.current.runs).toBe(history);
  expect(result.current.error).toBeNull();
});

it("polls nothing without any run", () => {
  const { result } = renderHook(() => usePlanRun([], undefined));
  expect(usePlanPoll).toHaveBeenCalledWith(null, undefined, "active");
  expect(result.current.run).toBeNull();
  expect(result.current.selectedId).toBe("");
});

it("puts the run a command started first and selects it", () => {
  const started = run("started");
  const history = [run("old", "succeeded"), run("started", "running")];
  const command: AgentPlanActionResult = {
    ok: true,
    intent: "play-plan",
    run: started,
  };
  const { result } = renderHook(() => usePlanRun(history, command));
  expect(result.current.selectedId).toBe("started");
  expect(result.current.runs.map((entry) => entry.id)).toEqual([
    "started",
    "old",
  ]);
  expect(result.current.run).toBe(started);
});

it("ignores a refused command and replaces a run with its polled state", () => {
  const polled = run("current", "succeeded");
  polling(polled);
  const history = [run("current"), run("old", "failed")];
  const command: AgentPlanActionResult = {
    ok: false,
    intent: "play-plan",
    error: "busy",
  };
  const { result } = renderHook(() => usePlanRun(history, command));
  expect(result.current.runs).toEqual([polled, history[1]]);
  expect(result.current.run).toBe(polled);
});

it("shows a polled run the history does not know yet", () => {
  const { result } = renderHook(() => usePlanRun([run("known")], undefined));
  const fresh = run("fresh");
  polling(fresh);
  act(() => result.current.select("fresh"));
  expect(result.current.run).toBe(fresh);
  polling(run("other"));
  act(() => result.current.select("missing"));
  expect(result.current.run).toBeNull();
});

it("hides the run while polling fails", () => {
  polling(undefined, "plan_connection_unavailable");
  const { result } = renderHook(() => usePlanRun([run("known")], undefined));
  expect(result.current.run).toBeNull();
  expect(result.current.error).toBe("plan_connection_unavailable");
});
