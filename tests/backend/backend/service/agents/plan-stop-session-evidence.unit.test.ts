import { expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { savePlanSession } from "@/backend/service/agents/AgentPlanSessionPersistence";
import { stoppedPlanRun } from "@/backend/service/agents/AgentPlanStop";
import { createNodeRun } from "@/backend/service/agents/AgentPlanNodeRun";
import { controlledPlanSessionTurn } from "@/backend/service/agents/AgentPlanTurnControl";

import { recoveryFixture } from "./page84-recovery-fixture";
import { groupFixture } from "./page73-group-fixture";

import type {
  PlanExecution,
  PlanSessionTurn,
} from "@/backend/agents/AgentPlanExecution";
import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanRun } from "@/definition/AgentPlan";

async function stoppedContext(): Promise<{
  readonly active: ActivePlanRun;
  readonly record: AgentPlanSessionRecord;
  readonly saved: AgentPlanRun[];
  readonly save: (session: AgentPlanSessionRecord) => Promise<void>;
}> {
  const fixture = await recoveryFixture();
  const original = fixture.completed.steps[0].session;
  if (!original) throw new Error("Missing completed session");
  const record: AgentPlanSessionRecord = { ...original, closeout: "pending" };
  const active: ActivePlanRun = {
    view: stoppedPlanRun({
      ...fixture.completed,
      steps: fixture.completed.steps.map((step) =>
        step.id === "a" ? { ...step, session: record } : step,
      ),
    }),
    snapshot: fixture.snapshot,
    controllers: new Map(),
    dispatched: new Set(),
    executions: new Set(),
    groupCloseout: "open",
    hasPersistenceFailure: false,
  };
  const saved: AgentPlanRun[] = [];
  const dependencies = {
    writes: new SerialQueue(),
    runs: {
      update: async (run: AgentPlanRun) => {
        saved.push(structuredClone(run));
      },
    },
  };
  return {
    active,
    record,
    saved,
    save: (session) => savePlanSession(active, "a", session, dependencies),
  };
}

it("records cleanup after Stop without replacing accepted work or reopening the run", async () => {
  const { active, record, saved, save } = await stoppedContext();
  await save({
    ...record,
    closeout: "confirmed",
    sessionId: "late-session",
    acceptance: null,
    dispatchedPromptDigest: "late-prompt",
    endedAt: "2026-11-14T00:00:00Z",
    containment: "pid_namespace",
    leftoverProcesses: 0,
  });
  expect(saved).toHaveLength(1);
  expect(active.view.status).toBe("cancelled");
  expect(active.view.stopRequested).toBe(true);
  expect(active.view.steps[0]).toMatchObject({
    status: "succeeded",
    output: "immutable A result",
    session: {
      closeout: "confirmed",
      sessionId: record.sessionId,
      acceptance: record.acceptance,
      dispatchedPromptDigest: record.dispatchedPromptDigest,
      containment: "pid_namespace",
      leftoverProcesses: 0,
    },
  });
  await save({ ...record, closeout: "failed" });
  expect(active.view.steps[0].session?.closeout).toBe("confirmed");
});

it.each(["instance", "attempt"] as const)(
  "ignores cleanup for a different %s after Stop",
  async (identity) => {
    const { record, saved, save } = await stoppedContext();
    await save({
      ...record,
      closeout: "confirmed",
      ...(identity === "instance"
        ? { instanceId: "other" }
        : { attemptId: "other" }),
    });
    expect(saved).toEqual([]);
  },
);

it.each([
  {
    reason: undefined,
    isConfirmed: true,
    expected: { status: "cancelled", cancellation: "confirmed" },
  },
  {
    reason: new DOMException("Timeout", "TimeoutError"),
    isConfirmed: true,
    expected: { status: "failed", error: "timeout" },
  },
  {
    reason: undefined,
    isConfirmed: false,
    expected: { status: "failed", error: "plan_closeout_failed" },
  },
])(
  "settles an unresolved turn on abort, preserving timeout and cleanup failures ($expected)",
  async ({ reason, isConfirmed, expected }) => {
    const fixture = await groupFixture();
    const controller = new AbortController();
    const close = vi.fn(async () => ({
      exit: { code: 0, signal: null },
      endedAt: "2026-11-14T00:00:00Z",
      leftovers: isConfirmed ? 0 : 1,
      isConfirmed,
    }));
    const open = vi.fn<PlanExecution["open"]>(async (input) => {
      await input.beforeStart?.();
      return {
        turn: new Promise<PlanSessionTurn>(() => undefined),
        next: vi.fn(),
        close,
      };
    });
    const runner = new AgentPlanStepRunner({
      start: fixture.base.start,
      execution: { open, run: vi.fn() },
      tasks: { checklist: vi.fn() },
      access: { grant: async () => null, revoke: async () => 0 },
    });
    const pending = runner.run(
      fixture.base.run,
      fixture.snapshot,
      fixture.snapshot.steps[0],
      {
        signal: controller.signal,
        save: async () => undefined,
      },
    );
    await expect.poll(() => open.mock.calls.length).toBe(1);
    controller.abort(reason);
    const result = await pending;
    expect(result).toMatchObject(expected);
    expect(result.session?.closeout).toBe(isConfirmed ? "confirmed" : "failed");
    expect(close).toHaveBeenCalled();
    expect(open).toHaveBeenCalledOnce();
  },
);

it.each([false, true])(
  "observes a rejected provider turn without losing its error (already aborted: %s)",
  async (isAborted) => {
    const { active } = await stoppedContext();
    const controller = new AbortController();
    if (isAborted) controller.abort();
    const node = createNodeRun(
      active.view,
      active.snapshot,
      active.snapshot.steps[0],
      {
        signal: controller.signal,
        save: async () => undefined,
      },
    );
    const failure = new Error("Provider turn failed");
    const cleanup = {
      close: vi.fn(async () => ({
        closed: {
          exit: null,
          endedAt: "2026-11-14T00:00:00Z",
          leftovers: 0,
          isConfirmed: true,
        },
        hasRecovered: false,
      })),
      save: vi.fn(async () => undefined),
    };
    const pending = controlledPlanSessionTurn(
      node,
      {
        turn: Promise.reject(failure),
      },
      cleanup,
    );
    if (isAborted) {
      await expect(pending).resolves.toBeNull();
      expect(cleanup.close).toHaveBeenCalledOnce();
      expect(cleanup.save).toHaveBeenCalledOnce();
    } else {
      await expect(pending).rejects.toBe(failure);
      expect(cleanup.close).not.toHaveBeenCalled();
      expect(cleanup.save).not.toHaveBeenCalled();
    }
  },
);
