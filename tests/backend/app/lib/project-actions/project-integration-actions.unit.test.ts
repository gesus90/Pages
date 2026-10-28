import { beforeEach, expect, it, vi } from "vitest";

import {
  handleDisconnectIntegration,
  handleSaveIntegration,
  handleSetIntegrationSync,
  handleSyncIntegration,
  handleTestIntegration,
} from "@/app/lib/project-actions/project-integration-actions.server";

import { ACTOR, outcomeOf } from "../../actions/action-fixtures";
import { PROJECT_ID, projectContext } from "./project-action-fixtures";

import type { ProjectActionHandler } from "@/app/lib/project-actions/project-action-support.server";
import type { FormFields } from "../../actions/action-fixtures";

const services = {
  gitHubSyncService: { syncProjectNow: vi.fn(), testConnection: vi.fn() },
  projectService: {
    disconnectIntegration: vi.fn(),
    saveIntegration: vi.fn(),
    setIntegrationSyncEnabled: vi.fn(),
  },
};

const SUCCEEDED = { body: { ok: true }, status: 200 };
const INVALID = { body: { error: "invalidInput", ok: false }, status: 400 };

beforeEach(() => {
  vi.resetAllMocks();
});

async function run(
  handler: ProjectActionHandler,
  fields: FormFields = {},
): Promise<unknown> {
  const outcome = await outcomeOf(
    await handler(projectContext(services, fields)),
  );

  return { body: outcome.body, status: outcome.status };
}

it("saves the GitHub settings with every switch on", async () => {
  const fields = {
    repoUrl: "https://github.com/example/pages",
    syncComments: "on",
    syncCommits: "on",
    syncDirection: "push",
    syncIntervalMinutes: "15",
    syncIssues: "on",
    syncPullRequests: "on",
    syncStatus: "on",
    token: "secret-token",
  };

  expect(await run(handleSaveIntegration, fields)).toEqual(SUCCEEDED);
  expect(services.projectService.saveIntegration).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    {
      repoUrl: "https://github.com/example/pages",
      syncComments: true,
      syncCommits: true,
      syncDirection: "push",
      syncIntervalMinutes: 15,
      syncIssues: true,
      syncPullRequests: true,
      syncStatus: true,
      token: "secret-token",
    },
  );
});

it.each([
  ["pull", "pull"],
  ["sideways", "bidirectional"],
  ["", "bidirectional"],
])("saves the direction %j as %s", async (direction, expected) => {
  const fields = { syncDirection: direction, syncIntervalMinutes: "0" };

  expect(await run(handleSaveIntegration, fields)).toEqual(SUCCEEDED);
  expect(services.projectService.saveIntegration).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
    {
      repoUrl: "",
      syncComments: false,
      syncCommits: false,
      syncDirection: expected,
      syncIntervalMinutes: 0,
      syncIssues: false,
      syncPullRequests: false,
      syncStatus: false,
      token: "",
    },
  );
});

it.each(["7", "soon"])("refuses the sync interval %j", async (interval) => {
  const fields = { syncIntervalMinutes: interval };

  expect(await run(handleSaveIntegration, fields)).toEqual(INVALID);
  expect(services.projectService.saveIntegration).not.toHaveBeenCalled();
});

it.each([
  [true, SUCCEEDED],
  [false, INVALID],
])("answers a connection test that reached=%s", async (isConnected, answer) => {
  services.gitHubSyncService.testConnection.mockResolvedValue(isConnected);

  expect(await run(handleTestIntegration)).toEqual(answer);
  expect(services.gitHubSyncService.testConnection).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
  );
});

it("synchronizes the project right away", async () => {
  expect(await run(handleSyncIntegration)).toEqual(SUCCEEDED);
  expect(services.gitHubSyncService.syncProjectNow).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
  );
});

it.each([
  ["on", true],
  ["off", false],
])("switches the synchronization %s", async (switchValue, isEnabled) => {
  services.projectService.setIntegrationSyncEnabled.mockResolvedValue({
    projectId: PROJECT_ID,
  });

  expect(
    await run(handleSetIntegrationSync, { syncEnabled: switchValue }),
  ).toEqual(SUCCEEDED);
  expect(
    services.projectService.setIntegrationSyncEnabled,
  ).toHaveBeenCalledWith(ACTOR, PROJECT_ID, isEnabled);
});

it("refuses switching a project without GitHub connection", async () => {
  services.projectService.setIntegrationSyncEnabled.mockResolvedValue(null);

  expect(await run(handleSetIntegrationSync, { syncEnabled: "on" })).toEqual(
    INVALID,
  );
});

it("removes the GitHub connection", async () => {
  expect(await run(handleDisconnectIntegration)).toEqual(SUCCEEDED);
  expect(services.projectService.disconnectIntegration).toHaveBeenCalledWith(
    ACTOR,
    PROJECT_ID,
  );
});
