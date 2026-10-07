import { CheckSquare, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  TasksGitHub,
  type TasksGitHubProjectState,
} from "@/app/components/tasks/tasks-github";
import { TasksHierarchy } from "@/app/components/tasks/tasks-hierarchy";
import { TasksKanban } from "@/app/components/tasks/tasks-kanban";
import { TasksList } from "@/app/components/tasks/tasks-list";
import { TasksMilestones } from "@/app/components/tasks/tasks-milestones";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Button } from "@/app/components/ui/button";
import { sortWorkItems } from "@/app/components/tasks/list/tasks-list-sorting";
import { FILTER_ALL } from "@/app/lib/task-filters";

import type { TasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import type { BoardPreferences } from "@/definition/BoardPreferences";
import type {
  Milestone,
  Label,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";

interface TasksContentProps {
  readonly preferences: BoardPreferences;
  readonly onPreferencesChange: (patch: Partial<BoardPreferences>) => void;
  readonly allItems: readonly WorkItemDetail[];
  readonly visibleItems: readonly WorkItemDetail[];
  readonly statuses: readonly WorkflowStatus[];
  readonly milestones: readonly Milestone[];
  readonly githubStates: readonly TasksGitHubProjectState[];
  readonly labelsByWorkItem: Readonly<Record<string, readonly Label[]>>;
  readonly dialog: TasksDialog;
  readonly isSyncing: boolean;
  readonly onMoveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void;
}

interface TasksEmptyStateProps {
  /** Whether tickets exist that the filters hide. */
  readonly hasItems: boolean;
  readonly onCreate: () => void;
}

/** Renders the hint that no ticket matches the filters, or the invitation to create the first one. */
function TasksEmptyState({
  hasItems,
  onCreate,
}: TasksEmptyStateProps): React.ReactElement {
  const { t } = useTranslation();

  return hasItems ? (
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
        <Button className="gap-2" onClick={onCreate} type="button">
          <Plus className="size-4" aria-hidden="true" />
          {t("tasks.create.trigger")}
        </Button>
      </div>
    </div>
  );
}

/** Renders the chosen task view, or a hint when there is nothing to show. */
export function TasksContent({
  preferences,
  onPreferencesChange,
  allItems,
  visibleItems,
  statuses,
  milestones,
  githubStates,
  labelsByWorkItem,
  dialog,
  isSyncing,
  onMoveTask,
}: TasksContentProps): React.ReactElement {
  const { departments } = useTicketAccess();
  const projectFilter = preferences.project;
  const inProject = <Item extends { readonly projectId: string }>(
    items: readonly Item[],
  ): readonly Item[] =>
    projectFilter === FILTER_ALL
      ? items
      : items.filter((item) => item.projectId === projectFilter);

  if (visibleItems.length === 0) {
    return (
      <TasksEmptyState
        hasItems={allItems.length > 0}
        onCreate={dialog.openCreate}
      />
    );
  }

  const common = {
    onOpenTask: dialog.openTask,
    onSelectTask: dialog.select,
    workItems: visibleItems,
  };

  const sortedItems = sortWorkItems(
    visibleItems,
    preferences.sort,
    preferences.direction,
  );
  const viewMode = preferences.view;

  if (viewMode === "kanban") {
    return (
      <TasksKanban
        {...common}
        group={preferences.group}
        groupLookups={{
          departmentNames: Object.fromEntries(
            departments.map((department) => [department.id, department.name]),
          ),
          labelsByWorkItem,
        }}
        labelsByWorkItem={labelsByWorkItem}
        onMoveTask={onMoveTask}
        onQuickCreate={dialog.quickCreate}
        selectedTaskId={dialog.selectedTaskId}
        statuses={statuses}
        workItems={sortedItems}
      />
    );
  }

  if (viewMode === "list") {
    return (
      <TasksList
        {...common}
        labelsByWorkItem={labelsByWorkItem}
        onSortChange={(sort, direction) =>
          onPreferencesChange({ direction, sort })
        }
        selectedTaskId={dialog.selectedTaskId}
        sortDirection={preferences.direction}
        sortField={preferences.sort}
        workItems={sortedItems}
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
