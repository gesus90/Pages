import { describe, expect, it, vi } from "vitest";

import { mcpAgentRoutes } from "@/app/lib/mcp-agent-routes";
import { mcpWikiRoutes } from "@/app/lib/mcp-wiki-routes";

import type { RouteConfigEntry } from "@react-router/dev/routes";

/** Records every declared resource as `[path, file]`. */
function declare(): {
  resource: (path: string, file: string) => RouteConfigEntry;
  declared: [string, string][];
} {
  const declared: [string, string][] = [];
  return {
    declared,
    resource: vi.fn((path: string, file: string) => {
      declared.push([path, file]);
      return { path, file };
    }),
  };
}

describe("mcpAgentRoutes", () => {
  it("declares the agent API under /api/mcp/v1/agents", () => {
    const { resource, declared } = declare();

    const routes = mcpAgentRoutes(resource);

    expect(routes).toEqual(declared.map(([path, file]) => ({ path, file })));
    expect(declared).toEqual([
      ["api/mcp/v1/agents", "routes/api-mcp-v1-agents.ts"],
      ["api/mcp/v1/agents/options", "routes/api-mcp-v1-agents-options.ts"],
      ["api/mcp/v1/agents/:id", "routes/api-mcp-v1-agent.ts"],
      ["api/mcp/v1/agents/:id/image", "routes/api-mcp-v1-agent-image.ts"],
      ["api/mcp/v1/agents/:id/remove", "routes/api-mcp-v1-agent-remove.ts"],
      [
        "api/mcp/v1/agents/:id/memory/versions",
        "routes/api-mcp-v1-agent-memory-versions.ts",
      ],
      [
        "api/mcp/v1/agents/:id/memory/versions/:versionId/restore",
        "routes/api-mcp-v1-agent-memory-version-restore.ts",
      ],
      [
        "api/mcp/v1/agents/:id/memory/archive",
        "routes/api-mcp-v1-agent-memory-archive.ts",
      ],
      ["api/mcp/v1/agents/:id/activity", "routes/api-mcp-v1-agent-activity.ts"],
    ]);
  });
});

describe("mcpWikiRoutes", () => {
  it("declares the wiki API under /api/mcp/v1/wiki with unique paths and files", () => {
    const { resource, declared } = declare();

    const routes = mcpWikiRoutes(resource);

    expect(routes).toHaveLength(declared.length);
    expect(declared).toHaveLength(19);
    for (const [path] of declared)
      expect(path.startsWith("api/mcp/v1/wiki/")).toBe(true);
    expect(new Set(declared.map(([path]) => path)).size).toBe(19);
    expect(new Set(declared.map(([, file]) => file)).size).toBe(19);
  });

  it("nests pages, versions, comments and trash under their parents", () => {
    const { resource, declared } = declare();

    mcpWikiRoutes(resource);

    expect(declared).toEqual(
      expect.arrayContaining([
        ["api/mcp/v1/wiki/pages", "routes/api-mcp-v1-wiki-pages.ts"],
        ["api/mcp/v1/wiki/pages/:id", "routes/api-mcp-v1-wiki-page.ts"],
        [
          "api/mcp/v1/wiki/pages/:id/versions/:versionId/restore",
          "routes/api-mcp-v1-wiki-page-version-restore.ts",
        ],
        [
          "api/mcp/v1/wiki/comments/:commentId/resolve",
          "routes/api-mcp-v1-wiki-comment-resolve.ts",
        ],
        [
          "api/mcp/v1/wiki/trash/:id/purge",
          "routes/api-mcp-v1-wiki-trash-purge.ts",
        ],
        [
          "api/mcp/v1/wiki/attachments/:attachmentId",
          "routes/api-mcp-v1-wiki-attachment.ts",
        ],
      ]),
    );
  });
});
