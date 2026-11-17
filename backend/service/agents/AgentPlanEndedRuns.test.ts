import { randomUUID } from "node:crypto";

import { expect, it, vi } from "vitest";

import { emptyAgentPlan } from "@/definition/AgentPlan";

import { planControl } from "./AgentPlanControl";
import { AgentPlanEndedRuns } from "./AgentPlanEndedRuns";

import type { AgentPlanRun, AgentPlanView } from "@/definition/AgentPlan";
import type { AgentPlanRunJournal } from "./AgentPlanJournal";

function fixtures(): {
  source: AgentPlanRun;
  target: AgentPlanRun;
  plan: AgentPlanView;
} {
  const source: AgentPlanRun = {
    id: randomUUID(),
    planId: randomUUID(),
    planName: "Fixture",
    planRevision: 1,
    userId: "executor",
    startedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    stopRequested: false,
    steps: [],
  };
  const target: AgentPlanRun = {
    ...source,
    id: randomUUID(),
    status: "running",
    origin: {
      kind: "resume",
      runId: source.id,
      mode: "new_session",
      checkpointVersion: null,
      reusedStepIds: [],
      retriedStepIds: [],
      reviewedStepIds: [],
      requestedAt: source.startedAt,
    },
  };
  const plan: AgentPlanView = {
    ...emptyAgentPlan(),
    id: source.planId,
    name: "Fixture",
    ownerId: source.userId,
    projectId: randomUUID(),
    revision: 1,
    canEdit: true,
    projectName: "Fixture",
    github: null,
  };
  return { source, target, plan };
}

it("reuses the linked run after response loss and acknowledges the new command without dispatch", async () => {
  const { source, target, plan } = fixtures();
  const resumeEnded = vi.fn(async () => {
    throw new Error("Must not dispatch again");
  });
  const acknowledge = vi.fn(async (run: AgentPlanRun) => run);
  const readRun = vi.fn(async () => target);
  const service = new AgentPlanEndedRuns({
    advisor: {
      current: {
        resumeEnded,
        resumeAvailability: async () => ({ available: true, reason: null }),
        stopRun: async () => {},
      },
    },
    engine: { isActive: () => false },
    findRun: async () => target,
    readRun,
    acknowledge,
    control: async () =>
      planControl(plan, target, {
        userId: source.userId,
        hasReservation: false,
      }),
  });
  const journal: AgentPlanRunJournal = async () => {};
  expect(await service.resume(source.userId, source, plan, journal)).toEqual(
    target,
  );
  expect(acknowledge).toHaveBeenCalledWith(target, journal);
  expect(readRun).toHaveBeenCalledWith(source.userId, target.id);
  expect(resumeEnded).not.toHaveBeenCalled();
});

it("keeps the operation journal in the initial continuation's admission transaction", async () => {
  const { source, target, plan } = fixtures();
  const resumeEnded = vi.fn(async () => ({
    commandId: randomUUID(),
    revision: 1,
    outcome: "started" as const,
    runId: target.id,
  }));
  const service = new AgentPlanEndedRuns({
    advisor: {
      current: {
        resumeEnded,
        resumeAvailability: async () => ({ available: true, reason: null }),
        stopRun: async () => {},
      },
    },
    engine: { isActive: () => false },
    findRun: async () => source,
    readRun: async () => target,
    acknowledge: async (run) => run,
    control: async () => ({
      ...planControl(plan, source, {
        userId: source.userId,
        hasReservation: false,
      }),
      canResume: true,
    }),
  });
  const journal: AgentPlanRunJournal = async () => {};
  await service.resume(source.userId, source, plan, journal);
  expect(resumeEnded).toHaveBeenCalledWith(
    source.userId,
    source.id,
    plan.revision,
    journal,
  );
});

it("does not reuse or control an unrelated newer run", async () => {
  const { source, target, plan } = fixtures();
  const unrelated = { ...target, origin: undefined };
  const resumeEnded = vi.fn(async () => {
    throw new Error("Must not dispatch");
  });
  const acknowledge = vi.fn(async (run: AgentPlanRun) => run);
  const service = new AgentPlanEndedRuns({
    advisor: {
      current: {
        resumeEnded,
        resumeAvailability: async () => ({ available: true, reason: null }),
        stopRun: async () => {},
      },
    },
    engine: { isActive: () => false },
    findRun: async () => unrelated,
    readRun: async () => unrelated,
    acknowledge,
    control: async () =>
      planControl(plan, unrelated, {
        userId: source.userId,
        hasReservation: false,
      }),
  });
  await expect(service.resume(source.userId, source, plan)).rejects.toThrow();
  expect(acknowledge).not.toHaveBeenCalled();
  expect(resumeEnded).not.toHaveBeenCalled();
});
