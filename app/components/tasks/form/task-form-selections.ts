import { useEffect, useState } from "react";

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
  readonly assigneeId: string;
  readonly milestoneId: string;
  readonly parentId: string;
  readonly reporterId: string;
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
      assigneeId: initialTask.assigneeId ?? "",
      milestoneId: initialTask.milestoneId ?? "",
      parentId: initialTask.parentId ?? "",
      priority: initialTask.priority,
      projectId: initialTask.projectId,
      reporterId: initialTask.createdBy,
      statusId: initialTask.statusId,
      type: initialTask.type,
    };
  }

  return {
    assigneeId: "",
    milestoneId: "",
    parentId: defaults.defaultParentId ?? "",
    priority: WORK_ITEM_PRIORITY.NORMAL,
    projectId: resolveProjectId(defaults),
    reporterId: "",
    statusId: defaults.defaultStatusId ?? "",
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
