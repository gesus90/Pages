import { expect, it, vi } from "vitest";

import { AgentPlanAuditRepository } from "./AgentPlanAuditRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("appends an entry with identifier, details and time", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const repository = new AgentPlanAuditRepository({ execute, query: vi.fn() });

  await repository.append({
    planId: "p",
    actorId: "u",
    action: "owner_changed",
    revision: 3,
    details: { to: "x" },
  });
  await repository.append({
    planId: "p",
    actorId: "u",
    action: "admin_saved",
    revision: 4,
  });

  const [first, second] = execute.mock.calls.map((call) => call[1]);
  expect(first).toMatchObject({
    plan_id: "p",
    actor_id: "u",
    action: "owner_changed",
    revision: 3,
    details_json: '{"to":"x"}',
  });
  expect(typeof first?.id).toBe("string");
  expect(second?.details_json).toBe("{}");
});

it("lists stored entries and reduces non-object details to an empty record", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["e1", "p", "u", "teams_changed", 2, '{"a":1}', "t1"],
    ["e2", "p", "u", "admin_deleted", 1n, "[1]", "t0"],
    ["e3", "p", "u", "admin_started", 1, "null", "t0"],
  ]);
  const repository = new AgentPlanAuditRepository({
    query,
    execute: vi.fn(),
  });

  const entries = await repository.list("p", 5);

  expect(query.mock.calls[0]?.[1]).toEqual({ plan_id: "p", limit: 5 });
  expect(entries.map((entry) => entry.details)).toEqual([{ a: 1 }, {}, {}]);
  expect(entries[1]).toMatchObject({ revision: 1, action: "admin_deleted" });
});

it("refuses an unknown action", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["e", "p", "u", "bogus", 1, "{}", "t"],
  ]);
  const repository = new AgentPlanAuditRepository({
    query,
    execute: vi.fn(),
  });

  await expect(repository.list("p", 1)).rejects.toThrow(
    'Unknown plan history action "bogus".',
  );
});
