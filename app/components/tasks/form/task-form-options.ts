import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type { TFunction } from "i18next";

import type {
  WorkItemDetail,
  WorkItemPriority,
  WorkItemType,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/** A value the visitor can pick in one of the form's selects. */
export interface TaskFormOption<Value extends string = string> {
  readonly value: Value;
  readonly label: string;
}

/** The select that picks the parent of a work item of a given type. */
export interface ParentField {
  readonly id: string;
  readonly labelKey: string;
  readonly parentType: WorkItemType;
}

/** Parent select per work item type; types without an entry have no parent. */
export const PARENT_FIELDS: Readonly<
  Partial<Record<WorkItemType, ParentField>>
> = {
  [WORK_ITEM_TYPE.EPIC]: {
    id: "task-parent-initiative",
    labelKey: "tasks.fields.parentInitiative",
    parentType: WORK_ITEM_TYPE.INITIATIVE,
  },
  [WORK_ITEM_TYPE.TASK]: {
    id: "task-parent-epic",
    labelKey: "tasks.fields.parentEpic",
    parentType: WORK_ITEM_TYPE.EPIC,
  },
  [WORK_ITEM_TYPE.SUBTASK]: {
    id: "task-parent-task",
    labelKey: "tasks.fields.parentTask",
    parentType: WORK_ITEM_TYPE.TASK,
  },
};

/**
 * Lists the work item types a new item can be created as.
 *
 * @param translate - Translates the type names.
 */
export function workItemTypeOptions(
  translate: TFunction,
): TaskFormOption<WorkItemType>[] {
  return [
    { value: WORK_ITEM_TYPE.TASK, label: translate("tasks.type.task") },
    { value: WORK_ITEM_TYPE.EPIC, label: translate("tasks.type.epic") },
    {
      value: WORK_ITEM_TYPE.INITIATIVE,
      label: translate("tasks.type.initiative"),
    },
    { value: WORK_ITEM_TYPE.SUBTASK, label: translate("tasks.type.subtask") },
  ];
}

/**
 * Lists the priorities of a work item.
 *
 * @param translate - Translates the priority names.
 */
export function priorityOptions(
  translate: TFunction,
): TaskFormOption<WorkItemPriority>[] {
  return [
    { value: WORK_ITEM_PRIORITY.LOW, label: translate("tasks.priority.low") },
    {
      value: WORK_ITEM_PRIORITY.NORMAL,
      label: translate("tasks.priority.normal"),
    },
    { value: WORK_ITEM_PRIORITY.HIGH, label: translate("tasks.priority.high") },
    {
      value: WORK_ITEM_PRIORITY.URGENT,
      label: translate("tasks.priority.urgent"),
    },
  ];
}

/**
 * Lists the people who can be set as the reporter of a work item.
 *
 * @param initialTask - The edited work item.
 * @param assignees - Users that can work on the project.
 *
 * @remarks
 * The current reporter stays selectable even when they are no longer
 * an assignee, so saving the form does not change the reporter silently.
 */
export function reporterOptions(
  initialTask: WorkItemDetail,
  assignees: readonly User[],
): TaskFormOption[] {
  const assigneeOptions = assignees.map((assignee) => ({
    value: assignee.id,
    label: assignee.displayName,
  }));

  if (assignees.some((assignee) => assignee.id === initialTask.createdBy)) {
    return assigneeOptions;
  }

  return [
    {
      value: initialTask.createdBy,
      label: initialTask.reporterName ?? initialTask.createdBy,
    },
    ...assigneeOptions,
  ];
}

/** Which work items can become the parent of the edited item. */
export interface ParentCandidateQuery {
  readonly existingWorkItems: readonly WorkItemDetail[];
  readonly field: ParentField;
  readonly projectId: string;
  /** The edited item, which cannot be its own parent. */
  readonly editedItemId: string | undefined;
}

/**
 * Lists the work items that can become the parent of the edited item.
 *
 * @param query - Selects the candidates.
 * @param noneLabel - Label of the leading option that clears the parent.
 */
export function parentOptions(
  query: ParentCandidateQuery,
  noneLabel: string,
): TaskFormOption[] {
  const { existingWorkItems, field, projectId, editedItemId } = query;
  const candidates = existingWorkItems.filter(
    (item) =>
      item.projectId === projectId &&
      item.type === field.parentType &&
      item.id !== editedItemId,
  );

  return [
    { value: "", label: noneLabel },
    ...candidates.map((item) => ({
      value: item.id,
      label: `${item.key}: ${item.title}`,
    })),
  ];
}
