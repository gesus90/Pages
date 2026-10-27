import { afterEach, expect, it, vi } from "vitest";

import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { AgentError } from "@/backend/error/AgentErrors";
import {
  classifyPlanFailure,
  planRecoveryReason,
} from "@/backend/service/agents/recovery/AgentPlanFailure";

import { parameterRunFixture } from "./page55-run-fixture";
import { progressRun, progressStep } from "./page162-progress-fixture";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

afterEach(() => {
  vi.useRealTimers();
});

async function engineFixture(hasGate: boolean): Promise<{
  readonly engine: AgentPlanRunEngine;
  readonly gate: AgentPlanWorkGate;
  readonly observed: Map<string, AgentPlanRun>;
  readonly successor: ReturnType<typeof vi.fn>;
  readonly snapshot: Awaited<
    ReturnType<typeof parameterRunFixture>
  >["snapshot"];
}> {
  const fixture = await parameterRunFixture();
  const completionGate = hasGate
    ? { version: 1 as const, requiredChecks: ["focused"] }
    : undefined;
  const node = {
    ...fixture.step.step,
    completion: "todos" as const,
    completionGate,
  };
  const end = { id: "harmless-marker", type: "end" as const, x: 500, y: 0 };
  const snapshot = {
    ...fixture.snapshot,
    plan: {
      ...fixture.snapshot.plan,
      nodes: [node, end],
      edges: [
        { from: node.id, to: end.id, fromPort: "flow-out", toPort: "flow-in" },
      ],
    },
    steps: [{ ...fixture.step, step: node }],
  };
  const transaction: DatabaseTransaction = { query: vi.fn(), execute: vi.fn() };
  const gate = new AgentPlanWorkGate(
    { transaction: async (work) => work(transaction) },
    { getById: vi.fn() },
  );
  vi.spyOn(gate, "preflight").mockResolvedValue();
  const observed = new Map<string, AgentPlanRun>();
  const successor = vi.fn();
  const store = async (run: AgentPlanRun): Promise<void> => {
    observed.set(run.id, run);
  };
  const engine = new AgentPlanRunEngine({
    workGate: gate,
    runs: {
      create: store,
      insert: vi.fn(),
      update: store,
      find: async (id) => observed.get(id) ?? null,
    },
    start: {
      control: async () => {
        successor();
      },
    },
    steps: {
      closeGroups: async () => {},
      run: async () => ({
        status: "succeeded",
        output: '{"status":"done","message":"unchanged final JSON"}',
      }),
    },
  });
  return { engine, gate, observed, successor, snapshot };
}

it("prevents a harmless successor despite provider success when the current work gate refuses", async () => {
  vi.useFakeTimers();
  const world = await engineFixture(true);
  vi.spyOn(world.gate, "verify").mockRejectedValue(
    new AgentError("plan_work_gate_failed"),
  );
  const run = await world.engine.start("owner", world.snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(world.observed.get(run.id)?.status).toBe("failed");
  expect(world.successor).not.toHaveBeenCalled();
  await world.engine.shutdown();
});

it("rechecks a previously confirmed predecessor before the successor and catches a new ticket change", async () => {
  vi.useFakeTimers();
  const world = await engineFixture(true);
  const verify = vi
    .spyOn(world.gate, "verify")
    .mockResolvedValueOnce([])
    .mockRejectedValue(new AgentError("plan_work_gate_failed"));
  const run = await world.engine.start("owner", world.snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(verify).toHaveBeenCalledTimes(2);
  expect(world.observed.get(run.id)?.status).toBe("failed");
  expect(world.successor).not.toHaveBeenCalled();
  await world.engine.shutdown();
});

it("releases the harmless successor only with confirmed current work", async () => {
  vi.useFakeTimers();
  const world = await engineFixture(true);
  vi.spyOn(world.gate, "verify").mockResolvedValue([]);
  const run = await world.engine.start("owner", world.snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(world.observed.get(run.id)?.status).toBe("succeeded");
  expect(world.successor).toHaveBeenCalledOnce();
  expect(world.observed.get(run.id)?.steps[0]?.output).toBe(
    '{"status":"done","message":"unchanged final JSON"}',
  );
  await world.engine.shutdown();
});

it("retains diagnostic semantics of existing plans without the explicit opt-in", async () => {
  vi.useFakeTimers();
  const world = await engineFixture(false);
  const verify = vi
    .spyOn(world.gate, "verify")
    .mockRejectedValue(new AgentError("plan_work_gate_failed"));
  const run = await world.engine.start("owner", world.snapshot);
  await vi.advanceTimersByTimeAsync(0);
  expect(world.observed.get(run.id)?.status).toBe("succeeded");
  expect(world.successor).toHaveBeenCalledOnce();
  expect(verify).not.toHaveBeenCalled();
  await world.engine.shutdown();
});

it.each([
  ["plan_work_gate_failed", "business"],
  ["plan_work_gate_unavailable", "configuration"],
  ["plan_work_gate_write_required", "approval"],
] as const)(
  "offers explicit reconciliation and recovery for %s",
  (error, classification) => {
    const step = progressStep({ status: "failed", error });
    expect(classifyPlanFailure(step)).toBe(classification);
    expect(
      planRecoveryReason({ ...progressRun([step]), status: "failed" }),
    ).toEqual({ state: "recoverable", requiresReconciliation: true });
  },
);
