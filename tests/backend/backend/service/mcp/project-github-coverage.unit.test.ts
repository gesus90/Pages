import { expect, it, vi } from "vitest";

import { McpProjectGitHubService } from "@/backend/service/mcp/project/McpProjectGitHubService";
import { GITHUB_SYNC_INTERVAL } from "@/definition/Project";

import { partial } from "../../../app/lib/service-wiring-fakes";

import type { McpProjectContext } from "@/backend/service/mcp/project/McpProjectContext";

function fixture(): {
  context: McpProjectContext;
  findIntegration: ReturnType<typeof vi.fn>;
  saveIntegration: ReturnType<typeof vi.fn>;
  testConnection: ReturnType<typeof vi.fn>;
  syncProjectNow: ReturnType<typeof vi.fn>;
} {
  const findIntegration = vi.fn().mockResolvedValue({});
  const saveIntegration = vi.fn();
  const testConnection = vi.fn().mockResolvedValue(true);
  const syncProjectNow = vi.fn().mockResolvedValue({ created: 1 });
  const context = partial<McpProjectContext>({
    actor: { id: "actor" },
    requireVisible: async () => undefined,
    services: {
      projects: {
        findIntegration,
        saveIntegration,
        setIntegrationSyncEnabled: async () => ({}),
        disconnectIntegration: async () => undefined,
      },
      gitHub: { testConnection, syncProjectNow },
    },
    state: async () => ({
      project: { id: "project", name: "Project", departments: [] },
      isArchived: false,
      tags: [],
      members: [],
      goals: [],
      events: [],
      integration: null,
    }),
    person: async () => null,
  });
  return {
    context,
    findIntegration,
    saveIntegration,
    testConnection,
    syncProjectNow,
  };
}

it("saves settings without requiring a replacement token", async () => {
  const { context, saveIntegration } = fixture();
  const settings = {
    repoUrl: "https://github.com/owner/repo",
    syncIssues: true,
    syncStatus: false,
    syncComments: false,
    syncPullRequests: false,
    syncCommits: false,
    syncDirection: "push" as const,
    syncIntervalMinutes: Object.values(GITHUB_SYNC_INTERVAL)[0],
  };
  await new McpProjectGitHubService().save(context, "project", settings);
  expect(saveIntegration).toHaveBeenCalledWith(
    context.actor,
    "project",
    expect.objectContaining({ token: "", repoUrl: settings.repoUrl }),
  );
});

it("requires an existing connection before testing or syncing", async () => {
  const { context, findIntegration, testConnection, syncProjectNow } =
    fixture();
  const service = new McpProjectGitHubService();
  await expect(service.test(context, "project")).resolves.toMatchObject({
    isConnected: true,
  });
  await expect(service.sync(context, "project")).resolves.toMatchObject({
    summary: { created: 1 },
  });
  expect(testConnection).toHaveBeenCalledOnce();
  expect(syncProjectNow).toHaveBeenCalledOnce();
  findIntegration.mockResolvedValue(null);
  await expect(service.disconnect(context, "project")).rejects.toMatchObject({
    code: "not_found",
  });
});
