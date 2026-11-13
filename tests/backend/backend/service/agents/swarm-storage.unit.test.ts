import { describe, expect, it, vi } from "vitest";

import { readPlanStepResult } from "@/backend/agents/AgentPlanStepResultInput";
import { AgentPlanSwarmRepository } from "@/backend/database/repositories/agent/AgentPlanSwarmRepository";
import { planSessionActivity } from "@/backend/service/agents/bridge/PlanSessionActivity";

import type { AgentPlanSwarmRun } from "@/definition/AgentPlanSwarmRun";

const VIEW: AgentPlanSwarmRun = {
  main: { provider: "claude_code", model: "opus", activity: null, todos: [] },
  workers: [
    {
      id: "H1",
      provider: "codex_cli",
      model: "gpt",
      access: "read_only",
      status: "busy",
      taskId: "T1",
      reason: null,
      locks: ["a.ts"],
      todos: [{ id: "1", text: "read", status: "active", updatedAt: "t" }],
    },
  ],
  tasks: [
    {
      id: "T1",
      workerId: "H1",
      requestedWorkerId: null,
      instruction: "x",
      scope: ["docs"],
      status: "running",
      attempts: 1,
      result: null,
      error: null,
      startedAt: "t",
      endedAt: null,
    },
  ],
  violations: [],
  summary: null,
  outcome: "running",
};

describe("swarm storage", () => {
  it("stores and reads the board with its locks and the TODO list of each side", async () => {
    const written: unknown[] = [];
    const execute = (sql: string, parameters: unknown): Promise<void> => {
      written.push(parameters);
      return Promise.resolve();
    };
    const board = {
      view: VIEW,
      locks: [{ path: "a.ts", owner: "H1", expiresAt: 5 }],
    };
    const query = vi.fn(() => Promise.resolve([[JSON.stringify(board)]]));
    const repository = new AgentPlanSwarmRepository({
      query,
      execute,
    });
    await repository.save("r", "s", board);
    expect(written[0]).toMatchObject({
      run_id: "r",
      node_id: "s",
    });
    await expect(repository.find("r", "s")).resolves.toEqual(board);
    await repository.saveTodos({
      runId: "r",
      stepId: "s",
      attemptId: "swarm:r:s",
      workerId: "H1",
      todos: [],
      updatedAt: "t",
    });
    expect(written[1]).toMatchObject({
      worker_id: "H1",
      attempt_id: "swarm:r:s",
    });
    query.mockResolvedValueOnce([['{"broken":true}']]);
    await expect(repository.find("r", "s")).resolves.toBeNull();
  });

  it("reads the swarm of a node result apart from the result itself", () => {
    const step = {
      id: "s",
      name: "Swarm",
      status: "running",
      isBlocked: false,
      cancellation: "none",
      output: null,
      error: null,
      swarm: VIEW,
    };
    expect(readPlanStepResult(step).swarm).toEqual(VIEW);
    expect(() => readPlanStepResult({ ...step, swarm: { main: 1 } })).toThrow();
  });

  it("admits the bridge calls of main model and helpers only while the swarm node runs", async () => {
    const run = {
      id: "r",
      status: "running",
      stopRequested: false,
      steps: [{ id: "s", status: "running", swarm: VIEW }],
    };
    const isActive = planSessionActivity({
      find: () => Promise.resolve(run as never),
    });
    const grant = {
      runId: "r",
      stepId: "s::H1",
      instanceId: "x",
      token: "t",
      expiresAt: 0,
    };
    await expect(isActive(grant)).resolves.toBe(true);
    await expect(isActive({ ...grant, stepId: "other::H1" })).resolves.toBe(
      false,
    );
    run.steps[0] = { id: "s", status: "succeeded", swarm: VIEW };
    await expect(isActive(grant)).resolves.toBe(false);
  });
});
