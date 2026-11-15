import { expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentPlanRunCommands } from "@/backend/service/agents/AgentPlanRunCommands";
import {
  isEndedResumable,
  planControl,
} from "@/backend/service/agents/AgentPlanControl";
import { suspendedOpenCodeSessions } from "@/backend/service/agents/AgentPlanRunState";

import { recoveryFixture } from "./page84-recovery-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type {
  AgentPlanRun,
  AgentPlanStepResult,
  AgentPlanView,
} from "@/definition/AgentPlan";

const controls = vi.hoisted(() => ({
  process: vi.fn<
    (run: AgentPlanRun, action: "pause" | "resume" | "stop") => Promise<void>
  >(async () => undefined),
  script: vi.fn<(runId: string, paused: boolean) => Promise<void>>(
    async () => undefined,
  ),
}));
vi.mock("@/backend/service/agents/AgentPlanProcessControl", () => ({
  controlPlanProcesses: controls.process,
}));
vi.mock("@/backend/service/agents/AgentPlanScriptPause", () => ({
  setScriptRunPaused: controls.script,
  forgetScriptRunPause: vi.fn(),
}));

it("pauses and resumes one running OpenCode turn three times without replacing its session", async () => {
  controls.process.mockClear();
  const fixture = await recoveryFixture();
  const original = fixture.completed.steps[0]?.session;
  if (!original) throw new Error("Missing synthetic session");
  const running: AgentPlanRun = {
    ...fixture.initial,
    status: "running",
    steps: fixture.initial.steps.map((step) =>
      step.id === "a"
        ? {
            ...step,
            status: "running",
            session: {
              ...original,
              runner: "opencode",
              processId: 77,
              closeout: "pending",
              endedAt: null,
            },
          }
        : step,
    ),
  };
  let controller = new AbortController();
  let active: ActivePlanRun = {
    view: running,
    snapshot: fixture.snapshot,
    groupCloseout: "open",
    hasPersistenceFailure: false,
    dispatched: new Set(["a"]),
    controllers: new Map([["a", controller]]),
    executions: new Set(),
  };
  let stored = structuredClone(running);
  const activeRuns = new Map([[running.id, active]]);
  const commands = new AgentPlanRunCommands({
    active: activeRuns,
    writes: new SerialQueue(),
    isClosing: () => false,
    pump: async () => undefined,
    localSessions: { setRunPaused: async () => undefined },
    runs: {
      insert: async () => undefined,
      create: async () => undefined,
      find: async () => structuredClone(stored),
      update: async (next) => {
        stored = structuredClone(next);
      },
    },
    start: { control: async () => undefined },
    steps: {
      run: async (): Promise<Partial<AgentPlanStepResult>> => ({
        status: "succeeded",
      }),
      closeGroups: async () => undefined,
    },
  });

  for (let cycle = 0; cycle < 3; cycle += 1) {
    await commands.pause(running.id);
    expect(stored.status).toBe("paused");
    expect(stored.steps[0]?.status).toBe("running");
    expect(stored.steps[0]?.session?.sessionId).toBe(original.sessionId);
    expect(controller.signal.aborted).toBe(false);
    expect(suspendedOpenCodeSessions(stored)).toEqual(
      new Map([["a", original.instanceId]]),
    );
    if (cycle === 0) {
      controller = new AbortController();
      active = {
        ...active,
        view: structuredClone(stored),
        controllers: new Map([["a", controller]]),
        suspended: suspendedOpenCodeSessions(stored),
      };
      activeRuns.set(running.id, active);
    }

    await commands.resume(running.id);
    expect(stored.status).toBe("running");
    expect(stored.steps[0]?.session?.instanceId).toBe(original.instanceId);
  }
  expect(
    controls.process.mock.calls.filter((call) => call[1] === "pause"),
  ).toHaveLength(3);
  expect(
    controls.process.mock.calls.filter((call) => call[1] === "resume"),
  ).toHaveLength(3);

  controls.process.mockRejectedValueOnce(new Error("suspension failed"));
  await expect(commands.pause(running.id)).rejects.toThrow();
  expect(stored.status).toBe("running");
  expect(controller.signal.aborted).toBe(false);

  await commands.pause(running.id);
  await commands.stop(running.id);
  expect(stored.status).toBe("cancelled");
  expect(controller.signal.aborted).toBe(true);
  await expect(commands.resume(running.id)).rejects.toThrow();
});

it("pauses a running script without aborting its controller and resumes the same attempt", async () => {
  controls.script.mockClear();
  const fixture = await recoveryFixture();
  const running: AgentPlanRun = {
    ...fixture.initial,
    status: "running",
    steps: fixture.initial.steps.map((step) =>
      step.id === "a" ? { ...step, status: "running" } : step,
    ),
  };
  const controller = new AbortController();
  const active: ActivePlanRun = {
    view: running,
    snapshot: fixture.snapshot,
    groupCloseout: "open",
    hasPersistenceFailure: false,
    dispatched: new Set(["a"]),
    controllers: new Map([["a", controller]]),
    executions: new Set(),
  };
  let stored = structuredClone(running);
  const commands = new AgentPlanRunCommands({
    active: new Map([[running.id, active]]),
    writes: new SerialQueue(),
    isClosing: () => false,
    pump: async () => undefined,
    scripts: { run: async () => ({}) },
    runs: {
      insert: async () => undefined,
      create: async () => undefined,
      find: async () => structuredClone(stored),
      update: async (next) => {
        stored = structuredClone(next);
      },
    },
    start: { control: async () => undefined },
    steps: {
      run: async (): Promise<Partial<AgentPlanStepResult>> => ({}),
      closeGroups: async () => undefined,
    },
  });
  await commands.pause(running.id);
  expect(stored.status).toBe("paused");
  expect(stored.steps.find((step) => step.id === "b")?.status).toBe("paused");
  expect(controller.signal.aborted).toBe(false);
  expect(controls.script).toHaveBeenCalledWith(running.id, true);
  await commands.resume(running.id);
  expect(stored.status).toBe("running");
  expect(stored.steps.find((step) => step.id === "b")?.status).toBe("waiting");
  expect(controls.script).toHaveBeenCalledWith(running.id, false);
  await commands.pause(running.id);
  await commands.stop(running.id);
  expect(controller.signal.aborted).toBe(true);
  expect(controls.process).toHaveBeenCalledWith(expect.anything(), "stop");
});

it("starts anew after an OpenCode end state and never offers resume or stop", async () => {
  const fixture = await recoveryFixture();
  const session = fixture.completed.steps[0]?.session;
  if (!session) throw new Error("Missing synthetic session");
  const run: AgentPlanRun = {
    ...fixture.initial,
    status: "cancelled",
    stopRequested: true,
    steps: fixture.initial.steps.map((step) =>
      step.id === "a"
        ? {
            ...step,
            session: { ...session, runner: "opencode" },
          }
        : step,
    ),
  };
  const plan: AgentPlanView = {
    ...fixture.snapshot.plan,
    canEdit: true,
    projectName: "Project",
    github: null,
  };
  const control = planControl(plan, run, {
    userId: run.userId,
    hasReservation: false,
  });
  expect(control).toMatchObject({
    status: "cancelled",
    canPlay: true,
    canPause: false,
    canResume: false,
    canStop: false,
    resumeKind: "stopped",
  });
  expect(isEndedResumable(run)).toBe(false);
  expect(
    planControl(
      plan,
      { ...run, status: "running" },
      {
        userId: run.userId,
        hasReservation: true,
      },
    ).canPlay,
  ).toBe(false);
});
