import { vi } from "vitest";

import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentPlanRunCommands } from "@/backend/service/agents/AgentPlanRunCommands";

import { recoveryFixture } from "./page84-recovery-fixture";

import type { ActivePlanRun } from "@/backend/service/agents/AgentPlanRunState";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Keeps persistence, process control and execution at mocked boundaries. */
export async function codexControlFixture(): Promise<{
  readonly active: ActivePlanRun;
  readonly commands: AgentPlanRunCommands;
  readonly controller: AbortController;
  readonly nativePause: ReturnType<
    typeof vi.fn<(runId: string, isPaused: boolean) => Promise<void>>
  >;
  readonly update: ReturnType<
    typeof vi.fn<(run: AgentPlanRun) => Promise<void>>
  >;
  readonly stored: () => AgentPlanRun;
  readonly pump: ReturnType<typeof vi.fn<() => Promise<void>>>;
}> {
  const fixture = await recoveryFixture();
  const controller = new AbortController();
  const record = fixture.completed.steps[0]?.session;
  if (!record) throw new Error("Missing synthetic session");
  const active: ActivePlanRun = {
    view: {
      ...fixture.initial,
      steps: fixture.initial.steps.map((step, index) =>
        index === 0
          ? {
              ...step,
              status: "running",
              session: { ...record, endedAt: null, closeout: "pending" },
            }
          : step,
      ),
    },
    snapshot: fixture.snapshot,
    controllers: new Map([["a", controller]]),
    dispatched: new Set(["a"]),
    executions: new Set(),
    hasPersistenceFailure: false,
    groupCloseout: "open",
  };
  let stored = structuredClone(active.view);
  const update = vi.fn(async (run: AgentPlanRun) => {
    stored = structuredClone(run);
  });
  const nativePause = vi.fn(
    async (_runId: string, _isPaused: boolean) => undefined,
  );
  const pump = vi.fn(async () => undefined);
  const commands = new AgentPlanRunCommands({
    active: new Map([[active.view.id, active]]),
    writes: new SerialQueue(),
    isClosing: () => false,
    pump,
    localSessions: { setRunPaused: nativePause },
    runs: {
      insert: async () => undefined,
      create: async () => undefined,
      update,
      find: async () => structuredClone(stored),
    },
    start: { control: async () => undefined },
    steps: { run: async () => ({}), closeGroups: async () => [] },
  });
  return {
    active,
    commands,
    controller,
    nativePause,
    update,
    stored: () => stored,
    pump,
  };
}
