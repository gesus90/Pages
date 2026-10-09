import {
  handleAddChecklistItem,
  handleAddLink,
  handleAssignLabel,
  handleCreateLabel,
  handleDeleteChecklistItem,
  handleDeleteLabel,
  handleRemoveLink,
  handleToggleChecklistItem,
  handleUnassignLabel,
  handleUpdateLabel,
} from "./task-detail-actions.server";
import {
  handleAssignPullRequest,
  handleDismissGitHubIssue,
  handleImportGitHubIssue,
  handleLinkGitHubIssue,
  handleResolveGitHubConflict,
  handleSyncGitHubProject,
  handleSyncGitHubTask,
} from "./task-github-actions.server";
import { handleSaveBoardPreferences } from "./task-board-actions.server";
import {
  handleChangeParent,
  handleRemoveAttachment,
  handleSetTreeExpanded,
  handleUpdateDescription,
} from "./task-hierarchy-actions.server";
import {
  handleDeleteTemplate,
  handleSaveTemplate,
} from "./task-template-actions.server";
import { invalidInput } from "./task-action-support.server";
import {
  handleArchiveTask,
  handleCreateTask,
  handleDeleteTask,
  handleMoveProject,
  handleMoveTask,
  handleRestoreTask,
  handleSetDepartment,
  handleUpdateTask,
} from "./task-core-actions.server";

import type {
  TaskActionContext,
  TaskActionHandler,
  TaskActionIntent,
  TaskActionResponse,
} from "./task-action-support.server";

const TASK_ACTION_HANDLERS: Readonly<
  Record<TaskActionIntent, TaskActionHandler>
> = {
  "archive-task": handleArchiveTask,
  "change-parent": handleChangeParent,
  "checklist-add": handleAddChecklistItem,
  "checklist-delete": handleDeleteChecklistItem,
  "checklist-toggle": handleToggleChecklistItem,
  "create-task": handleCreateTask,
  "delete-task": handleDeleteTask,
  "delete-template": handleDeleteTemplate,
  "github-assign-pr": handleAssignPullRequest,
  "github-dismiss-issue": handleDismissGitHubIssue,
  "github-import-issue": handleImportGitHubIssue,
  "github-link-issue": handleLinkGitHubIssue,
  "github-resolve-conflict": handleResolveGitHubConflict,
  "label-assign": handleAssignLabel,
  "label-create": handleCreateLabel,
  "label-delete": handleDeleteLabel,
  "label-unassign": handleUnassignLabel,
  "label-update": handleUpdateLabel,
  "link-add": handleAddLink,
  "link-remove": handleRemoveLink,
  "move-project": handleMoveProject,
  "move-task": handleMoveTask,
  "remove-attachment": handleRemoveAttachment,
  "restore-task": handleRestoreTask,
  "save-board-preferences": handleSaveBoardPreferences,
  "save-template": handleSaveTemplate,
  "set-department": handleSetDepartment,
  "set-tree-expanded": handleSetTreeExpanded,
  "sync-github-project": handleSyncGitHubProject,
  "sync-github-task": handleSyncGitHubTask,
  "update-description": handleUpdateDescription,
  "update-task": handleUpdateTask,
};

function isTaskActionIntent(value: unknown): value is TaskActionIntent {
  return (
    typeof value === "string" && Object.hasOwn(TASK_ACTION_HANDLERS, value)
  );
}

/**
 * Runs the ticket action a form submission asks for.
 *
 * @param intent - The `intent` field of the submitted form.
 * @param context - Actor, form fields and services of the request.
 * @returns The response for the client; unknown intents count as invalid input.
 */
export async function handleTaskAction(
  intent: FormDataEntryValue | null,
  context: TaskActionContext,
): Promise<TaskActionResponse> {
  if (!isTaskActionIntent(intent)) {
    return invalidInput("create-task");
  }

  return TASK_ACTION_HANDLERS[intent](context);
}
