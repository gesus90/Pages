import { expect, it, vi } from "vitest";

import { requireReleasedPlanResources } from "./AgentPlanDeletionGuard";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("accepts a plan whose runs hold nothing", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);

  await expect(
    requireReleasedPlanResources({ query }, "p1"),
  ).resolves.toBeUndefined();
  expect(query.mock.calls[0]?.[1]).toEqual({ plan_id: "p1" });
});

it("refuses a plan while a run still holds a session owner or lock", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [["r1"]]);

  await expect(
    requireReleasedPlanResources({ query }, "p1"),
  ).rejects.toMatchObject({ code: "plan_resources_held" });
});
