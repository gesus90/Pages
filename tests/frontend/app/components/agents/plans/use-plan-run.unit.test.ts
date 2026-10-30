import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { usePlanPoll } from "@/app/components/agents/plans/use-plan-poll";
import { usePlanRun } from "@/app/components/agents/plans/use-plan-run";

import { syntheticRun } from "../page72-run-fixture";

import type { AgentPlanActionResult } from "@/app/lib/agent-plan-response";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanControl } from "@/definition/AgentPlanControl";

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
  const { result, rerender } = renderHook<
    ReturnType<typeof usePlanRun>,
    { readonly control: AgentPlanControl | undefined }
  >(
    ({ control }: { readonly control: AgentPlanControl | undefined }) =>
      usePlanRun(history, undefined, {
        planId: "synthetic-plan",
        control,
        controlError: null,
      }),
    { initialProps: { control: undefined } },
  );
  expect(usePlanPoll).toHaveBeenCalledWith(
    "/agent-api/plan-runs?runId=new",
    undefined,
    "active",
  );
  expect(result.current.selectedId).toBe("new");
  expect(result.current.run).toBe(history[0]);
  expect(result.current.runs).toBe(history);
  expect(result.current.error).toBeNull();
  const control: AgentPlanControl = {
    runId: "external",
    status: "paused",
    canPlay: true,
    canPause: false,
    canResume: true,
    canStop: true,
    canEdit: true,
    issue: null,
    planRevision: 1,
    continuationVersion: 0,
    frontierStepIds: [],
  };
  const external = run("external", "paused");
  polling(external);
  rerender({ control });
  expect(result.current.selectedId).toBe("external");
  expect(result.current.run).toBe(external);
  expect(result.current.runs[0]).toBe(external);
  act(() => result.current.select("old", "history"));
  rerender({ control: { ...control, runId: "later" } });
  expect(result.current.selectedId).toBe("old");
  expect(result.current.run).toBe(history[1]);
  rerender({ control: { ...control, issue: "plan_access_denied" } });
  expect(result.current.run).toBeNull();
  expect(result.current.runs).toEqual([]);
  expect(result.current.error).toBe("accessDenied");
});

it("polls nothing without any run", () => {
  const { result } = renderHook(() =>
    usePlanRun([], undefined, {
      planId: "synthetic-plan",
      control: undefined,
      controlError: null,
    }),
  );
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
  const { result } = renderHook(() =>
    usePlanRun(history, command, {
      planId: "synthetic-plan",
      control: undefined,
      controlError: null,
    }),
  );
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
  const { result } = renderHook(() =>
    usePlanRun(history, command, {
      planId: "synthetic-plan",
      control: undefined,
      controlError: null,
    }),
  );
  expect(result.current.runs).toEqual([polled, history[1]]);
  expect(result.current.run).toBe(polled);
});

it("shows a polled run the history does not know yet", () => {
  const { result } = renderHook(() =>
    usePlanRun([run("known")], undefined, {
      planId: "synthetic-plan",
      control: undefined,
      controlError: null,
    }),
  );
  const fresh = run("fresh");
  polling(fresh);
  act(() => result.current.select("fresh", "follow"));
  expect(result.current.run).toBe(fresh);
  polling(run("other"));
  act(() => result.current.select("missing", "history"));
  expect(result.current.run).toBeNull();
});

it("hides the run while polling fails", () => {
  polling(undefined, "plan_connection_unavailable");
  const { result } = renderHook(() =>
    usePlanRun([run("known")], undefined, {
      planId: "synthetic-plan",
      control: undefined,
      controlError: null,
    }),
  );
  expect(result.current.run).toBeNull();
  expect(result.current.error).toBe("plan_connection_unavailable");
});
