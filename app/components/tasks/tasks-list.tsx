import { ArrowUpDown } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { useRegionFormatter } from "@/app/components/common/region-provider";
import {
  TaskPriorityBadge,
  TaskStatusBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { TaskLabelList } from "@/app/components/tasks/task-labels";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";

import type { Label, WorkItemDetail } from "@/definition/Task";
import type {
  TaskSortDirection,
  TaskSortField,
} from "./list/tasks-list-sorting";

export type { TaskSortField } from "./list/tasks-list-sorting";

// Rows rendered before progressive disclosure; the items arrive sorted, so
// the order stays correct while expanding.
const LIST_ROW_PAGE_SIZE = 100;

interface TasksListProps {
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly Label[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly sortField: TaskSortField;
  readonly sortDirection: TaskSortDirection;
  readonly onSortChange: (
    field: TaskSortField,
    direction: TaskSortDirection,
  ) => void;
}

interface TasksListHeadProps {
  readonly onSort: (field: TaskSortField) => void;
}

interface SortableColumnHeaderProps {
  readonly field: TaskSortField;
  readonly label: string;
  readonly onSort: (field: TaskSortField) => void;
}

interface TasksListRowProps {
  readonly item: WorkItemDetail;
  readonly labels: readonly Label[];
  readonly isSelected: boolean;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

function SortableColumnHeader({
  field,
  label,
  onSort,
}: SortableColumnHeaderProps): React.ReactElement {
  return (
    <th
      className="cursor-pointer px-3 py-3 transition-colors hover:text-foreground"
      onClick={() => onSort(field)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown className="size-3" aria-hidden="true" />
      </span>
    </th>
  );
}

function TasksListHead({ onSort }: TasksListHeadProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <thead className="bg-muted/40 font-semibold text-muted-foreground select-none">
      <tr>
        <th className="py-3 pr-2 pl-4">{t("tasks.columns.type")}</th>
        <th className="px-3 py-3">{t("tasks.columns.key")}</th>
        <SortableColumnHeader
          field="project"
          label={t("tasks.columns.project")}
          onSort={onSort}
        />
        <SortableColumnHeader
          field="title"
          label={t("tasks.columns.title")}
          onSort={onSort}
        />
        <SortableColumnHeader
          field="status"
          label={t("tasks.columns.status")}
          onSort={onSort}
        />
        <SortableColumnHeader
          field="priority"
          label={t("tasks.columns.priority")}
          onSort={onSort}
        />
        <th className="px-3 py-3">{t("tasks.columns.assignee")}</th>
        <th className="px-3 py-3">{t("tasks.columns.labels")}</th>
        <SortableColumnHeader
          field="dueDate"
          label={t("tasks.columns.dueAt")}
          onSort={onSort}
        />
      </tr>
    </thead>
  );
}

function TasksListRow({
  item,
  labels,
  isSelected,
  onSelectTask,
  onOpenTask,
}: TasksListRowProps): React.ReactElement {
  const { t } = useTranslation();
  const { formatDate } = useRegionFormatter();

  return (
    <tr
      className={`cursor-pointer transition-colors hover:bg-muted/40 ${
        isSelected ? "bg-primary-subtle/70" : ""
      }`}
      onClick={() => onSelectTask(item.key)}
      onDoubleClick={() => onOpenTask(item.key)}
    >
      <td className="py-3 pr-2 pl-4">
        <TaskTypeBadge type={item.type} />
      </td>
      <td className="px-3 py-3 font-semibold text-muted-foreground whitespace-nowrap">
        {item.key}
      </td>
      <td className="px-3 py-3 font-medium text-foreground whitespace-nowrap">
        {item.projectName}
      </td>
      <td className="max-w-md px-3 py-3">
        <div className="font-medium text-foreground line-clamp-1">
          {item.title}
        </div>
        {item.parentKey ? (
          <span className="text-[11px] text-muted-foreground">
            {item.parentKey} · {item.parentTitle}
          </span>
        ) : null}
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <TaskStatusBadge
          statusKey={item.statusKey}
          statusName={item.statusName}
        />
      </td>
      <td className="px-3 py-3 whitespace-nowrap">
        <TaskPriorityBadge priority={item.priority} />
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
        {item.assigneeName ?? item.assigneeGroupName ?? t("tasks.unassigned")}
      </td>
      <td className="max-w-48 px-3 py-3">
        <TaskLabelList labels={labels} maxVisible={2} />
      </td>
      <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
        {item.dueAt ? formatDate(item.dueAt) : "—"}
      </td>
    </tr>
  );
}

/** Renders a compact table of work items, in the order given; the column heads change the sort order. */
export function TasksList({
  workItems,
  selectedTaskId,
  labelsByWorkItem,
  onSelectTask,
  onOpenTask,
  sortField,
  sortDirection,
  onSortChange,
}: TasksListProps): React.ReactElement {
  const { t } = useTranslation();
  const [visibleRowCount, setVisibleRowCount] =
    useState<number>(LIST_ROW_PAGE_SIZE);
  const visibleItems = workItems.slice(0, visibleRowCount);
  const hiddenCount = workItems.length - visibleItems.length;

  function handleHeaderClick(field: TaskSortField): void {
    if (sortField === field) {
      onSortChange(field, sortDirection === "asc" ? "desc" : "asc");
    } else {
      onSortChange(field, "asc");
    }
  }

  function handleShowMore(): void {
    setVisibleRowCount((count) => count + LIST_ROW_PAGE_SIZE);
  }

  return (
    <ScrollViewport
      axis="horizontal"
      isShell
      containerClassName="rounded-2xl bg-surface shadow-card"
      className="overflow-x-auto"
    >
      <table className="w-full text-left text-xs">
        <TasksListHead onSort={handleHeaderClick} />
        <tbody className="divide-y divide-muted/60">
          {visibleItems.map((item) => (
            <TasksListRow
              key={item.id}
              isSelected={
                item.id === selectedTaskId || item.key === selectedTaskId
              }
              item={item}
              labels={labelsByWorkItem?.[item.id] ?? []}
              onOpenTask={onOpenTask}
              onSelectTask={onSelectTask}
            />
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 ? (
        <button
          className="inline-flex min-h-10 w-full items-center justify-center px-4 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:bg-muted/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset"
          onClick={handleShowMore}
          type="button"
        >
          {t("tasks.view.showMore", { count: hiddenCount })}
        </button>
      ) : null}
    </ScrollViewport>
  );
}
