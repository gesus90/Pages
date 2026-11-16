import { expect, it, vi } from "vitest";

import { AgentError } from "@/backend/error/AgentErrors";
import { McpWorkspaceCatalog } from "@/backend/service/mcp/workspace/McpWorkspaceCatalog";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWorkspaceServices } from "@/backend/service/mcp/workspace/McpWorkspaceCatalog";

it("filters unavailable remote projects and preserves local-first order", async () => {
  const requireProjectAccess = vi.fn(async () => {});
  const services = partial<McpWorkspaceServices>({
    local: { list: async () => [{ id: "local" }], requireProjectAccess },
    remote: {
      list: async () => [
        { id: "remote", projectId: "project", reason: null },
        { id: "hidden", projectId: "project", reason: "project_unavailable" },
      ],
    },
  });
  const result = await new McpWorkspaceCatalog(services).list("user", {
    projectId: "project",
    kind: null,
  });
  expect(result).toMatchObject([
    { kind: "local", view: { id: "local" } },
    { kind: "remote", view: { id: "remote" } },
  ]);
  expect(requireProjectAccess).toHaveBeenCalledWith("user", "project");
});

it("falls back from a missing local workspace to a visible remote one", async () => {
  const services = partial<McpWorkspaceServices>({
    local: {
      read: async () => {
        throw new AgentError("workspace_not_found");
      },
    },
    remote: { list: async () => [{ id: "remote", reason: null }] },
    connections: {
      scope: async () => ({ connections: [{ id: "connection" }] }),
    },
  });
  const catalog = new McpWorkspaceCatalog(services);
  await expect(catalog.find("user", "remote")).resolves.toMatchObject({
    kind: "remote",
    view: { id: "remote" },
  });
  await expect(catalog.find("user", "missing")).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    catalog.requireConnection("user", "connection"),
  ).resolves.toBeUndefined();
  await expect(
    catalog.requireConnection("user", "missing"),
  ).rejects.toMatchObject({ code: "not_found" });
});
