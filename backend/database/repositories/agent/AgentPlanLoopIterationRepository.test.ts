import { expect, it, vi } from "vitest";

import type { Mock } from "vitest";

import { AgentPlanLoopIterationRepository } from "./AgentPlanLoopIterationRepository";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type { AgentPlanLoopIterationCheckpoint } from "@/definition/AgentPlanLoopRun";

function iteration(
  condition: AgentPlanLoopIterationCheckpoint["condition"],
  output = "ok",
): AgentPlanLoopIterationCheckpoint {
  return {
    schemaVersion: 1,
    runId: "r1",
    loopId: "l1",
    iteration: 2,
    completedAt: "2026-01-01T00:00:00.000Z",
    count: { source: "value", parameterId: null, effective: 3, mode: "max" },
    condition,
    nodes: [
      {
        id: "n1",
        status: "succeeded",
        output,
        outputDigest: "d",
        session: null,
      },
    ],
  };
}

interface Harness {
  readonly query: Mock<DatabaseTransaction["query"]>;
  readonly execute: Mock<DatabaseTransaction["execute"]>;
  readonly handle: DatabaseTransaction;
}

function transaction(existing: DatabaseValue[][]): Harness {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => existing);
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => undefined);
  const handle: DatabaseTransaction = { query, execute };
  return { query, execute, handle };
}

const NOT_EVALUATED = { state: "not_evaluated", reason: "disabled" } as const;

it("inserts a new iteration with a not evaluated condition", async () => {
  const { execute, handle } = transaction([]);

  await new AgentPlanLoopIterationRepository().append(
    handle,
    iteration(NOT_EVALUATED),
    7,
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    run_revision: 7,
    count_source: "value",
    condition_state: "not_evaluated",
    condition_met: null,
  });
});

it("stores the verdict of an evaluated condition", async () => {
  const { execute, handle } = transaction([]);

  await new AgentPlanLoopIterationRepository().append(
    handle,
    iteration({ state: "evaluated", isMet: true, found: { type: "null" } }),
    1,
  );

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    condition_state: "evaluated",
    condition_met: true,
  });
});

it("keeps a repeated identical iteration without writing", async () => {
  const input = iteration(NOT_EVALUATED);
  const { execute, handle } = transaction([[JSON.stringify(input)]]);

  await new AgentPlanLoopIterationRepository().append(handle, input, 1);

  expect(execute).not.toHaveBeenCalled();
});

it("refuses a repeated iteration with different content", async () => {
  const { handle } = transaction([[JSON.stringify(iteration(NOT_EVALUATED))]]);

  await expect(
    new AgentPlanLoopIterationRepository().append(
      handle,
      iteration(NOT_EVALUATED, "other"),
      1,
    ),
  ).rejects.toMatchObject({ code: "checkpoint_invalid" });
});

it("refuses an iteration over the size bound", async () => {
  const { query, handle } = transaction([]);

  await expect(
    new AgentPlanLoopIterationRepository().append(
      handle,
      iteration(NOT_EVALUATED, "x".repeat(2_097_152)),
      1,
    ),
  ).rejects.toMatchObject({ code: "checkpoint_too_large" });
  expect(query).not.toHaveBeenCalled();
});
