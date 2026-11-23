import { expect, it, vi } from "vitest";

import { AgentPlanSwarmRepository } from "./AgentPlanSwarmRepository";

import type { Database } from "@/backend/database/Database";
import type { SwarmStoredBoard } from "@/backend/service/agents/swarm/SwarmPorts";

const board: SwarmStoredBoard = {
  view: {
    main: { provider: "codex_cli", model: "m", activity: null, todos: [] },
    workers: [],
    tasks: [],
    violations: [],
    summary: null,
    outcome: "running",
  },
  locks: [{ path: "src", owner: "H1", expiresAt: 5 }],
};

function repositoryOf(rows: readonly (readonly string[])[]): {
  readonly repository: AgentPlanSwarmRepository;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
} {
  const execute = vi.fn<Database["execute"]>(async () => {});
  const query = vi.fn<Database["query"]>(async () =>
    rows.map((row) => [...row]),
  );
  return {
    repository: new AgentPlanSwarmRepository({ query, execute }),
    execute,
  };
}

it("stores the board of a node as JSON", async () => {
  const { repository, execute } = repositoryOf([]);

  await repository.save("run", "node", board);

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    run_id: "run",
    node_id: "node",
    board_json: JSON.stringify(board),
  });
});

it("reads a stored board", async () => {
  const { repository } = repositoryOf([[JSON.stringify(board)]]);

  await expect(repository.find("run", "node")).resolves.toEqual(board);
});

it("reads no board when none exists", async () => {
  const { repository } = repositoryOf([]);

  await expect(repository.find("run", "node")).resolves.toBeNull();
});

it("reads no board when the stored one is invalid", async () => {
  const { repository } = repositoryOf([[JSON.stringify({ view: 1 })]]);

  await expect(repository.find("run", "node")).resolves.toBeNull();
});

it("keeps the todos of a worker", async () => {
  const { repository, execute } = repositoryOf([]);

  await repository.saveTodos({
    runId: "run",
    stepId: "step",
    attemptId: "attempt",
    workerId: "main",
    todos: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    worker_id: "main",
    todos_json: "[]",
  });
});
