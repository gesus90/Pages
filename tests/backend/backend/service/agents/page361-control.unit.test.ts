import { afterEach, expect, it, vi } from "vitest";

import {
  planResume,
  resumeOption,
} from "@/backend/service/agents/recovery/AgentPlanRecoveryPlanning";
import {
  planControl,
  planResumeKind,
} from "@/backend/service/agents/AgentPlanControl";
import {
  usesImmediateCodexPause,
  waitForCodexResume,
} from "@/backend/service/agents/AgentPlanImmediatePause";

import { codexControlFixture } from "./page361-control-fixture";
import { planView } from "./agent-plan-service-harness";

const scripts = vi.hoisted(() => ({ pause: vi.fn(async () => undefined) }));
vi.mock("@/backend/service/agents/AgentPlanScriptPause", () => ({
  setScriptRunPaused: scripts.pause,
}));

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("pauses a pending Codex turn immediately and preserves its controller, session and results through three resumes", async () => {
  const fixture = await codexControlFixture();
  const before = structuredClone(fixture.active.view.steps[0]);
  for (let iteration = 0; iteration < 3; iteration += 1) {
    await fixture.commands.pause(fixture.active.view.id);
    expect(fixture.stored().status).toBe("paused");
    expect(fixture.active.view.steps[0]).toEqual(before);
    expect(fixture.controller.signal.aborted).toBe(false);
    expect(fixture.active.controllers.get("a")).toBe(fixture.controller);
    expect(fixture.nativePause).toHaveBeenLastCalledWith(
      fixture.active.view.id,
      true,
    );
    await fixture.commands.resume(fixture.active.view.id);
    expect(fixture.stored().status).toBe("running");
    expect(fixture.active.view.steps[0]).toEqual(before);
    expect(fixture.nativePause).toHaveBeenLastCalledWith(
      fixture.active.view.id,
      false,
    );
  }
  expect(scripts.pause).toHaveBeenCalledTimes(6);
});

it("acknowledges paused only after native suspension and never releases a lease or aborts the turn", async () => {
  const fixture = await codexControlFixture();
  let confirm = (): void => undefined;
  fixture.nativePause.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        confirm = resolve;
      }),
  );
  const pending = fixture.commands.pause(fixture.active.view.id);
  await vi.waitFor(() => expect(fixture.stored().status).toBe("pausing"));
  expect(fixture.controller.signal.aborted).toBe(false);
  confirm();
  await pending;
  expect(fixture.stored().status).toBe("paused");
});

it("allows a first-click Stop during a pause and rejects continuation afterwards", async () => {
  const fixture = await codexControlFixture();
  await fixture.commands.pause(fixture.active.view.id);
  await fixture.commands.stop(fixture.active.view.id);
  expect(fixture.stored()).toMatchObject({
    status: "cancelled",
    stopRequested: true,
  });
  expect(fixture.stored().steps[0]?.status).toBe("cancelled");
  expect(fixture.controller.signal.aborted).toBe(true);
  await expect(
    fixture.commands.resume(fixture.active.view.id),
  ).rejects.toMatchObject({ code: "plan_run_unavailable" });
  const stopped = { ...fixture.stored(), status: "cancelled" as const };
  const control = planControl(planView(), stopped, {
    userId: stopped.userId,
    hasReservation: false,
  });
  expect(control).toMatchObject({
    canResume: false,
    canPause: false,
    canStop: false,
    canPlay: true,
    startWithoutConfirmation: true,
  });
  expect(planResumeKind(stopped)).toBeNull();
});

it("preserves the existing pause path for Claude and refuses edited execution context during a suspended Codex turn", async () => {
  const fixture = await codexControlFixture();
  expect(
    usesImmediateCodexPause({
      ...fixture.active.snapshot,
      steps: fixture.active.snapshot.steps.map((step) => ({
        ...step,
        provider: "claude_code",
      })),
    }),
  ).toBe(false);
  await fixture.commands.pause(fixture.active.view.id);
  await expect(
    fixture.commands.resume(fixture.active.view.id, {
      ...fixture.active.snapshot,
      plan: {
        ...fixture.active.snapshot.plan,
        revision: fixture.active.snapshot.plan.revision + 1,
      },
    }),
  ).rejects.toMatchObject({ code: "plan_context_changed" });
  expect(fixture.stored().status).toBe("paused");
});

it("holds a completed turn at pause and releases it only on resume, while Stop cancels the wait", async () => {
  const fixture = await codexControlFixture();
  vi.useFakeTimers();
  fixture.active.view = { ...fixture.active.view, status: "paused" };
  const finished = vi.fn();
  const waiting = waitForCodexResume(
    () => fixture.active.view,
    fixture.controller.signal,
  ).then(finished);
  await vi.advanceTimersByTimeAsync(500);
  expect(finished).not.toHaveBeenCalled();
  fixture.active.view = { ...fixture.active.view, status: "running" };
  await vi.advanceTimersByTimeAsync(25);
  await waiting;
  expect(finished).toHaveBeenCalledOnce();
  fixture.active.view = { ...fixture.active.view, status: "paused" };
  const stopped = waitForCodexResume(
    () => fixture.active.view,
    fixture.controller.signal,
  );
  fixture.controller.abort();
  await expect(stopped).resolves.toBeUndefined();
  expect(fixture.controller.signal.aborted).toBe(true);
});

it("refuses recovery of an explicitly stopped Codex run through the recovery API as well", async () => {
  const fixture = await codexControlFixture();
  const run = {
    ...fixture.active.view,
    status: "cancelled" as const,
    stopRequested: true,
  };
  const facts = {
    run,
    plan: planView(),
    latest: run,
    isReserved: false,
    isEngineActive: false,
    checkpoints: [],
    executions: [],
    agentStepIds: ["a", "b", "c"],
    groupIds: [],
  };
  expect(resumeOption(facts, planResume(facts))).toEqual({
    available: false,
    reason: "cancelled_by_user",
  });
});
