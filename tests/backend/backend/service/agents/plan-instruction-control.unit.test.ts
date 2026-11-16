import { expect, it, vi } from "vitest";

import {
  restorePlanInstruction,
  runPlanInstruction,
} from "@/backend/service/agents/AgentPlanInstructionControl";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { PlanSessionTurn } from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";

function setup(): {
  active: ActivePlanRun;
  persistence: Parameters<typeof runPlanInstruction>[1];
  update: ReturnType<typeof vi.fn>;
  settled: ReturnType<typeof vi.fn>;
} {
  const active = partial<ActivePlanRun>({
    view: {
      status: "running",
      stopRequested: false,
      steps: [{ id: "waiting", status: "waiting" }],
    },
    controllers: new Map(),
    dispatched: new Set(),
  });
  const update = vi.fn();
  const settled = vi.fn();
  const persistence = partial<Parameters<typeof runPlanInstruction>[1]>({
    writes: { run: async (work: () => Promise<unknown>) => work() },
    runs: { update },
    settled,
  });
  return { active, persistence, update, settled };
}
const success = partial<PlanSessionTurn>({ failure: null, errorCode: null });

it("registers and cleans up a dispatched instruction", async () => {
  const { active, persistence, settled, update } = setup();
  const result = await runPlanInstruction(
    active,
    persistence,
    async (control) => {
      expect(active.controllers.size).toBe(1);
      control.claimStart();
      expect(active.dispatched.size).toBe(1);
      return success;
    },
  );
  expect(result).toBe(success);
  expect(active.controllers.size).toBe(0);
  expect(active.dispatched.size).toBe(0);
  expect(update).not.toHaveBeenCalled();
  expect(settled).toHaveBeenCalledOnce();
});

it("pauses waiting work after a failed dispatched instruction", async () => {
  const { active, persistence, update } = setup();
  await runPlanInstruction(active, persistence, async (control) => {
    control.claimStart();
    return partial<PlanSessionTurn>({ failure: "failed", errorCode: null });
  });
  expect(active.view).toMatchObject({
    status: "pausing",
    controlError: "plan_step_failed",
    steps: [{ status: "paused" }],
  });
  expect(update).toHaveBeenCalledOnce();
});

it("refuses work after a run stops and settles restored failures", async () => {
  const { active, persistence, update, settled } = setup();
  active.view = { ...active.view, status: "paused" };
  await expect(
    runPlanInstruction(active, persistence, async () => success),
  ).rejects.toThrow();
  active.view = { ...active.view, status: "running" };
  await restorePlanInstruction(active, persistence, {
    instanceId: "instance",
    pending: Promise.resolve(
      partial<PlanSessionTurn>({ failure: "failed", errorCode: null }),
    ),
  });
  expect(update).toHaveBeenCalledOnce();
  expect(settled).toHaveBeenCalledOnce();
  expect(active.controllers.size).toBe(0);
});
