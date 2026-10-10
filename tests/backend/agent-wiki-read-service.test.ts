import { describe, expect, it, vi } from "vitest";

import { AgentWikiReadService } from "@/backend/service/agents/AgentWikiReadService";
import { createUser } from "../helpers/factories";

import type { WikiTreeNode } from "@/definition/Wiki";

const actor = createUser();

describe("agent wiki result boundaries", () => {
  it("caps the tree at 100 and removes out-of-window parent IDs", async () => {
    const nodes: WikiTreeNode[] = Array.from({ length: 102 }, (_, index) => ({
      id: `node-${index}`,
      parentId: index === 0 ? "node-101" : "node-0",
      title: "Node",
      icon: null,
      scope: "project",
      projectId: "p1",
      position: index,
      currentUntil: null,
    }));
    nodes[101] = {
      ...nodes[101],
      id: "other",
      parentId: null,
      title: "Other",
      icon: null,
      scope: "project",
      projectId: "p2",
      position: 101,
      currentUntil: null,
    };
    const reads = {
      visibleNodes: vi.fn().mockResolvedValue(nodes),
      readWithoutVisit: vi.fn(),
    };
    const service = new AgentWikiReadService(reads, { search: vi.fn() });
    const tree = await service.tree(actor, "p1");
    expect(tree).toMatchObject({ total: 101, truncated: true });
    expect(tree.nodes).toHaveLength(100);
    expect(tree.nodes[0]?.parentId).toBeNull();
    expect(tree.nodes[1]?.parentId).toBe("node-0");
  });

  it("caps search at 20, trims snippets by Unicode characters and preserves visible totals", async () => {
    const searches = {
      search: vi.fn().mockResolvedValue({
        results: Array.from({ length: 30 }, (_, index) => ({
          id: String(index),
          title: "Visible",
          snippet: "😀".repeat(300),
          ownerName: "Never project",
        })),
        total: 50,
      }),
    };
    const service = new AgentWikiReadService(
      { visibleNodes: vi.fn(), readWithoutVisit: vi.fn() },
      searches,
    );
    const result = await service.search(actor, "query", "project");
    expect(result.total).toBe(50);
    expect(result.truncated).toBe(true);
    expect(result.results).toHaveLength(20);
    expect(result.results[0]).toEqual({
      id: "0",
      title: "Visible",
      snippet: "😀".repeat(200),
    });
    expect(searches.search).toHaveBeenCalledWith(
      actor,
      expect.objectContaining({ location: "project:project" }),
    );
  });

  it("propagates persistence errors while keeping missing/hidden failures unified", async () => {
    const reads = {
      visibleNodes: vi.fn(),
      readWithoutVisit: vi
        .fn()
        .mockRejectedValue(new Error("database unavailable")),
    };
    const service = new AgentWikiReadService(reads, { search: vi.fn() });
    await expect(service.read(actor, "page")).rejects.toThrow(
      "database unavailable",
    );
  });
});
