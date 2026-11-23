import { expect, it, vi } from "vitest";

import { AgentPayloadReferenceRepository } from "./AgentPayloadReferenceRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

it("returns an empty set without paths and without a query", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => []);
  await expect(
    new AgentPayloadReferenceRepository({ query }).referenced([]),
  ).resolves.toEqual(new Set());
  expect(query).not.toHaveBeenCalled();
});

it("returns only the referenced string paths", async () => {
  const query = vi.fn<DatabaseTransaction["query"]>(async () => [
    ["a.json"],
    [null],
    ["b.json"],
  ]);
  const found = await new AgentPayloadReferenceRepository({
    query,
  }).referenced(["a.json", "b.json", "c.json"]);
  expect(found).toEqual(new Set(["a.json", "b.json"]));
  expect(query.mock.calls[0]?.[1]).toEqual({
    paths: JSON.stringify(["a.json", "b.json", "c.json"]),
  });
  expect(query.mock.calls[0]?.[0]).toContain("agent_session_events");
});
