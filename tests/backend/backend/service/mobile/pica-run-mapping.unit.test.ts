import { expect, it } from "vitest";

import {
  toDashboardRun,
  toPicaMobileFlowStatus,
  toPicaMobileNotificationRunStatus,
  toPicaMobileRunStatus,
} from "@/backend/service/mobile/PicaMobileRunMapping";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanActiveRun } from "@/backend/service/agents/AgentPlanActiveRuns";

it("maps run and step states to the supported protocol vocabulary", () => {
  expect(toPicaMobileRunStatus("succeeded")).toBe("completed");
  expect(toPicaMobileRunStatus("work_done_closeout_open")).toBe("failed");
  expect(toPicaMobileNotificationRunStatus("work_done_closeout_open")).toBe(
    "failed",
  );
  expect(toPicaMobileNotificationRunStatus("succeeded")).toBe("succeeded");
  expect(toPicaMobileFlowStatus({ status: "skipped" })).toBe("skipped");
  expect(toPicaMobileFlowStatus({ status: "waiting", isBlocked: true })).toBe(
    "blocked",
  );
  expect(toPicaMobileFlowStatus({ status: "succeeded" })).toBe("completed");
});

it("maps visible planned steps into stages and omits skipped steps", () => {
  const entry = partial<AgentPlanActiveRun>({
    canResume: true,
    run: {
      id: "run",
      planId: "plan",
      planName: "Plan",
      userId: "owner",
      status: "running",
      steps: [
        {
          id: "a",
          name: "A",
          status: "running",
          progress: { tickets: [{ key: "PAGE-1" }] },
        },
        { id: "b", name: "B", status: "waiting", isBlocked: true },
        { id: "c", name: "C", status: "skipped" },
      ],
    },
    stages: [
      [
        { id: "a", number: 1, isLoop: false },
        { id: "b", number: 2, isLoop: false },
      ],
      [{ id: "c", number: 3, isLoop: false }],
    ],
  });
  expect(toDashboardRun(entry)).toMatchObject({
    id: "run",
    ticket: "PAGE-1",
    canResume: true,
    stages: [
      {
        id: "stage-a",
        kind: "parallel",
        steps: [
          { id: "a", status: "running" },
          { id: "b", status: "blocked" },
        ],
      },
    ],
  });
});
