import { expect, it } from "vitest";

import { failedPlanStart } from "@/backend/service/agents/AgentPlanStartFailure";
import {
  beginIteration,
  initialLoopRun,
} from "@/backend/service/agents/loop/AgentPlanLoopRecord";
import { emptyPlanLoop } from "@/definition/AgentPlanLoop";
import { allPlanRunResults } from "@/definition/AgentPlanLoopResults";

import { planRun } from "./agent-plan-service-harness";

import type { AgentPlanStepResult } from "@/definition/AgentPlan";

function step(status: AgentPlanStepResult["status"]): AgentPlanStepResult {
  return {
    id: status,
    name: status,
    status,
    isBlocked: status === "waiting" || status === "paused",
    blockedByStepId: "predecessor",
    cancellation: "none",
    output: status === "succeeded" ? "Kept output" : null,
    error: null,
  };
}

it.each(["waiting", "paused", "running"] as const)(
  "settles a %s loop without changing completed history or the original run",
  (status) => {
    const loop = emptyPlanLoop("loop", "Prepare E2E", { x: 0, y: 0 });
    const initial = initialLoopRun(loop);
    const iteration = beginIteration(initial, loop, new Map(), []).iterations[0];
    if (!iteration) throw new Error("Missing fixture iteration");
    const completed = {
      ...iteration,
      status: "succeeded" as const,
      endedAt: "2026-11-13T10:00:00.000Z",
      nodes: [step("succeeded")],
    };
    const pending = {
      ...iteration,
      id: "loop#2",
      number: 2,
      status,
      nodes: [step("waiting"), step("paused"), step("succeeded")],
    };
    const completedLoop = {
      ...initial,
      id: "completed",
      status: "succeeded" as const,
      iterations: [completed],
    };
    const run = planRun({
      isWaitingForWorkspace: true,
      steps: [step("waiting"), step("paused"), step("succeeded")],
      loops: [
        { ...initial, status, iterations: [completed, pending] },
        completedLoop,
      ],
    });

    const failed = failedPlanStart(run, "profile_invalid");

    expect(failed.status).toBe("failed");
    expect(failed.isWaitingForWorkspace).toBeUndefined();
    expect(failed.loops?.[0]).toMatchObject({
      status: "cancelled",
      endedAt: failed.endedAt,
      error: "profile_invalid",
    });
    expect(failed.loops?.[0]?.iterations[0]).toBe(completed);
    expect(failed.loops?.[1]).toBe(completedLoop);
    expect(failed.loops?.[0]?.iterations[1]).toMatchObject({
      status: "cancelled",
      endedAt: failed.endedAt,
      error: "profile_invalid",
    });
    for (const result of allPlanRunResults(failed)) {
      expect(["cancelled", "succeeded"]).toContain(result.status);
      if (result.status === "succeeded") continue;
      expect(result).toMatchObject({
        cancellation: "not_started",
        isBlocked: false,
      });
      expect(result.blockedByStepId).toBeUndefined();
    }
    expect(run.status).toBe("running");
    expect(pending.nodes[0]?.status).toBe("waiting");
    expect(failed.steps[2]).toBe(run.steps[2]);
  },
);

it("keeps runs without loops compatible and stamps one terminal time", () => {
  const failed = failedPlanStart(planRun(), "profile_invalid");

  expect(failed).not.toHaveProperty("loops");
  expect(failed.endedAt).toEqual(expect.any(String));
  expect(failedPlanStart(failed, "profile_invalid").endedAt).toBe(failed.endedAt);
});
