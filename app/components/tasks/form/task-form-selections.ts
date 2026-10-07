import { useEffect, useState } from "react";

import { toAssigneeValue } from "@/app/lib/assignee-value";
import { WORK_ITEM_PRIORITY } from "@/definition/Task";

import type { Project } from "@/definition/Project";
import type {
  WorkItemDetail,
  WorkItemPriority,
  WorkItemType,
} from "@/definition/Task";

/** Values of the form's selects, which are posted as hidden inputs. */
export interface TaskFormSelections {
  readonly projectId: string;
  readonly type: WorkItemType;
  readonly statusId: string;
  readonly priority: WorkItemPriority;
  /** A user id, `group:<id>` or empty; see `toAssigneeValue`. */
  readonly assignee: string;
  readonly departmentId: string;
  readonly milestoneId: string;
  readonly parentId: string;
  readonly reporterId: string;
  /** The template a new ticket starts from, or empty. */
  readonly templateId: string;
}

/** What the form starts with when it opens. */
export interface TaskFormDefaults {
  readonly initialTask: WorkItemDetail | null;
  readonly projects: readonly Project[];
  readonly defaultProjectId: string | null;
  readonly defaultParentId: string | null;
  readonly defaultType: WorkItemType;
  readonly defaultStatusId: string | null;
}

/** The selections of the form and the way to change one of them. */
export interface TaskFormSelectionState {
  readonly selections: TaskFormSelections;
  readonly select: <Key extends keyof TaskFormSelections>(
    key: Key,
    value: TaskFormSelections[Key],
  ) => void;
}

function resolveProjectId(defaults: TaskFormDefaults): string {
  const { defaultProjectId, projects } = defaults;

  if (
    defaultProjectId &&
    projects.some((project) => project.id === defaultProjectId)
  ) {
    return defaultProjectId;
  }

  return projects[0]?.id ?? "";
}

/**
 * Builds the selections for an edited work item or for a new one.
 *
 * @param defaults - The edited item, or the defaults of a new item.
 */
function buildSelections(defaults: TaskFormDefaults): TaskFormSelections {
  const { initialTask } = defaults;

  if (initialTask) {
    return {
      assignee: toAssigneeValue(initialTask),
      departmentId: initialTask.departmentId ?? "",
      milestoneId: initialTask.milestoneId ?? "",
      parentId: initialTask.parentId ?? "",
      priority: initialTask.priority,
      projectId: initialTask.projectId,
      reporterId: initialTask.createdBy,
      statusId: initialTask.statusId,
      templateId: "",
      type: initialTask.type,
    };
  }

  return {
    assignee: "",
    departmentId: "",
    milestoneId: "",
    parentId: defaults.defaultParentId ?? "",
    priority: WORK_ITEM_PRIORITY.NORMAL,
    projectId: resolveProjectId(defaults),
    reporterId: "",
    statusId: defaults.defaultStatusId ?? "",
    templateId: "",
    type: defaults.defaultType,
  };
}

/**
 * Keeps the selections of the work item form and resets them whenever the
 * dialog opens.
 *
 * @param isOpen - Whether the dialog is open.
 * @param defaults - The edited item, or the defaults of a new item.
 */
export function useTaskFormSelections(
  isOpen: boolean,
  defaults: TaskFormDefaults,
): TaskFormSelectionState {
  const [selections, setSelections] = useState(() => buildSelections(defaults));
  const {
    initialTask,
    projects,
    defaultProjectId,
    defaultParentId,
    defaultType,
    defaultStatusId,
  } = defaults;

  useEffect(() => {
    if (isOpen) {
      setSelections(
        buildSelections({
          defaultParentId,
          defaultProjectId,
          defaultStatusId,
          defaultType,
          initialTask,
          projects,
        }),
      );
    }
  }, [
    isOpen,
    initialTask,
    projects,
    defaultProjectId,
    defaultParentId,
    defaultType,
    defaultStatusId,
  ]);

  function select<Key extends keyof TaskFormSelections>(
    key: Key,
    value: TaskFormSelections[Key],
  ): void {
    setSelections((current) => ({ ...current, [key]: value }));
  }

  return { select, selections };
}
