import { CheckSquare, Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TasksGitHub,
  type TasksGitHubProjectState,
} from "@/app/components/tasks/tasks-github";
import { TasksHierarchy } from "@/app/components/tasks/tasks-hierarchy";
import { TasksKanban } from "@/app/components/tasks/tasks-kanban";
import { TasksList } from "@/app/components/tasks/tasks-list";
import { TasksMilestones } from "@/app/components/tasks/tasks-milestones";
import { Button } from "@/app/components/ui/button";
import { FILTER_ALL } from "@/app/lib/task-filters";

import type { TasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import type { TaskSortField } from "@/app/components/tasks/tasks-list";
import type { TasksViewMode } from "@/app/lib/tasks-view";
import type {
  Milestone,
  ProjectLabel,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";

interface TasksContentProps {
  readonly viewMode: TasksViewMode;
  readonly allItems: readonly WorkItemDetail[];
  readonly visibleItems: readonly WorkItemDetail[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly githubStates: readonly TasksGitHubProjectState[];
  readonly labelsByWorkItem: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly projectFilter: string;
  readonly dialog: TasksDialog;
  readonly isSyncing: boolean;
  readonly onMoveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void;
}

/** Renders the chosen task view, or a hint when there is nothing to show. */
export function TasksContent({
  viewMode,
  allItems,
  visibleItems,
  statuses,
  milestones,
  githubStates,
  labelsByWorkItem,
  projectFilter,
  dialog,
  isSyncing,
  onMoveTask,
}: TasksContentProps): React.ReactElement {
  const { t } = useTranslation();
  const [sortField, setSortField] = useState<TaskSortField>("updated");
  const inProject = <Item extends { readonly projectId: string }>(
    items: readonly Item[],
  ): readonly Item[] =>
    projectFilter === FILTER_ALL
      ? items
      : items.filter((item) => item.projectId === projectFilter);

  if (visibleItems.length === 0) {
    return allItems.length > 0 ? (
      <div className="flex flex-1 items-center justify-center rounded-3xl bg-surface/70 p-12 text-center text-sm text-muted-foreground shadow-column">
        {t("tasks.noMatches")}
      </div>
    ) : (
      <div className="flex flex-1 flex-col items-center justify-center rounded-3xl bg-surface/70 px-6 py-16 text-center shadow-column">
        <CheckSquare className="size-12 text-primary" aria-hidden="true" />
        <h2 className="mt-4 select-none text-lg font-semibold text-foreground">
          {t("tasks.empty.title")}
        </h2>
        <p className="mt-2 max-w-sm select-none text-sm leading-relaxed text-muted-foreground">
          {t("tasks.empty.description")}
        </p>
        <div className="mt-6">
          <Button className="gap-2" onClick={dialog.openCreate} type="button">
            <Plus className="size-4" aria-hidden="true" />
            {t("tasks.create.trigger")}
          </Button>
        </div>
      </div>
    );
  }

  const common = {
    onOpenTask: dialog.openTask,
    onSelectTask: dialog.select,
    workItems: visibleItems,
  };

  if (viewMode === "kanban") {
    return (
      <TasksKanban
        {...common}
        labelsByWorkItem={labelsByWorkItem}
        onMoveTask={onMoveTask}
        onQuickCreate={dialog.quickCreate}
        selectedTaskId={dialog.selectedTaskId}
        statuses={statuses}
      />
    );
  }

  if (viewMode === "list") {
    return (
      <TasksList
        {...common}
        labelsByWorkItem={labelsByWorkItem}
        onSortChange={setSortField}
        selectedTaskId={dialog.selectedTaskId}
        sortField={sortField}
      />
    );
  }

  if (viewMode === "hierarchy") {
    return (
      <TasksHierarchy {...common} selectedTaskId={dialog.selectedTaskId} />
    );
  }

  if (viewMode === "milestones") {
    return <TasksMilestones {...common} milestones={inProject(milestones)} />;
  }

  return (
    <TasksGitHub
      {...common}
      isSyncing={isSyncing}
      states={githubStates.filter(
        (state) =>
          projectFilter === FILTER_ALL || state.project.id === projectFilter,
      )}
    />
  );
}
