import {
  readOptionalText,
  readRequiredText,
} from "@/app/lib/form-fields.server";
import { isTemplateScope } from "@/definition/WorkItemTemplate";

import { invalidInput, runTaskAction } from "./task-action-support.server";

import type { TaskActionHandler } from "./task-action-support.server";

/** Saves a ticket as a template, or renames and reshares a template; the form names one of the two. */
export const handleSaveTemplate: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const name = readRequiredText(formData, "name");
  const scope = formData.get("scope");
  const ticketId = readOptionalText(formData, "ticketId");
  const templateId = readOptionalText(formData, "templateId");

  if (name === null || !isTemplateScope(scope)) {
    return invalidInput("save-template");
  }

  const details = {
    departmentIds: formData.getAll("departmentIds").filter(isText),
    name,
    projectIds: formData.getAll("projectIds").filter(isText),
    scope,
  };

  if (templateId !== null && ticketId === null) {
    return runTaskAction("save-template", () =>
      services.taskTemplateService.update(actor, templateId, details),
    );
  }

  if (ticketId !== null && templateId === null) {
    return runTaskAction("save-template", () =>
      services.taskTemplateService.saveFromTicket(actor, ticketId, details),
    );
  }

  return invalidInput("save-template");
};

/** Deletes a template. */
export const handleDeleteTemplate: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const templateId = readRequiredText(formData, "templateId");

  if (templateId === null) {
    return invalidInput("delete-template");
  }

  return runTaskAction("delete-template", () =>
    services.taskTemplateService.delete(actor, templateId),
  );
};

function isText(entry: FormDataEntryValue): entry is string {
  return typeof entry === "string";
}
