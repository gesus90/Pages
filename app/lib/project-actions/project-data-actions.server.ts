import { readTextOrEmpty, readTrimmedText } from "@/app/lib/form-fields.server";
import {
  isProjectRole,
  isProjectStatus,
  MAXIMUM_PROJECT_DESCRIPTION_LENGTH,
} from "@/definition/Project";

import {
  invalidInput,
  succeeded,
  updateProjectDetails,
} from "./project-action-support.server";

import type { ProjectActionHandler } from "./project-action-support.server";

/** Saves the whole details form of the general tab. */
export const handleUpdateDetails: ProjectActionHandler = async (context) => {
  const { formData } = context;
  const status = readTextOrEmpty(formData, "status");

  if (!isProjectStatus(status)) {
    return invalidInput();
  }

  await updateProjectDetails(context, {
    description: readTextOrEmpty(formData, "description"),
    managerId: readTrimmedText(formData, "managerId"),
    name: readTextOrEmpty(formData, "name"),
    notes: readTextOrEmpty(formData, "notes"),
    startDate: readTrimmedText(formData, "startDate"),
    status,
    targetDate: readTrimmedText(formData, "targetDate"),
  });

  return succeeded();
};

/** Changes the status of the project. */
export const handleUpdateStatus: ProjectActionHandler = async (context) => {
  const status = readTextOrEmpty(context.formData, "status");

  if (!isProjectStatus(status)) {
    return invalidInput();
  }

  await updateProjectDetails(context, { status });

  return succeeded();
};

/** Changes the description of the project. */
export const handleUpdateDescription: ProjectActionHandler = async (
  context,
) => {
  const description = readTextOrEmpty(context.formData, "description");

  if (description.length > MAXIMUM_PROJECT_DESCRIPTION_LENGTH) {
    return invalidInput();
  }

  await updateProjectDetails(context, { description });

  return succeeded();
};

/** Changes the manager of the project. */
export const handleUpdateManager: ProjectActionHandler = async (context) => {
  await updateProjectDetails(context, {
    managerId: readTrimmedText(context.formData, "managerId"),
  });

  return succeeded();
};

/** Changes the start and target date of the project. */
export const handleUpdateDates: ProjectActionHandler = async (context) => {
  await updateProjectDetails(context, {
    startDate: readTrimmedText(context.formData, "startDate"),
    targetDate: readTrimmedText(context.formData, "targetDate"),
  });

  return succeeded();
};

/** Renames the project. */
export const handleUpdateName: ProjectActionHandler = async (context) => {
  await updateProjectDetails(context, {
    name: readTextOrEmpty(context.formData, "name"),
  });

  return succeeded();
};

/** Saves or refreshes the current project's reusable general snapshot. */
export const handleSaveTemplate: ProjectActionHandler = async ({
  actor,
  projectId,
  services,
}) => {
  await services.projectService.saveTemplate(actor, projectId);
  return succeeded();
};

/** Adds a goal to the project. */
export const handleCreateGoal: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  await services.projectService.createGoal(
    actor,
    projectId,
    readTextOrEmpty(formData, "title"),
  );

  return succeeded();
};

/** Marks a goal as done or open again. */
export const handleToggleGoal: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const goalId = readTextOrEmpty(formData, "goalId");
  const goals = await services.projectService.findGoals(actor, projectId);
  const goal = goals.find((entry) => entry.id === goalId);

  if (!goal) {
    return invalidInput();
  }

  await services.projectService.updateGoal(actor, projectId, goalId, {
    isDone: !goal.isDone,
    title: goal.title,
  });

  return succeeded();
};

/** Removes a goal. */
export const handleDeleteGoal: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  await services.projectService.deleteGoal(
    actor,
    projectId,
    readTextOrEmpty(formData, "goalId"),
  );

  return succeeded();
};

/** Replaces the tags of the project. */
export const handleSetTags: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  await services.projectService.setTags(
    actor,
    projectId,
    readTextOrEmpty(formData, "tags").split(","),
  );

  return succeeded();
};

/** Adds a user to the project team. */
export const handleAddMember: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const role = readTextOrEmpty(formData, "role");

  if (!isProjectRole(role)) {
    return invalidInput();
  }

  await services.projectService.addMember(
    actor,
    projectId,
    readTextOrEmpty(formData, "userId"),
    role,
  );

  return succeeded();
};

/** Changes the project role of a team member. */
export const handleUpdateMemberRole: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  const role = readTextOrEmpty(formData, "role");

  if (!isProjectRole(role)) {
    return invalidInput();
  }

  await services.projectService.updateMemberRole(
    actor,
    projectId,
    readTextOrEmpty(formData, "userId"),
    role,
  );

  return succeeded();
};

/** Removes a user from the project team. */
export const handleRemoveMember: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  await services.projectService.removeMember(
    actor,
    projectId,
    readTextOrEmpty(formData, "userId"),
  );

  return succeeded();
};

/** Adds an event to the project calendar. */
export const handleCreateEvent: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  await services.projectService.createEvent(actor, projectId, {
    description: readTextOrEmpty(formData, "description"),
    eventDate: readTextOrEmpty(formData, "eventDate").trim(),
    eventTime: readTrimmedText(formData, "eventTime"),
    title: readTextOrEmpty(formData, "title"),
    type: readTrimmedText(formData, "type") ?? "general",
  });

  return succeeded();
};

/** Archives an event of the project calendar. */
export const handleArchiveEvent: ProjectActionHandler = async ({
  actor,
  formData,
  projectId,
  services,
}) => {
  await services.projectService.archiveEvent(
    actor,
    projectId,
    readTextOrEmpty(formData, "eventId"),
  );

  return succeeded();
};
