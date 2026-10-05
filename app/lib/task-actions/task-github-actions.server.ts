import {
  readOptionalText,
  readRequiredText,
} from "@/app/lib/form-fields.server";

import {
  invalidInput,
  runTaskAction,
  runTicketAction,
} from "./task-action-support.server";

import type { TaskActionHandler } from "./task-action-support.server";

/** Synchronizes a whole project with GitHub right away. */
export const handleSyncGitHubProject: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const projectId = readRequiredText(formData, "projectId");

  if (projectId === null) {
    return invalidInput("sync-github-project");
  }

  return runTaskAction("sync-github-project", () =>
    services.gitHubSyncService.syncProjectNow(actor, projectId),
  );
};

/** Synchronizes one ticket with GitHub right away. */
export const handleSyncGitHubTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");

  if (id === null) {
    return invalidInput("sync-github-task");
  }

  return runTaskAction("sync-github-task", () =>
    services.gitHubSyncService.syncSingleTask(actor, id),
  );
};

/** Turns a GitHub issue into a ticket. */
export const handleImportGitHubIssue: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const projectId = readRequiredText(formData, "projectId");
  const issueNumber = Number(formData.get("issueNumber"));

  if (
    projectId === null ||
    !Number.isInteger(issueNumber) ||
    issueNumber <= 0
  ) {
    return invalidInput("github-import-issue");
  }

  return runTicketAction("github-import-issue", () =>
    services.gitHubSyncService.importExternalIssue(
      actor,
      projectId,
      issueNumber,
    ),
  );
};

/** Links an existing ticket to a GitHub issue. */
export const handleLinkGitHubIssue: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "workItemId");
  const externalId = readRequiredText(formData, "externalId");

  if (id === null || externalId === null) {
    return invalidInput("github-link-issue");
  }

  return runTicketAction("github-link-issue", () =>
    services.gitHubSyncService.linkExternalIssue(actor, id, externalId),
  );
};

/** Hides a GitHub issue from the import list. */
export const handleDismissGitHubIssue: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const externalId = readRequiredText(formData, "externalId");

  if (externalId === null) {
    return invalidInput("github-dismiss-issue");
  }

  return runTaskAction("github-dismiss-issue", () =>
    services.gitHubSyncService.dismissExternalIssue(actor, externalId),
  );
};

/** Attaches a pull request to a ticket, or detaches it. */
export const handleAssignPullRequest: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const pullRequestId = readRequiredText(formData, "pullRequestId");

  if (pullRequestId === null) {
    return invalidInput("github-assign-pr");
  }

  return runTaskAction("github-assign-pr", () =>
    services.gitHubSyncService.assignPullRequest(
      actor,
      pullRequestId,
      readOptionalText(formData, "workItemId"),
    ),
  );
};

/** Decides which side wins when a ticket and its GitHub issue diverged. */
export const handleResolveGitHubConflict: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const resolution = formData.get("resolution");

  if (id === null || (resolution !== "pages" && resolution !== "github")) {
    return invalidInput("github-resolve-conflict");
  }

  return runTicketAction("github-resolve-conflict", () =>
    services.gitHubSyncService.resolveConflict(actor, id, resolution),
  );
};
