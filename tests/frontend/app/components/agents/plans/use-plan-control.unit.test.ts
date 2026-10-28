import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";

import { usePlanControl } from "@/app/components/agents/plans/use-plan-control";
import { usePlanPoll } from "@/app/components/agents/plans/use-plan-poll";

import type { AgentPlanControl } from "@/definition/AgentPlanControl";

vi.mock("@/app/components/agents/plans/use-plan-poll", () => ({
  usePlanPoll: vi.fn(),
}));

function control(status: AgentPlanControl["status"]): AgentPlanControl {
  return {
    runId: null,
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

const INITIAL = control("idle");

beforeEach(() => {
  vi.resetAllMocks();
});

it("polls the plan's control and prefers the polled state", () => {
  const polled = control("running");
  vi.mocked(usePlanPoll).mockReturnValue({
    response: { ok: true, intent: "poll", control: polled },
    error: null,
  });
  const command = { ok: true as const, intent: "play-plan" };
  const { result } = renderHook(() =>
    usePlanControl("plan 1", INITIAL, command),
  );
  expect(usePlanPoll).toHaveBeenCalledWith(
    "/agent-api/plan-runs?planId=plan%201",
    command,
  );
  expect(result.current).toEqual({ control: polled, error: null });
});

it("keeps the initial control without a polled one", () => {
  vi.mocked(usePlanPoll)
    .mockReturnValueOnce({
      response: { ok: true, intent: "poll" },
      error: null,
    })
    .mockReturnValueOnce({
      response: { ok: false, intent: "poll", error: "forbidden" },
      error: "forbidden",
    });
  expect(
    renderHook(() => usePlanControl("plan", INITIAL, undefined)).result.current
      .control,
  ).toBe(INITIAL);
  expect(
    renderHook(() => usePlanControl("plan", INITIAL, undefined)).result.current,
  ).toEqual({ control: INITIAL, error: "forbidden" });
});

it("does not poll an unsaved plan", () => {
  vi.mocked(usePlanPoll).mockReturnValue({ response: undefined, error: null });
  const { result } = renderHook(() =>
    usePlanControl(undefined, undefined, undefined),
  );
  expect(usePlanPoll).toHaveBeenCalledWith(null, undefined);
  expect(result.current).toEqual({ control: undefined, error: null });
});
