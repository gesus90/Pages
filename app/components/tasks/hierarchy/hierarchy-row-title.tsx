import { useTranslation } from "react-i18next";

import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { WorkItemDetail } from "@/definition/Task";

interface HierarchyRowTitleProps {
  readonly item: WorkItemDetail;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
}

/** Renders the key, title and type label of a row as the button that selects it. */
export function HierarchyRowTitle({
  item,
  onSelectTask,
  onOpenTask,
}: HierarchyRowTitleProps): React.ReactElement {
  const { t } = useTranslation();

  let typeLabel = t("tasks.type.task");

  if (item.type === WORK_ITEM_TYPE.INITIATIVE) {
    typeLabel = t("tasks.type.initiative");
  } else if (item.type === WORK_ITEM_TYPE.EPIC) {
    typeLabel = t("tasks.type.epic");
  } else if (item.type === WORK_ITEM_TYPE.SUBTASK) {
    typeLabel = t("tasks.type.subtask");
  }

  return (
    <button
      className="flex min-w-0 flex-1 items-center gap-2 text-left"
      onClick={() => onSelectTask(item.key)}
      onDoubleClick={() => onOpenTask(item.key)}
      type="button"
    >
      <span className="shrink-0 font-mono text-xs font-semibold text-muted-foreground">
        {item.key}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-foreground">
        {item.title}
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">
        {typeLabel}
      </span>
    </button>
  );
}
