import {
  readOptionalText,
  readRequiredText,
  readText,
  readTextOrEmpty,
} from "@/app/lib/form-fields.server";
import { resolveLocalRedirect } from "@/app/lib/redirect.server";
import { parseTaskUpdateSnapshot } from "@/definition/TaskUpdateSnapshot";
import { movedTicketImpact, ticketImpact } from "./task-action-impact.server";
import {
  isChildHandling,
  isWorkItemPriority,
  isWorkItemType,
  WORK_ITEM_PRIORITY,
} from "@/definition/Task";

import {
  invalidInput,
  runTaskAction,
  runTaskActionThenRedirect,
  runTicketAction,
  runTicketImpactAction,
  runTicketUpdateAction,
} from "./task-action-support.server";

import type { ChildHandling } from "@/definition/Task";
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

  if (formData.get("boardLocal") === "true") {
    return runTicketImpactAction("create-task", async () => {
      const ticket =
        templateId === null
          ? await services.taskService.create(actor, input)
          : await services.taskTemplateService.createFromTemplate(
              actor,
              templateId,
              input,
            );
      const ids = ticket.parentId ? [ticket.parentId] : [];
      return ticketImpact(services.taskService, actor, {
        key: ticket.key,
        rootId: ticket.id,
        ids,
      });
    });
  }

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
  const description = readText(formData, "description");
  const baseDescription = readText(formData, "baseDescription");
  const expectedText = readText(formData, "expectedSnapshot");
  const expected =
    expectedText === null ? undefined : parseTaskUpdateSnapshot(expectedText);

  if (
    id === null ||
    title === null ||
    statusId === null ||
    !isWorkItemPriority(priority) ||
    reporterId === null ||
    (description !== null && baseDescription === null) ||
    expected === null
  ) {
    return invalidInput("update-task");
  }

  const input = {
    assigneeGroupId: readOptionalText(formData, "assigneeGroupId"),
    assigneeId: readOptionalText(formData, "assigneeId"),
    // Absent fields keep the stored description (A8.2-E05).
    baseDescription: baseDescription ?? undefined,
    description: description ?? undefined,
    expected,
    dueAt: readOptionalText(formData, "dueAt"),
    milestoneId: readOptionalText(formData, "milestoneId"),
    parentId: readOptionalText(formData, "parentId"),
    priority,
    reporterId,
    startAt: readOptionalText(formData, "startAt"),
    statusId,
    title,
  };
  if (formData.get("boardLocal") === "true") {
    return runTicketImpactAction("update-task", async () => {
      const before = await services.taskService.getById(actor, id);
      const ticket = await services.taskService.update(actor, id, input);
      const ids =
        before.parentId === ticket.parentId
          ? []
          : [before.parentId, ticket.parentId].filter(
              (value) => value !== null,
            );
      return ticketImpact(services.taskService, actor, {
        key: ticket.key,
        rootId: id,
        ids,
      });
    });
  }
  return runTicketUpdateAction("update-task", () =>
    services.taskService.update(actor, id, input),
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

/** Changes the status only if it still matches the displayed status. */
export const handleSetTicketStatus: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const statusId = readRequiredText(formData, "statusId");
  const baseStatusId = readRequiredText(formData, "baseStatusId");

  if (id === null || statusId === null || baseStatusId === null) {
    return invalidInput("set-ticket-status");
  }

  return runTicketUpdateAction("set-ticket-status", () =>
    services.taskService.updateStatus(actor, id, { baseStatusId, statusId }),
  );
};

/** Reads how the children of an archived or deleted ticket are handled; absent means all go along. */
function readChildHandling(formData: FormData): ChildHandling | null {
  const value = readText(formData, "children") ?? "include";

  return isChildHandling(value) ? value : null;
}

/** Archives a ticket, with its descendants or keeping its direct children. */
export const handleArchiveTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const handling = readChildHandling(formData);

  if (id === null || handling === null) {
    return invalidInput("archive-task");
  }

  if (formData.get("boardLocal") === "true") {
    return runTicketImpactAction("archive-task", async () => {
      const before = await services.taskService.getById(actor, id);
      const impact = await services.taskService.archiveWithImpact(
        actor,
        id,
        handling,
      );
      const ids = impact.parentId
        ? [...impact.ticketIds, impact.parentId]
        : impact.ticketIds;
      return ticketImpact(services.taskService, actor, {
        key: before.key,
        rootId: id,
        ids,
      });
    });
  }

  return runTaskAction("archive-task", () =>
    services.taskService.archive(actor, id, handling),
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

  if (formData.get("boardLocal") === "true") {
    return runTicketImpactAction("restore-task", async () => {
      const before = await services.taskService.getById(actor, id);
      const impact = await services.taskService.restoreWithImpact(actor, id);
      const ids = impact.parentId
        ? [...impact.ticketIds, impact.parentId]
        : impact.ticketIds;
      return ticketImpact(services.taskService, actor, {
        key: before.key,
        rootId: id,
        ids,
      });
    });
  }

  return runTaskAction("restore-task", () =>
    services.taskService.restore(actor, id),
  );
};

/** Permanently deletes a ticket with its subtree or keeping its direct children; administrator mode only. */
export const handleDeleteTask: TaskActionHandler = async ({
  actor,
  formData,
  services,
}) => {
  const id = readRequiredText(formData, "id");
  const handling = readChildHandling(formData);

  if (id === null || handling === null) {
    return invalidInput("delete-task");
  }

  return runTaskActionThenRedirect(
    "delete-task",
    () => services.taskService.deletePermanently(actor, id, handling),
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

  if (formData.has("expectedDepartmentId")) {
    const expectedText = readText(formData, "expectedDepartmentId");
    if (expectedText === null) return invalidInput("set-department");
    const expected = expectedText.trim() || null;
    return runTicketUpdateAction("set-department", async () => {
      await services.taskService.setDepartment(
        actor,
        id,
        departmentId,
        expected,
      );
      return services.taskService.getById(actor, id);
    });
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

  if (formData.has("expectedSnapshot") || formData.has("baseProjectId")) {
    const expectedText = readText(formData, "expectedSnapshot");
    const projectId = readRequiredText(formData, "baseProjectId");
    const issueText = readText(formData, "baseGithubIssueNumber");
    const fields = expectedText && parseTaskUpdateSnapshot(expectedText);
    const githubIssueNumber = issueText === "" ? null : Number(issueText);
    if (
      !fields ||
      projectId === null ||
      issueText === null ||
      (githubIssueNumber !== null &&
        (!Number.isSafeInteger(githubIssueNumber) || githubIssueNumber < 1))
    ) {
      return invalidInput("move-project");
    }
    if (formData.get("boardLocal") === "true") {
      return runTicketImpactAction("move-project", async () => {
        const before = await services.taskService.getById(actor, id);
        const ticket = await services.taskService.moveToProject(
          actor,
          id,
          targetProjectId,
          {
            fields,
            githubIssueNumber,
            projectId,
          },
        );
        return movedTicketImpact(
          services.taskService,
          actor,
          ticket,
          before.parentId,
        );
      });
    }
    return runTicketAction("move-project", () =>
      services.taskService.moveToProject(actor, id, targetProjectId, {
        fields,
        githubIssueNumber,
        projectId,
      }),
    );
  }

  return runTicketAction("move-project", () =>
    services.taskService.moveToProject(actor, id, targetProjectId),
  );
};
