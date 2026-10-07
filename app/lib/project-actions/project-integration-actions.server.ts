import { readTextOrEmpty } from "@/app/lib/form-fields.server";
import { isGitHubSyncInterval } from "@/definition/Project";

import { invalidInput, succeeded } from "./project-action-support.server";

import type { ProjectActionHandler } from "./project-action-support.server";

/** Saves the GitHub connection settings of the project. */
export const handleSaveIntegration: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const direction = readTextOrEmpty(formData, "syncDirection");
  const interval = Number(readTextOrEmpty(formData, "syncIntervalMinutes"));

  if (!isGitHubSyncInterval(interval)) {
    return invalidInput();
  }

  await services.projectService.saveIntegration(actor, projectId, {
    repoUrl: readTextOrEmpty(formData, "repoUrl"),
    syncComments: formData.get("syncComments") === "on",
    syncCommits: formData.get("syncCommits") === "on",
    syncDirection:
      direction === "push" || direction === "pull"
        ? direction
        : "bidirectional",
    syncIntervalMinutes: interval,
    syncIssues: formData.get("syncIssues") === "on",
    syncPullRequests: formData.get("syncPullRequests") === "on",
    syncStatus: formData.get("syncStatus") === "on",
    token: readTextOrEmpty(formData, "token"),
  });

  return succeeded();
};

/** Checks whether the stored GitHub settings reach the repository. */
export const handleTestIntegration: ProjectActionHandler = async ({
  actor,
  projectId,
  services,
}) => {
  const isConnected = await services.gitHubSyncService.testConnection(
    actor,
    projectId,
  );

  return isConnected ? succeeded() : invalidInput();
};

/** Synchronizes the project with GitHub right away. */
export const handleSyncIntegration: ProjectActionHandler = async ({
  actor,
  projectId,
  services,
}) => {
  await services.gitHubSyncService.syncProjectNow(actor, projectId);

  return succeeded();
};

/** Switches the GitHub synchronization of the project on or off. */
export const handleSetIntegrationSync: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const integration = await services.projectService.setIntegrationSyncEnabled(
    actor,
    projectId,
    formData.get("syncEnabled") === "on",
  );

  return integration ? succeeded() : invalidInput();
};

/** Removes the GitHub connection of the project. */
export const handleDisconnectIntegration: ProjectActionHandler = async ({
  actor,
  projectId,
  services,
}) => {
  await services.projectService.disconnectIntegration(actor, projectId);

  return succeeded();
};
