import { expect, it, vi } from "vitest";

import { purgeEarlierPlanRuns } from "@/backend/database/repositories/agent/AgentPlanRunPurge";

import type { PlanRunPurgeDatabase } from "@/backend/database/repositories/agent/AgentPlanRunPurge";

it("retains an unsettled earlier run without indexing failures or opening a writer transaction", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([["earlier"]])
    .mockResolvedValue([]);
  const transaction = vi.fn();
  const database: PlanRunPurgeDatabase = { query, transaction };
  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(false);
  expect(transaction).not.toHaveBeenCalled();
  expect(query.mock.calls[1][0]).not.toContain("FOR UPDATE");
});

it("does not repeatedly delete an empty start rejection set", async () => {
  const database: PlanRunPurgeDatabase = {
    query: vi.fn().mockResolvedValue([]),
    transaction: vi.fn(),
  };
  for (let attempt = 0; attempt < 10; attempt += 1)
    await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(true);
  expect(database.transaction).not.toHaveBeenCalled();
});

it("still removes earlier start rejections when a matching record exists", async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[1]]);
  const execute = vi.fn();
  const database: PlanRunPurgeDatabase = {
    query,
    transaction: async (work) => work({ query, execute }),
  };
  await expect(purgeEarlierPlanRuns(database, "kept")).resolves.toBe(true);
  expect(execute).toHaveBeenCalledWith(
    expect.stringContaining("DELETE FROM agent_plan_start_rejections"),
    { kept_run_id: "kept" },
  );
});
