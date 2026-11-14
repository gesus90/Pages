import { expect, it, vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentPlanRunCommands } from "@/backend/service/agents/AgentPlanRunCommands";
import { suspendedOpenCodeSessions } from "@/backend/service/agents/AgentPlanRunState";

import { recoveryFixture } from "./page84-recovery-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { AgentPlanRun, AgentPlanStepResult } from "@/definition/AgentPlan";

it("pauses and resumes one running OpenCode turn three times without replacing its session", async () => {
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
  const suspend = vi.fn(async () => true);
  const resume = vi.fn(async () => true);
  const activeRuns = new Map([[running.id, active]]);
  const commands = new AgentPlanRunCommands({
    active: activeRuns,
    writes: new SerialQueue(),
    isClosing: () => false,
    pump: async () => undefined,
    localSessions: { suspend, resume },
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
    expect(stored.steps[0]?.session?.sessionId).toBe(
      original.sessionId,
    );
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
  expect(suspend).toHaveBeenCalledTimes(3);
  expect(resume).toHaveBeenCalledTimes(3);
  expect(suspend).toHaveBeenCalledWith(original.instanceId);
  expect(resume).toHaveBeenCalledWith(original.instanceId);

  suspend.mockResolvedValueOnce(false);
  await expect(commands.pause(running.id)).rejects.toThrow();
  expect(stored.status).toBe("running");
  expect(controller.signal.aborted).toBe(false);

  await commands.pause(running.id);
  await commands.stop(running.id);
  expect(stored.status).toBe("stopping");
  expect(controller.signal.aborted).toBe(true);
  await expect(commands.resume(running.id)).rejects.toThrow();
});
