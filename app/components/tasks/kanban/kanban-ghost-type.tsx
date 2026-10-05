import { Bookmark, CheckCircle2, Circle, Layers } from "lucide-react";
import { useTranslation } from "react-i18next";

import { WORK_ITEM_TYPE } from "@/definition/Task";

import type { ReactNode } from "react";
import type { WorkItemType } from "@/definition/Task";

interface KanbanGhostTypeProps {
  readonly type: WorkItemType;
}

/** Renders the ticket type chip of the drop ghost. */
export function KanbanGhostType({
  type,
}: KanbanGhostTypeProps): React.ReactElement {
  const { t } = useTranslation();

  let typeIcon: ReactNode = (
    <Circle className="size-3 fill-current" aria-hidden="true" />
  );
  let typeLabel = t("tasks.type.task");

  if (type === WORK_ITEM_TYPE.INITIATIVE) {
    typeIcon = <Layers className="size-3.5" aria-hidden="true" />;
    typeLabel = t("tasks.type.initiative");
  } else if (type === WORK_ITEM_TYPE.EPIC) {
    typeIcon = (
      <Bookmark className="size-3.5 fill-current" aria-hidden="true" />
    );
    typeLabel = t("tasks.type.epic");
  } else if (type === WORK_ITEM_TYPE.SUBTASK) {
    typeIcon = <CheckCircle2 className="size-3.5" aria-hidden="true" />;
    typeLabel = t("tasks.type.subtask");
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
      {typeIcon}
      {typeLabel}
    </span>
  );
}
