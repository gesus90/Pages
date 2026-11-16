import { expect, it } from "vitest";

import {
  diffPlanRows,
  selectPlanRows,
  toPlanRow,
  truncatePlanText,
} from "@/backend/service/mobile/plans/PicaMobilePlanRows";
import { PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH } from "@/definition/PicaMobileProtocol";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanOverviewEntry } from "@/backend/service/agents/AgentPlanOverview";
import type { PicaMobilePlanRow } from "@/definition/PicaMobileProtocol";

it("maps idle and running plans and includes state only when requested", () => {
  const idle = partial<AgentPlanOverviewEntry>({
    planId: "plan",
    name: "Plan",
    run: null,
  });
  expect(toPlanRow(idle, { withState: false })).toEqual({
    id: "plan",
    name: "Plan",
    status: "idle",
  });
  const running = partial<AgentPlanOverviewEntry>({
    ...idle,
    run: {
      id: "run",
      status: "running",
      at: "2030-01-01",
      runningSteps: ["One", "Two"],
      completedSteps: 1,
      totalSteps: 3,
      failure: null,
      state: { sample: true },
    },
  });
  expect(toPlanRow(running, { withState: false })).toMatchObject({
    runId: "run",
    status: "running",
    step: "One, Two",
    at: "2030-01-01T00:00:00.000Z",
    done: 1,
    total: 3,
  });
  expect(toPlanRow(running, { withState: true })).toHaveProperty("state");
  expect(
    toPlanRow(
      { ...idle, planId: "x".repeat(PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH + 1) },
      { withState: false },
    ),
  ).toBeNull();
});

it("truncates without leaving a partial Unicode surrogate", () => {
  const prefix = "a".repeat(PICA_MOBILE_MAXIMUM_PLAN_TEXT_LENGTH - 1);
  expect(truncatePlanText(`${prefix}😀more`)).toBe(prefix);
  expect(truncatePlanText("short")).toBe("short");
});

it("sorts running failures first and reports only changed and removed rows", () => {
  const rows: PicaMobilePlanRow[] = [
    { id: "idle", name: "Idle", status: "idle" },
    { id: "running", name: "Running", status: "running" },
    {
      id: "failure",
      name: "Failure",
      status: "running",
      error: { code: "error", step: null },
    },
    { id: "paused", name: "Paused", status: "paused" },
  ];
  expect(selectPlanRows(rows).map((row) => row.id)).toEqual([
    "failure",
    "running",
    "paused",
    "idle",
  ]);
  const previous = new Map(rows.map((row) => [row.id, row]));
  const next: PicaMobilePlanRow[] = [
    { id: "running", name: "Running", status: "paused" },
    { id: "new", name: "New", status: "idle" },
  ];
  expect(diffPlanRows(previous, next)).toMatchObject({
    plans: [{ id: "running", status: "paused" }, next[1]],
    removed: ["idle", "failure", "paused"],
  });
});
