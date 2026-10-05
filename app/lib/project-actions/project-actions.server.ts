import { invalidInput } from "./project-action-support.server";
import {
  handleAddMember,
  handleArchiveEvent,
  handleCreateEvent,
  handleCreateGoal,
  handleDeleteGoal,
  handleRemoveMember,
  handleSetTags,
  handleToggleGoal,
  handleUpdateDates,
  handleUpdateDescription,
  handleUpdateDetails,
  handleUpdateManager,
  handleUpdateMemberRole,
  handleUpdateName,
  handleUpdateStatus,
} from "./project-data-actions.server";
import {
  handleDisconnectIntegration,
  handleSaveIntegration,
  handleSyncIntegration,
  handleTestIntegration,
} from "./project-integration-actions.server";
import {
  handleCreateMilestone,
  handleDeleteMilestone,
  handleSaveMilestone,
  handleUpdateMilestoneStatus,
} from "./project-milestone-actions.server";

import type {
  ProjectActionContext,
  ProjectActionHandler,
  ProjectActionResponse,
} from "./project-action-support.server";

const PROJECT_ACTION_HANDLERS = {
  "add-member": handleAddMember,
  "archive-event": handleArchiveEvent,
  "create-event": handleCreateEvent,
  "create-goal": handleCreateGoal,
  "create-milestone": handleCreateMilestone,
  "delete-goal": handleDeleteGoal,
  "delete-milestone": handleDeleteMilestone,
  "disconnect-integration": handleDisconnectIntegration,
  "remove-member": handleRemoveMember,
  "save-integration": handleSaveIntegration,
  "save-milestone": handleSaveMilestone,
  "set-tags": handleSetTags,
  "sync-integration": handleSyncIntegration,
  "test-integration": handleTestIntegration,
  "toggle-goal": handleToggleGoal,
  "update-dates": handleUpdateDates,
  "update-description": handleUpdateDescription,
  "update-details": handleUpdateDetails,
  "update-manager": handleUpdateManager,
  "update-member-role": handleUpdateMemberRole,
  "update-milestone-status": handleUpdateMilestoneStatus,
  "update-name": handleUpdateName,
  "update-status": handleUpdateStatus,
} satisfies Record<string, ProjectActionHandler>;

type ProjectActionIntent = keyof typeof PROJECT_ACTION_HANDLERS;

function isProjectActionIntent(value: unknown): value is ProjectActionIntent {
  return (
    typeof value === "string" && Object.hasOwn(PROJECT_ACTION_HANDLERS, value)
  );
}

/**
 * Runs the project detail action a form submission asks for.
 *
 * @param intent - The `intent` field of the submitted form.
 * @param context - Actor, form fields, project and services of the request.
 * @returns The response for the client; unknown intents count as invalid
 * input.
 * @throws Whatever the services throw; callers map it with `toActionError`.
 */
export async function handleProjectAction(
  intent: FormDataEntryValue | null,
  context: ProjectActionContext,
): Promise<ProjectActionResponse> {
  if (!isProjectActionIntent(intent)) {
    return invalidInput();
  }

  return PROJECT_ACTION_HANDLERS[intent](context);
}
