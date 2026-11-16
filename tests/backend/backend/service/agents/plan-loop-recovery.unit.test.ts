import { expect, it, vi } from "vitest";

import {
  interruptedLoopRuns,
  settledLoopRuns,
} from "@/backend/service/agents/recovery/AgentPlanLoopRecovery";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { AgentPlanLoopRun } from "@/definition/AgentPlanLoopRun";
import type { AgentPlanStepResult } from "@/definition/AgentPlan";

const node = partial<AgentPlanStepResult>({
  id: "node",
  status: "running",
  session: { closeout: "pending" },
});
const loop = partial<AgentPlanLoopRun>({
  status: "running",
  cleanup: "pending",
  sessions: [{ nodeId: "node", state: "open", closeout: "pending" }],
  iterations: [
    { status: "running", endedAt: null, error: null, nodes: [node] },
  ],
});

it("marks interrupted iterations failed and open sessions lost after cleanup", async () => {
  const end = vi.fn(async (entry: AgentPlanStepResult) =>
    partial<AgentPlanStepResult>({
      ...entry,
      session: { closeout: "confirmed" },
    }),
  );
  const interrupt = vi.fn((entry: AgentPlanStepResult) => ({
    ...entry,
    status: "failed" as const,
  }));
  const [result] = await interruptedLoopRuns([loop], { end, interrupt });
  expect(result).toMatchObject({
    status: "failed",
    error: "plan_interrupted",
    cleanup: "confirmed",
    sessions: [{ state: "lost", closeout: "confirmed" }],
    iterations: [
      {
        status: "failed",
        error: "plan_interrupted",
        nodes: [{ status: "failed" }],
      },
    ],
  });
});

it("preserves waiting loops and completed iterations while recording failed cleanup", async () => {
  const waiting = partial<AgentPlanLoopRun>({
    ...loop,
    status: "waiting",
    iterations: [{ status: "succeeded", nodes: [node] }],
  });
  const end = vi.fn(async (entry: AgentPlanStepResult) =>
    partial<AgentPlanStepResult>({ ...entry, session: { closeout: "failed" } }),
  );
  const interrupt = vi.fn((entry: AgentPlanStepResult) => entry);
  const [result] = await interruptedLoopRuns([waiting], { end, interrupt });
  expect(result).toMatchObject({
    status: "waiting",
    error: null,
    endedAt: null,
    cleanup: "failed",
    iterations: [{ status: "succeeded" }],
  });
  expect(interrupt).not.toHaveBeenCalled();
});

it("settles sessions of ended loops without changing their outcomes", async () => {
  const ended = partial<AgentPlanLoopRun>({
    ...loop,
    status: "succeeded",
    cleanup: "pending",
    iterations: [{ status: "succeeded", nodes: [node] }],
  });
  const [result] = await settledLoopRuns([ended], async (entry) =>
    partial<AgentPlanStepResult>({
      ...entry,
      session: { closeout: "confirmed" },
    }),
  );
  expect(result).toMatchObject({
    status: "succeeded",
    cleanup: "confirmed",
    sessions: [{ state: "lost", closeout: "confirmed" }],
    iterations: [{ status: "succeeded" }],
  });
});
