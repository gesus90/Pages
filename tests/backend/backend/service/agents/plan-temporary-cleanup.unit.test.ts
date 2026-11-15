import { beforeEach, expect, it, vi } from "vitest";

import {
  removePlanTemporaryRun,
  temporaryPlanRunIds,
} from "@/backend/agents/PlanRunTemporaryDirectory";
import {
  cleanupEndedPlanTemporaryDirectory,
  cleanupOrphanedPlanTemporaryDirectories,
} from "@/backend/service/agents/AgentPlanTemporaryCleanup";
import { hasNoSessionProcesses } from "@/backend/service/agents/AgentPlanRecovery";

import type { AgentPlanRun } from "@/definition/AgentPlan";

vi.mock("@/backend/agents/PlanRunTemporaryDirectory", () => ({
  removePlanTemporaryRun: vi.fn(async () => undefined),
  temporaryPlanRunIds: vi.fn(async () => ["run"]),
}));
vi.mock("@/backend/service/agents/AgentPlanRecovery", () => ({
  hasNoSessionProcesses: vi.fn(async () => true),
}));

function run(status: AgentPlanRun["status"]): AgentPlanRun {
  return {
    id: "run",
    planId: "plan",
    planName: "Plan",
    planRevision: 1,
    userId: "owner",
    startedAt: "2026-11-14",
    status,
    stopRequested: false,
    steps: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(hasNoSessionProcesses).mockResolvedValue(true);
});

it.each(["succeeded", "failed", "cancelled"] as const)(
  "deletes a %s run only after process confirmation",
  async (status) => {
    await cleanupEndedPlanTemporaryDirectory(run(status));
    expect(hasNoSessionProcesses).toHaveBeenCalled();
    expect(removePlanTemporaryRun).toHaveBeenCalledWith("run");
  },
);

it.each(["running", "pausing", "paused"] as const)(
  "retains scratch for %s and its later continuation",
  async (status) => {
    await cleanupEndedPlanTemporaryDirectory(run(status));
    expect(hasNoSessionProcesses).not.toHaveBeenCalled();
    expect(removePlanTemporaryRun).not.toHaveBeenCalled();
  },
);

it("retains unconfirmed processes for later reconciliation", async () => {
  vi.mocked(hasNoSessionProcesses).mockResolvedValue(false);
  await cleanupEndedPlanTemporaryDirectory(run("failed"));
  expect(removePlanTemporaryRun).not.toHaveBeenCalled();
});

it("reconciles terminal leftovers at startup while preserving paused and unknown owners", async () => {
  vi.mocked(temporaryPlanRunIds).mockResolvedValue([
    "ended",
    "paused",
    "unknown",
  ]);
  const find = vi.fn(async (id: string) => {
    if (id === "unknown") return null;
    return { ...run(id === "paused" ? "paused" : "failed"), id };
  });
  await cleanupOrphanedPlanTemporaryDirectories(find);
  expect(find).toHaveBeenCalledTimes(3);
  expect(removePlanTemporaryRun).toHaveBeenCalledExactlyOnceWith("ended");
});
