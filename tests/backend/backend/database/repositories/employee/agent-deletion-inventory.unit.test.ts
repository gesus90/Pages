import { describe, expect, it, vi } from "vitest";

import { AgentDeletionRepository } from "@/backend/database/repositories/employee/AgentDeletionRepository";

describe("agent deletion inventory", () => {
  it("counts artifacts and identifies blocking runs", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]])
      .mockResolvedValueOnce([["p", "Plan"]])
      .mockResolvedValueOnce([["run", "plan id", "paused"]])
      .mockResolvedValueOnce([["hash"]]);
    const repository = new AgentDeletionRepository({ query, execute: vi.fn() });
    const inventory = await repository.inventory("agent");
    expect(inventory.deletes).toMatchObject({
      directChats: 1,
      sessions: 2,
      assignedTickets: 9,
    });
    expect(inventory.keeps).toEqual({
      groupChatMessages: 10,
      ticketChanges: 11,
      wikiChanges: 12,
      commits: 0,
    });
    expect(inventory.blockers).toEqual([
      {
        code: "active_runs",
        detail: "run (paused)",
        link: "/agents/plans?planId=plan%20id",
      },
    ]);
    expect(inventory.fingerprint).toContain("hash");
  });

  it("rejects a missing inventory and reads saved previews and operations", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["a", "u", "hash", "later"]])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([["restore", "a", "u", "{}"]])
      .mockResolvedValueOnce([["other", "a", "u", "{}"]]);
    const repository = new AgentDeletionRepository({ query, execute: vi.fn() });
    await expect(repository.inventory("a")).rejects.toThrow(
      "inventory is missing",
    );
    await expect(repository.findPreview("p")).resolves.toBeNull();
    await expect(repository.findPreview("p")).resolves.toMatchObject({
      agentId: "a",
      fingerprint: "hash",
    });
    await expect(repository.findOperation("o")).resolves.toBeNull();
    await expect(repository.findOperation("o")).resolves.toMatchObject({
      action: "restore",
    });
    await expect(repository.findOperation("o")).rejects.toThrow(
      "Invalid deletion operation",
    );
  });

  it("pages restorable agents", async () => {
    const row = (id: string): string[] => [
      id,
      "Agent",
      "today",
      "u",
      "User",
      "later",
    ];
    const query = vi
      .fn()
      .mockResolvedValueOnce([row("a"), row("b")])
      .mockResolvedValueOnce([row("b")]);
    const repository = new AgentDeletionRepository({ query, execute: vi.fn() });
    await expect(repository.listDeleted(null, 1, "now")).resolves.toMatchObject(
      { agents: [{ agentId: "a" }], nextCursor: "a" },
    );
    await expect(repository.listDeleted("a", 1, "now")).resolves.toMatchObject({
      agents: [{ agentId: "b" }],
      nextCursor: null,
    });
  });
});
