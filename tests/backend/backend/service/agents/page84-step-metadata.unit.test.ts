import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { planContentDigest } from "@/backend/agents/AgentPlanContentDigest";
import { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { groupEngine, groupTurn } from "./page73-group-fixture";
import { parameterRunFixture } from "./page55-run-fixture";

import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const CAPABILITIES = {
  canLoad: true,
  canResume: true,
  adapter: "verified synthetic 1",
} as const;
const CLOSED = {
  exit: { code: 0, signal: null },
  endedAt: "2026-10-17T02:00:00.000Z",
  leftovers: 0,
  isConfirmed: true,
} as const;

it.each(["codex_cli", "claude_code"] as const)(
  "pins the resolved %s prompt digest before opening a process and preserves actual capabilities in the final record",
  async (provider) => {
    const fixture = await parameterRunFixture(
      emptyAgentConfiguration(),
      provider,
    );
    const records: AgentPlanSessionRecord[] = [];
    const open = vi.fn<PlanExecution["open"]>(
      async (input, signal, observer) => {
        expect(records.at(-1)?.dispatchedPromptDigest).toBe(
          planContentDigest(input.prompt),
        );
        observer.capabilities?.(CAPABILITIES);
        observer.identified("owned-native");
        return {
          turn: Promise.resolve(groupTurn({ sessionId: "owned-native" })),
          close: async () => CLOSED,
        };
      },
    );
    const runner = new AgentPlanStepRunner({
      start: fixture.start,
      execution: { open, run: async () => "unused API" },
      tasks: {
        checklist: async () => {
          throw new Error("No bound tickets");
        },
      },
      access: { grant: async () => null, revoke: async () => 0 },
    });

    const result = await runner.run(
      fixture.run,
      fixture.snapshot,
      fixture.step,
      {
        signal: new AbortController().signal,
        save: async (record) => {
          records.push(record);
        },
      },
    );

    expect(open).toHaveBeenCalledOnce();
    expect(result.session).toMatchObject({
      continuationCapabilities: CAPABILITIES,
      sessionId: "owned-native",
      resultCode: 0,
    });
    expect(fixture.step.step.instruction).toBe("Additional instruction");
  },
);

it("carries verified capabilities to the next group member without opening a second session or lease", async () => {
  const open = vi.fn<PlanExecution["open"]>(async (input, signal, observer) => {
    observer.capabilities?.(CAPABILITIES);
    observer.identified("owned-native");
    return {
      turn: Promise.resolve(groupTurn({ sessionId: "owned-native" })),
      next: async () => groupTurn({ sessionId: "owned-native" }),
      close: async () => CLOSED,
    };
  });
  const world = await groupEngine({ open, run: async () => "unused API" });
  const run = await world.engine.start("owner", world.snapshot);
  await vi.advanceTimersByTimeAsync(0);
  const finished = world.stored.get(run.id);

  expect(finished?.status).toBe("succeeded");
  expect(open).toHaveBeenCalledOnce();
  for (const id of ["first", "second"])
    expect(
      finished?.steps.find((step) => step.id === id)?.session,
    ).toMatchObject({
      continuationCapabilities: CAPABILITIES,
      sessionId: "owned-native",
    });
  await world.engine.shutdown();
});

it("observes an aborted durable-record save before any API request or native process can start", async () => {
  const fixture = await parameterRunFixture();
  const controller = new AbortController();
  const run = vi.fn<PlanExecution["run"]>(async () => "must not run");
  const open = vi.fn<PlanExecution["open"]>(async () => {
    throw new Error("must not open");
  });
  const runner = new AgentPlanStepRunner({
    start: fixture.start,
    execution: { run, open },
    tasks: {
      checklist: async () => {
        throw new Error("No bound tickets");
      },
    },
    access: { grant: async () => null, revoke: async () => 0 },
  });

  const result = await runner.run(fixture.run, fixture.snapshot, fixture.step, {
    signal: controller.signal,
    save: async () => {
      controller.abort();
    },
  });

  expect(result.status).toBe("cancelled");
  expect(run).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});
