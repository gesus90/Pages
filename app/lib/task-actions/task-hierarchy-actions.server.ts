import { readRequiredText, readText } from "@/app/lib/form-fields.server";

import {
  invalidInput,
  runTaskAction,
  runTicketAction,
} from "./task-action-support.server";

import type { TaskActionHandler } from "./task-action-support.server";

/** Saves a new ticket description written from the text the person started with. */
export const handleUpdateDescription: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const description = readText(formData, "description");
  const baseDescription = readText(formData, "baseDescription");

  if (id === null || description === null || baseDescription === null) {
    return invalidInput("update-description");
  }

  return runTicketAction("update-description", () =>
    services.taskService.updateDescription(actor, id, {
      baseDescription,
      description,
    }),
  );
};

/** Moves a ticket below another parent; an empty parent removes it. */
export const handleChangeParent: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const parentId = readText(formData, "parentId");

  if (id === null || parentId === null) {
    return invalidInput("change-parent");
  }

  return runTicketAction("change-parent", () =>
    services.taskService.changeParent(actor, id, parentId || null),
  );
};

/** Removes a file attached to a ticket. */
export const handleRemoveAttachment: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const attachmentId = readRequiredText(formData, "attachmentId");

  if (attachmentId === null) {
    return invalidInput("remove-attachment");
  }

  return runTaskAction("remove-attachment", () =>
    services.taskAttachmentService.remove(actor, attachmentId),
  );
};

/** Stores that the person opened or closed a branch of the ticket tree. */
export const handleSetTreeExpanded: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const nodeKey = readRequiredText(formData, "nodeKey");
  const expanded = readText(formData, "expanded");

  if (nodeKey === null || (expanded !== "1" && expanded !== "0")) {
    return invalidInput("set-tree-expanded");
  }

  return runTaskAction("set-tree-expanded", () =>
    services.ticketTreeService.setExpanded(actor, nodeKey, expanded === "1"),
  );
};
