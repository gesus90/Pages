import { expect, it, vi } from "vitest";

import { McpWorkspaceService } from "@/backend/service/mcp/workspace/McpWorkspaceService";

import { partial } from "../../../../app/lib/service-wiring-fakes";

import type { McpWorkspaceServices } from "@/backend/service/mcp/workspace/McpWorkspaceCatalog";

const WORKSPACE = {
  id: "work",
  name: "Work",
  path: "/work",
  projectId: "project",
  projectName: "Project",
  revision: 2,
  github: null,
  reason: null,
  isUsable: true,
  canManage: true,
};

it("rejects stale revisions and connection IDs for local workspaces", async () => {
  const save = vi.fn();
  const services = partial<McpWorkspaceServices>({
    local: { read: async () => WORKSPACE, save },
  });
  const service = new McpWorkspaceService(services);
  await expect(
    service.update("user", "work", { revision: 1, name: "New" }),
  ).rejects.toMatchObject({ code: "conflict" });
  await expect(
    service.update("user", "work", { revision: 2, connectionId: "connection" }),
  ).rejects.toMatchObject({ code: "invalid_request" });
  expect(save).not.toHaveBeenCalled();
});

it("previews workspace registration removal and its usages without changing it", async () => {
  const remove = vi.fn();
  const services = partial<McpWorkspaceServices>({
    local: {
      read: async () => WORKSPACE,
      usages: async () => [{ kind: "plan", id: "plan", name: "Plan" }],
      remove,
    },
  });
  const service = new McpWorkspaceService(services);
  await expect(
    service.remove("user", "work", { revision: 2 }),
  ).resolves.toMatchObject({
    confirmationRequired: true,
    workspace: { id: "work" },
    usages: [{ id: "plan" }],
  });
  expect(remove).not.toHaveBeenCalled();
  await expect(
    service.remove("user", "work", { revision: 1 }),
  ).rejects.toMatchObject({ code: "conflict" });
});

it("refuses paths beyond the folder listing limit before reading the filesystem", async () => {
  const folders = vi.fn();
  const service = new McpWorkspaceService(
    partial<McpWorkspaceServices>({ local: { folders } }),
  );
  await expect(
    service.folders("user", { path: "x".repeat(4097) }),
  ).rejects.toMatchObject({ code: "path_invalid" });
  expect(folders).not.toHaveBeenCalled();
});
