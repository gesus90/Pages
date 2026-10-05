import { readRequiredText, readText } from "@/app/lib/form-fields.server";
import { isWorkItemLinkType } from "@/definition/Task";

import { invalidInput, runTaskAction } from "./task-action-support.server";

import type { TaskActionHandler } from "./task-action-support.server";

/** Creates a label in a project. */
export const handleCreateLabel: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const projectId = readRequiredText(formData, "projectId");
  const name = readText(formData, "name");
  const color = readText(formData, "color");

  if (projectId === null || name === null || color === null) {
    return invalidInput("label-create");
  }

  return runTaskAction("label-create", async () => {
    await services.taskService.createLabel(actor, projectId, { color, name });
  });
};

/** Renames or recolors a label. */
export const handleUpdateLabel: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const labelId = readRequiredText(formData, "labelId");
  const name = readText(formData, "name");
  const color = readText(formData, "color");

  if (labelId === null || name === null || color === null) {
    return invalidInput("label-update");
  }

  return runTaskAction("label-update", async () => {
    await services.taskService.updateLabel(actor, labelId, { color, name });
  });
};

/** Deletes a label. */
export const handleDeleteLabel: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const labelId = readRequiredText(formData, "labelId");

  if (labelId === null) {
    return invalidInput("label-delete");
  }

  return runTaskAction("label-delete", () =>
    services.taskService.deleteLabel(actor, labelId),
  );
};

/** Puts a label on a ticket. */
export const handleAssignLabel: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const workItemId = readRequiredText(formData, "workItemId");
  const labelId = readRequiredText(formData, "labelId");

  if (workItemId === null || labelId === null) {
    return invalidInput("label-assign");
  }

  return runTaskAction("label-assign", () =>
    services.taskService.assignLabel(actor, workItemId, labelId),
  );
};

/** Takes a label off a ticket. */
export const handleUnassignLabel: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const workItemId = readRequiredText(formData, "workItemId");
  const labelId = readRequiredText(formData, "labelId");

  if (workItemId === null || labelId === null) {
    return invalidInput("label-unassign");
  }

  return runTaskAction("label-unassign", () =>
    services.taskService.unassignLabel(actor, workItemId, labelId),
  );
};

/** Adds an item to the checklist of a ticket. */
export const handleAddChecklistItem: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const workItemId = readRequiredText(formData, "workItemId");
  const title = readText(formData, "title");

  if (workItemId === null || title === null || !title.trim()) {
    return invalidInput("checklist-add");
  }

  return runTaskAction("checklist-add", async () => {
    await services.taskService.addChecklistItem(actor, workItemId, title);
  });
};

/** Checks or unchecks a checklist item. */
export const handleToggleChecklistItem: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const checklistItemId = readRequiredText(formData, "checklistItemId");

  if (checklistItemId === null) {
    return invalidInput("checklist-toggle");
  }

  return runTaskAction("checklist-toggle", async () => {
    await services.taskService.setChecklistItemDone(
      actor,
      checklistItemId,
      formData.get("isDone") === "true",
    );
  });
};

/** Removes a checklist item. */
export const handleDeleteChecklistItem: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const checklistItemId = readRequiredText(formData, "checklistItemId");

  if (checklistItemId === null) {
    return invalidInput("checklist-delete");
  }

  return runTaskAction("checklist-delete", () =>
    services.taskService.deleteChecklistItem(actor, checklistItemId),
  );
};

/** Links two tickets. */
export const handleAddLink: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const workItemId = readRequiredText(formData, "workItemId");
  const targetKey = readText(formData, "targetKey");
  const linkType = formData.get("linkType");

  if (
    workItemId === null ||
    targetKey === null ||
    !targetKey.trim() ||
    !isWorkItemLinkType(linkType)
  ) {
    return invalidInput("link-add");
  }

  return runTaskAction("link-add", async () => {
    await services.taskService.addLink(actor, workItemId, targetKey, linkType);
  });
};

/** Removes a link between two tickets. */
export const handleRemoveLink: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const workItemId = readRequiredText(formData, "workItemId");
  const linkId = readRequiredText(formData, "linkId");

  if (workItemId === null || linkId === null) {
    return invalidInput("link-remove");
  }

  return runTaskAction("link-remove", () =>
    services.taskService.removeLink(actor, workItemId, linkId),
  );
};
