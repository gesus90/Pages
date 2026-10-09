import { WORK_ITEM_TYPE } from "@/definition/Task";
import { WorkItemHierarchyError } from "@/backend/error/WorkItemErrors";

import type { WorkItemErrorCode } from "@/backend/error/WorkItemErrors";
import type { WorkItemDetail, WorkItemType } from "@/definition/Task";

/** Rules for the parent of each work item type that can have one. */
export interface ParentRule {
  readonly parentType: WorkItemType;
  readonly requiredCode: WorkItemErrorCode | null;
  readonly selfCode: WorkItemErrorCode;
  readonly missingCode: WorkItemErrorCode;
  readonly typeCode: WorkItemErrorCode;
  readonly projectCode: WorkItemErrorCode;
}

const PARENT_RULES: Readonly<
  Record<Exclude<WorkItemType, "initiative">, ParentRule>
> = {
  epic: {
    missingCode: "initiativeMissing",
    parentType: WORK_ITEM_TYPE.INITIATIVE,
    projectCode: "initiativeOtherProject",
    requiredCode: null,
    selfCode: "epicSelfParent",
    typeCode: "epicParentType",
  },
  subtask: {
    missingCode: "parentTaskMissing",
    parentType: WORK_ITEM_TYPE.TASK,
    projectCode: "parentTaskOtherProject",
    requiredCode: "subtaskParentRequired",
    selfCode: "subtaskSelfParent",
    typeCode: "subtaskParentType",
  },
  task: {
    missingCode: "epicMissing",
    parentType: WORK_ITEM_TYPE.EPIC,
    projectCode: "epicOtherProject",
    requiredCode: null,
    selfCode: "taskSelfParent",
    typeCode: "taskParentType",
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
      throw new WorkItemHierarchyError("initiativeNoParent");
    }

    return null;
  }

  const rule = PARENT_RULES[type];

  if (!parentId) {
    if (rule.requiredCode !== null) {
      throw new WorkItemHierarchyError(rule.requiredCode);
    }

    return null;
  }

  if (selfId && parentId === selfId) {
    throw new WorkItemHierarchyError(rule.selfCode);
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
): asserts parent is WorkItemDetail {
  if (!parent) {
    throw new WorkItemHierarchyError(rule.missingCode);
  }

  if (parent.type !== rule.parentType) {
    throw new WorkItemHierarchyError(rule.typeCode);
  }

  if (parent.projectId !== projectId) {
    throw new WorkItemHierarchyError(rule.projectCode);
  }
}

/**
 * Checks that a newly chosen parent is active, so no active work item ends up
 * below an archived one.
 *
 * @param parent - The parent that fits the rule of the child.
 * @throws {WorkItemHierarchyError} When the parent is archived.
 */
export function assertParentActive(parent: WorkItemDetail): void {
  if (parent.archivedAt !== null) {
    throw new WorkItemHierarchyError("parentArchived");
  }
}
