import { expect, it, vi } from "vitest";

import {
  AgentPlanAccessRepository,
  writePlanAccess,
} from "@/backend/database/repositories/agent/AgentPlanAccessRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("checks the revision, records an owner change and journals in the same transaction", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValue([[2, "old-owner", "Plan"]]);
  const execute = vi
    .fn<DatabaseTransaction["execute"]>()
    .mockResolvedValue(undefined);
  const transaction = { query, execute };
  const journal = vi.fn(async () => undefined);
  await expect(
    writePlanAccess(transaction, {
      planId: "plan",
      revision: 2,
      actorId: "actor",
      ownerId: "new-owner",
      journal,
    }),
  ).resolves.toBe(3);
  expect(
    execute.mock.calls.some(
      ([sql, parameters]) =>
        sql.includes("SET owner_id") && parameters?.owner_id === "new-owner",
    ),
  ).toBe(true);
  expect(
    execute.mock.calls.some(([sql]) => sql.includes("revision = revision + 1")),
  ).toBe(true);
  expect(journal).toHaveBeenCalledWith(transaction);
});

it("refuses missing or stale plan revisions without writing", async () => {
  const query = vi
    .fn<DatabaseTransaction["query"]>()
    .mockResolvedValueOnce([])
    .mockResolvedValueOnce([[3, "owner", "Plan"]]);
  const execute = vi.fn<DatabaseTransaction["execute"]>();
  const transaction = { query, execute };
  const change = { planId: "plan", revision: 2, actorId: "actor" };
  await expect(writePlanAccess(transaction, change)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  await expect(writePlanAccess(transaction, change)).rejects.toMatchObject({
    code: "plan_conflict",
  });
  expect(execute).not.toHaveBeenCalled();
});

it("translates a uniqueness conflict and preserves unrelated database errors", async () => {
  const transaction = vi
    .fn()
    .mockRejectedValueOnce(new Error("UNIQUE constraint violation"))
    .mockRejectedValueOnce(new Error("offline"));
  const repository = new AgentPlanAccessRepository({ transaction });
  const change = { planId: "plan", revision: 1, actorId: "actor" };
  await expect(repository.change(change)).rejects.toMatchObject({
    code: "plan_name_taken",
  });
  await expect(repository.change(change)).rejects.toThrow("offline");
});
