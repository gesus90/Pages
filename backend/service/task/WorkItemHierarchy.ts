import { WORK_ITEM_TYPE } from "@/definition/Task";
import { WorkItemHierarchyError } from "@/backend/error/WorkItemErrors";

import type { WorkItemDetail, WorkItemType } from "@/definition/Task";

/** Rules for the parent of each work item type that can have one. */
export interface ParentRule {
  readonly parentType: WorkItemType;
  readonly requiredMessage: string | null;
  readonly selfMessage: string;
  readonly missingMessage: string;
  readonly typeMessage: string;
  readonly projectMessage: string;
}

const PARENT_RULES: Readonly<
  Record<Exclude<WorkItemType, "initiative">, ParentRule>
> = {
  epic: {
    missingMessage: "The specified Initiative does not exist.",
    parentType: WORK_ITEM_TYPE.INITIATIVE,
    projectMessage: "Parent Initiative must belong to the same project.",
    requiredMessage: null,
    selfMessage: "An Epic cannot be its own parent.",
    typeMessage: "An Epic can only belong to an Initiative.",
  },
  subtask: {
    missingMessage: "The specified parent task does not exist.",
    parentType: WORK_ITEM_TYPE.TASK,
    projectMessage: "Parent task must belong to the same project.",
    requiredMessage: "A Subtask must have an associated parent task.",
    selfMessage: "A Subtask cannot be its own parent.",
    typeMessage: "A Subtask can only be attached to a Task.",
  },
  task: {
    missingMessage: "The specified Epic does not exist.",
    parentType: WORK_ITEM_TYPE.EPIC,
    projectMessage: "Parent Epic must belong to the same project.",
    requiredMessage: null,
    selfMessage: "A Task cannot be its own parent.",
    typeMessage: "A Task can only have an Epic as its parent.",
  },
};

/** A parent that still has to be looked up and checked against its rule. */
export interface ParentLookup {
  readonly parentId: string;
  readonly rule: ParentRule;
}

/**
 * Checks the parent reference of a work item against what its type allows.
 *
 * @param type - Type of the work item that gets the parent.
 * @param parentId - Requested parent, or `null` for none.
 * @param selfId - Identifier of the work item itself, or `null` while creating.
 * @returns The parent to look up with the rule it must satisfy, or `null`
 * when the work item has no parent to look up.
 * @throws {WorkItemHierarchyError} When the reference alone already violates the hierarchy.
 */
export function selectParentLookup(
  type: WorkItemType,
  parentId: string | null,
  selfId: string | null,
): ParentLookup | null {
  if (type === WORK_ITEM_TYPE.INITIATIVE) {
    if (parentId !== null) {
      throw new WorkItemHierarchyError(
        "An Initiative cannot have a parent work item.",
      );
    }

    return null;
  }

  const rule = PARENT_RULES[type];

  if (!parentId) {
    if (rule.requiredMessage !== null) {
      throw new WorkItemHierarchyError(rule.requiredMessage);
    }

    return null;
  }

  if (selfId && parentId === selfId) {
    throw new WorkItemHierarchyError(rule.selfMessage);
  }

  return { parentId, rule };
}

/**
 * Checks a stored parent against the rule selected for the child.
 *
 * @param parent - Stored parent, or `null` when it does not exist.
 * @param rule - Rule selected for the type of the child.
 * @param projectId - Project the child belongs to.
 * @throws {WorkItemHierarchyError} When the parent is missing, of the wrong type or in another project.
 */
export function assertParentFits(
  parent: WorkItemDetail | null,
  rule: ParentRule,
  projectId: string,
): void {
  if (!parent) {
    throw new WorkItemHierarchyError(rule.missingMessage);
  }

  if (parent.type !== rule.parentType) {
    throw new WorkItemHierarchyError(rule.typeMessage);
  }

  if (parent.projectId !== projectId) {
    throw new WorkItemHierarchyError(rule.projectMessage);
  }
}
