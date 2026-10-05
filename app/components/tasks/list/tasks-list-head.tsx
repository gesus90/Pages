import { ArrowUpDown } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { TaskSortField } from "./tasks-list-sorting";

interface TasksListHeadProps {
  readonly onSort: (field: TaskSortField) => void;
}

interface SortableColumnHeaderProps {
  readonly field: TaskSortField;
  readonly label: string;
  readonly onSort: (field: TaskSortField) => void;
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

/** Renders the table head of the task list with its sortable columns. */
export function TasksListHead({
  onSort,
}: TasksListHeadProps): React.ReactElement {
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
