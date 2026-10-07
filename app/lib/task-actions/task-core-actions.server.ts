import {
  readOptionalText,
  readRequiredText,
  readText,
  readTextOrEmpty,
} from "@/app/lib/form-fields.server";
import { resolveLocalRedirect } from "@/app/lib/redirect.server";
import {
  isWorkItemPriority,
  isWorkItemType,
  WORK_ITEM_PRIORITY,
} from "@/definition/Task";

import {
  invalidInput,
  runTaskAction,
  runTaskActionThenRedirect,
  runTicketAction,
} from "./task-action-support.server";

import type { TaskActionHandler } from "./task-action-support.server";

/** Creates a ticket. */
export const handleCreateTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const projectId = readText(formData, "projectId");
  const type = formData.get("type");
  const title = readText(formData, "title");
  const statusId = readText(formData, "statusId");
  const priority = formData.get("priority");

  if (
    projectId === null ||
    !isWorkItemType(type) ||
    title === null ||
    statusId === null
  ) {
    return invalidInput("create-task");
  }

  const input = {
    assigneeGroupId: readOptionalText(formData, "assigneeGroupId"),
    assigneeId: readOptionalText(formData, "assigneeId"),
    departmentId: readOptionalText(formData, "departmentId"),
    description: readTextOrEmpty(formData, "description"),
    dueAt: readOptionalText(formData, "dueAt"),
    milestoneId: readOptionalText(formData, "milestoneId"),
    parentId: readOptionalText(formData, "parentId"),
    priority: isWorkItemPriority(priority)
      ? priority
      : WORK_ITEM_PRIORITY.NORMAL,
    projectId,
    startAt: readOptionalText(formData, "startAt"),
    statusId,
    title,
    type,
  };
  // A template adds its labels and checklist to the ticket after creation.
  const templateId = readOptionalText(formData, "templateId");

  return runTicketAction("create-task", () =>
    templateId === null
      ? services.taskService.create(actor, input)
      : services.taskTemplateService.createFromTemplate(
          actor,
          templateId,
          input,
        ),
  );
};

/** Changes the editable values of a ticket. */
export const handleUpdateTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readText(formData, "id");
  const title = readText(formData, "title");
  const statusId = readText(formData, "statusId");
  const priority = formData.get("priority");
  const reporterId = readText(formData, "reporterId");

  if (
    id === null ||
    title === null ||
    statusId === null ||
    !isWorkItemPriority(priority) ||
    reporterId === null
  ) {
    return invalidInput("update-task");
  }

  return runTicketAction("update-task", () =>
    services.taskService.update(actor, id, {
      assigneeGroupId: readOptionalText(formData, "assigneeGroupId"),
      assigneeId: readOptionalText(formData, "assigneeId"),
      description: readTextOrEmpty(formData, "description"),
      dueAt: readOptionalText(formData, "dueAt"),
      milestoneId: readOptionalText(formData, "milestoneId"),
      parentId: readOptionalText(formData, "parentId"),
      priority,
      reporterId,
      startAt: readOptionalText(formData, "startAt"),
      statusId,
      title,
    }),
  );
};

/** Moves a ticket to another board column and position. */
export const handleMoveTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readText(formData, "id");
  const statusId = readText(formData, "statusId");
  const sortOrder = readText(formData, "sortOrder");

  if (id === null || statusId === null || sortOrder === null) {
    return invalidInput("move-task");
  }

  return runTicketAction("move-task", () =>
    services.taskService.updateStatusAndOrder(
      actor,
      id,
      statusId,
      Number(sortOrder),
    ),
  );
};

/** Archives a ticket. */
export const handleArchiveTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");

  if (id === null) {
    return invalidInput("archive-task");
  }

  return runTaskAction("archive-task", () =>
    services.taskService.archive(actor, id),
  );
};

/** Brings an archived ticket back. */
export const handleRestoreTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");

  if (id === null) {
    return invalidInput("restore-task");
  }

  return runTaskAction("restore-task", () =>
    services.taskService.restore(actor, id),
  );
};

/** Permanently deletes a ticket with its subtree; administrator mode only. */
export const handleDeleteTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");

  if (id === null) {
    return invalidInput("delete-task");
  }

  return runTaskActionThenRedirect(
    "delete-task",
    () => services.taskService.deletePermanently(actor, id),
    resolveLocalRedirect(formData.get("redirectTo"), "/aufgaben"),
  );
};

/** Assigns a ticket to a department, or clears its department; separate from content edits. */
export const handleSetDepartment: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  // An empty value clears the department, so the field itself must be present.
  const departmentId = readText(formData, "departmentId");

  if (id === null || departmentId === null) {
    return invalidInput("set-department");
  }

  return runTaskAction("set-department", () =>
    services.taskService.setDepartment(actor, id, departmentId),
  );
};

/** Moves a ticket, with its subtree, into another project. */
export const handleMoveProject: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const targetProjectId = readRequiredText(formData, "targetProjectId");

  if (id === null || targetProjectId === null) {
    return invalidInput("move-project");
  }

  return runTicketAction("move-project", () =>
    services.taskService.moveToProject(actor, id, targetProjectId),
  );
};
