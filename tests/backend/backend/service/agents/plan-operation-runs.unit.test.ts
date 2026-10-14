import { beforeEach, expect, it } from "vitest";

import { AgentOperationError } from "@/backend/error/AgentOperationError";

import { PlanWorld, runnablePlan } from "./plan-operation-world";

import type {
  AgentPlanReportList,
  AgentPlanRunList,
  AgentPlanRunRead,
} from "@/definition/AgentPlanOperations";

let world: PlanWorld;

async function refusal(
  promise: Promise<unknown>,
): Promise<AgentOperationError> {
  try {
    await promise;
  } catch (error: unknown) {
    if (error instanceof AgentOperationError) return error;
    throw error;
  }
  throw new Error("The call was not refused.");
}

function startedAt(minute: number): string {
  return `2026-10-14T10:${String(minute).padStart(2, "0")}:00.000Z`;
}

beforeEach(() => {
  world = new PlanWorld();
  world.seed(runnablePlan("plan-a", { name: "Alpha review" }));
  world.seed(runnablePlan("plan-b", { name: "Beta build" }));
  world.seed({
    ...runnablePlan("plan-private", {
      name: "Alpha private",
      ownerId: "reader",
    }),
    usage: "private",
  });
});

beforeEach(() => {
  for (let minute = 1; minute <= 25; minute += 1)
    world.addRun({
      id: `run-${String(minute).padStart(2, "0")}`,
      planId: "plan-a",
      startedAt: startedAt(minute),
      status: minute % 2 === 0 ? "failed" : "succeeded",
    });
  world.addRun({
    id: "run-reader",
    planId: "plan-a",
    userId: "reader",
    startedAt: startedAt(30),
  });
  world.addRun({
    id: "run-other-plan",
    planId: "plan-b",
    startedAt: startedAt(40),
  });
});

it("lists the person's runs newest first in pages of twenty, each with date, status and plan", async () => {
  const first = (await world.call("owner", "plans.runs.list", {
    planId: "plan-a",
  })) as AgentPlanRunList;
  const second = (await world.call("owner", "plans.runs.list", {
    planId: "plan-a",
    cursor: first.nextCursor,
  })) as AgentPlanRunList;

  expect(first.total).toBe(25);
  expect(first.runs).toHaveLength(20);
  expect(first.runs[0]).toEqual({
    runId: "run-25",
    planId: "plan-a",
    planName: "Alpha review",
    startedAt: startedAt(25),
    status: "succeeded",
  });
  expect(second.runs.map((run) => run.runId)).toEqual([
    "run-05",
    "run-04",
    "run-03",
    "run-02",
    "run-01",
  ]);
  expect(second.nextCursor).toBeNull();
  expect(
    [...first.runs, ...second.runs].every((run) => run.planId === "plan-a"),
  ).toBe(true);
});

it("lists them oldest first and with a chosen page size", async () => {
  const oldest = (await world.call("owner", "plans.runs.list", {
    planId: "plan-a",
    order: "oldest",
    limit: 3,
  })) as AgentPlanRunList;

  expect(oldest.order).toBe("oldest");
  expect(oldest.runs.map((run) => run.runId)).toEqual([
    "run-01",
    "run-02",
    "run-03",
  ]);
  expect(oldest.runs[1].status).toBe("failed");
});

it("refuses a cursor of another query", async () => {
  const newest = (await world.call("owner", "plans.runs.list", {
    planId: "plan-a",
    limit: 2,
  })) as AgentPlanRunList;

  const refused = await refusal(
    world.call("owner", "plans.runs.list", {
      planId: "plan-a",
      order: "oldest",
      cursor: newest.nextCursor,
    }),
  );

  expect(refused.code).toBe("INVALID_REQUEST");
});

it("selects the newest, the first or a named run", async () => {
  const latest = (await world.call("owner", "plans.run.read", {
    planId: "plan-a",
    select: "latest",
  })) as AgentPlanRunRead;
  const first = (await world.call("owner", "plans.run.read", {
    planId: "plan-a",
    select: "first",
  })) as AgentPlanRunRead;
  const named = (await world.call("owner", "plans.run.read", {
    runId: "run-07",
  })) as AgentPlanRunRead;

  expect(latest.run).toMatchObject({ runId: "run-25", planId: "plan-a" });
  expect(first.run).toMatchObject({
    runId: "run-01",
    startedAt: startedAt(1),
  });
  expect(named.run).toMatchObject({
    runId: "run-07",
    planId: "plan-a",
    planName: "Alpha review",
    status: "succeeded",
    steps: [
      { stepId: "start", status: "succeeded", hasReport: false },
      { stepId: "review", status: "succeeded", hasReport: true },
      { stepId: "end", status: "succeeded", hasReport: false },
    ],
  });
});

it("refuses runs of other people, of another plan and of plans without runs", async () => {
  const foreign = await refusal(
    world.call("owner", "plans.run.read", { runId: "run-reader" }),
  );
  const otherPlan = await refusal(
    world.call("owner", "plans.run.read", {
      runId: "run-other-plan",
      planId: "plan-a",
    }),
  );
  const none = await refusal(
    world.call("reader", "plans.run.read", {
      planId: "plan-b",
      select: "latest",
    }),
  );
  const listed = (await world.call("reader", "plans.runs.list", {
    planId: "plan-a",
  })) as AgentPlanRunList;

  expect([foreign.code, otherPlan.code, none.code]).toEqual([
    "NOT_FOUND",
    "NOT_FOUND",
    "NOT_FOUND",
  ]);
  expect(listed.runs.map((run) => run.runId)).toEqual(["run-reader"]);
});

it("reads the reports of a selected run, each bound to that run", async () => {
  const reports = (await world.call("owner", "plans.run.reports.read", {
    planId: "plan-a",
    select: "latest",
  })) as AgentPlanReportList;
  const single = (await world.call("owner", "plans.run.reports.read", {
    runId: "run-03",
    stepId: "review",
  })) as AgentPlanReportList;

  expect(reports.run).toMatchObject({ runId: "run-25", planId: "plan-a" });
  expect(reports.reports).toEqual([
    expect.objectContaining({
      runId: "run-25",
      planId: "plan-a",
      stepId: "review",
      output: "Synthetic result",
    }),
  ]);
  expect(single.reports.map((report) => [report.runId, report.stepId])).toEqual(
    [["run-03", "review"]],
  );
  expect(
    (
      await refusal(
        world.call("owner", "plans.run.reports.read", {
          runId: "run-03",
          stepId: "start",
        }),
      )
    ).code,
  ).toBe("NOT_FOUND");
});
