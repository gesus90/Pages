import { expect, it, vi } from "vitest";

import { mcpAgentRoutes } from "@/app/lib/mcp-agent-routes";

it("registers agent and memory resources in route order", () => {
  const resource = vi.fn((path: string, file: string) => ({ path, file }));
  const routes = mcpAgentRoutes(resource);

  expect(routes).toHaveLength(13);
  expect(routes[0]).toEqual({
    path: "api/mcp/v1/agents",
    file: "routes/api-mcp-v1-agents.ts",
  });
  expect(routes[10]).toEqual({
    path: "api/mcp/v1/agents/:id/memory/versions/:versionId/restore",
    file: "routes/api-mcp-v1-agent-memory-version-restore.ts",
  });
  expect(routes[12]).toEqual({
    path: "api/mcp/v1/agents/:id/activity",
    file: "routes/api-mcp-v1-agent-activity.ts",
  });
  expect(resource).toHaveBeenCalledTimes(13);
});
