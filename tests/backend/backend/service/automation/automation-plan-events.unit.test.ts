import { expect, it, vi } from "vitest";

import { AutomationPlanEvents } from "@/backend/service/automation/AutomationPlanEvents";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AutomationEventRepository } from "@/backend/database/repositories/automation/AutomationEventRepository";
import type { AgentPlanRun } from "@/definition/AgentPlan";

const run = partial<AgentPlanRun>({
  id: "run",
  planId: "plan",
  planName: "Plan",
  userId: "user",
  status: "running",
  steps: [{ id: "step", name: "Step", status: "waiting" }],
});

it("records starts and meaningful step and terminal transitions", () => {
  const record = vi.fn<AutomationEventRepository["record"]>(
    async () => undefined,
  );
  const observer = new AutomationPlanEvents(
    { record },
    () => new Date("2026-01-01T00:00:00Z"),
  );
  observer.runStarted(run);
  observer.runChanged(
    run,
    partial<AgentPlanRun>({
      ...run,
      status: "succeeded",
      steps: [{ id: "step", name: "Step", status: "succeeded" }],
    }),
  );
  expect(record).toHaveBeenCalledTimes(3);
  expect(record.mock.calls.map(([entry]) => entry.eventType)).toEqual([
    "plan.started",
    "plan.step_changed",
    "plan.succeeded",
  ]);
  const payload: unknown = JSON.parse(record.mock.calls[1][0].payload);
  expect(payload).toMatchObject({
    plan: { id: "plan", name: "Plan" },
    run: { id: "run", status: "succeeded" },
    step: { id: "step", status: "succeeded" },
  });
});

it("does not report unchanged steps or repeated terminal states", () => {
  const record = vi.fn<AutomationEventRepository["record"]>(
    async () => undefined,
  );
  const observer = new AutomationPlanEvents({ record });
  observer.runChanged(run, run);
  const ended = partial<AgentPlanRun>({ ...run, status: "succeeded" });
  observer.runChanged(ended, ended);
  expect(record).not.toHaveBeenCalled();
});
