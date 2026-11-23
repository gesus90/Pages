import { expect, it, vi } from "vitest";

import { AgentPlanScriptApprovalRepository } from "./AgentPlanScriptApprovalRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("lists the approvals of a plan by step", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["s1", "h1", "u1", "2026-01-01T00:00:00.000Z"],
    ["s2", "h2", "u2", "2026-01-02T00:00:00.000Z"],
  ]);
  const repository = new AgentPlanScriptApprovalRepository({
    query,
    execute: vi.fn(),
  });

  const approvals = await repository.list("p1");

  expect(query.mock.calls[0]?.[1]).toEqual({ plan_id: "p1" });
  expect(approvals.get("s2")).toEqual({
    stepId: "s2",
    contentHash: "h2",
    approvedBy: "u2",
    approvedAt: "2026-01-02T00:00:00.000Z",
  });
  expect(approvals.size).toBe(2);
});

it("stores an approval with the current time", async () => {
  const execute = vi.fn<DatabaseTransaction["execute"]>(async () => {});
  const repository = new AgentPlanScriptApprovalRepository({
    query: vi.fn(),
    execute,
  });

  await repository.approve("p1", {
    stepId: "s1",
    contentHash: "h1",
    approvedBy: "u1",
  });

  expect(execute.mock.calls[0]?.[1]).toMatchObject({
    plan_id: "p1",
    step_id: "s1",
    content_hash: "h1",
    approved_by: "u1",
  });
  const parameters = execute.mock.calls[0]?.[1];
  expect(Number.isNaN(Date.parse(String(parameters?.approved_at)))).toBe(false);
});
