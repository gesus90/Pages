import { expect, it, vi } from "vitest";

import { AgentPlanCleanupFailureRepository } from "./AgentPlanCleanupFailureRepository";

import type { Database } from "@/backend/database/Database";
import type { AgentPlanCleanupFailureRecord } from "@/definition/AgentPlanCleanupResource";

const { readRecord } = vi.hoisted(() => ({ readRecord: vi.fn() }));

vi.mock("@/backend/agents/AgentPlanCleanupFailureInput", () => ({
  readCleanupFailureRecord: readRecord,
}));

function database(rows: unknown[][] = []): {
  readonly query: ReturnType<typeof vi.fn<Database["query"]>>;
  readonly execute: ReturnType<typeof vi.fn<Database["execute"]>>;
} {
  return {
    query: vi.fn<Database["query"]>(async () => rows as never),
    execute: vi.fn<Database["execute"]>(async () => undefined),
  };
}

it("appends the validated record for the executor", async () => {
  const db = database();
  const entry: unknown = { id: "e1", runId: "r1" };
  readRecord.mockReturnValueOnce(entry);

  await new AgentPlanCleanupFailureRepository(db).append(
    "u1",
    entry as AgentPlanCleanupFailureRecord,
  );

  expect(db.execute.mock.calls[0]?.[1]).toEqual({
    id: "e1",
    run_id: "r1",
    user_id: "u1",
    failure_json: JSON.stringify(entry),
  });
});

it("reads null when the executor has no observation", async () => {
  const db = database([]);

  await expect(
    new AgentPlanCleanupFailureRepository(db).latest("u1", "r1"),
  ).resolves.toBeNull();
});

it("reads the latest observation of the run", async () => {
  const entry = { id: "e1", runId: "r1" };
  const db = database([[JSON.stringify(entry)]]);
  readRecord.mockReturnValueOnce(entry);

  await expect(
    new AgentPlanCleanupFailureRepository(db).latest("u1", "r1"),
  ).resolves.toBe(entry);
  expect(readRecord).toHaveBeenLastCalledWith(entry);
});

it("refuses an observation that names another run", async () => {
  const db = database([[JSON.stringify({})]]);
  readRecord.mockReturnValueOnce({ id: "e1", runId: "other" });

  await expect(
    new AgentPlanCleanupFailureRepository(db).latest("u1", "r1"),
  ).rejects.toMatchObject({ code: "diagnostic_unavailable" });
});
