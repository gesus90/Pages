import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  CheckSquare,
  Circle,
  Layers,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { AssigneeAvatar } from "@/app/components/tasks/assignee-avatar";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import type {
  Label,
  WorkItemDetail,
  WorkItemPriority,
  WorkItemType,
} from "@/definition/Task";
import type { ReactNode } from "react";

interface KanbanTicketGhostProps {
  readonly item: WorkItemDetail;
  readonly labels: readonly Label[];
}

interface KanbanGhostTypeProps {
  readonly type: WorkItemType;
}

interface KanbanGhostPriorityProps {
  readonly priority: WorkItemPriority;
}

function KanbanGhostType({ type }: KanbanGhostTypeProps): React.ReactElement {
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

function KanbanGhostPriority({
  priority,
}: KanbanGhostPriorityProps): React.ReactElement {
  const { t } = useTranslation();

  let priorityIcon: ReactNode = (
    <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
  );
  let priorityLabel = t("tasks.priority.normal");

  if (priority === WORK_ITEM_PRIORITY.URGENT) {
    priorityIcon = <AlertCircle className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.urgent");
  } else if (priority === WORK_ITEM_PRIORITY.HIGH) {
    priorityIcon = <ArrowUp className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.high");
  } else if (priority === WORK_ITEM_PRIORITY.LOW) {
    priorityIcon = <ArrowDown className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.low");
  }

  return (
    <span className="inline-flex items-center gap-1 font-medium text-primary">
      {priorityIcon}
      {priorityLabel}
    </span>
  );
}

/**
 * Renders the orange insertion preview shown while dragging a ticket.
 * @remarks
 * Mirrors the dimensions and layout of a real ticket so it occupies exactly
 * the space the dropped ticket will take, without shifting the column.
 */
export function KanbanTicketGhost({
  item,
  labels,
}: KanbanTicketGhostProps): React.ReactElement {
  return (
    <article
      className="pointer-events-none relative rounded-2xl bg-primary/10 p-4 opacity-60"
      aria-hidden="true"
      data-drop-ghost
    >
      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-primary/40" />
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <KanbanGhostType type={item.type} />
          <span className="flex items-center gap-1.5">
            {item.githubIssueNumber !== null ? (
              <span
                className="size-2 rounded-full bg-primary/60"
                aria-hidden="true"
              />
            ) : null}
            <span className="text-[11px] font-semibold tracking-wide text-primary/70">
              {item.key}
            </span>
          </span>
        </div>

        <h4 className="mt-2.5 line-clamp-2 text-sm font-semibold text-primary">
          {item.title}
        </h4>

        <p className="mt-1 text-[11px] font-medium text-primary/60">
          {item.projectName}
        </p>

        {labels.length > 0 ? (
          <div className="mt-2.5">
            <span className="inline-flex flex-wrap items-center gap-1">
              {labels.slice(0, 3).map((label) => (
                <span
                  key={label.id}
                  className="rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary/80"
                >
                  {label.name}
                </span>
              ))}
              {labels.length > 3 ? (
                <span className="rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-medium text-primary/80">
                  +{labels.length - 3}
                </span>
              ) : null}
            </span>
          </div>
        ) : null}

        <div className="mt-3.5 flex items-center justify-between gap-2 text-xs">
          <KanbanGhostPriority priority={item.priority} />

          <div className="flex items-center gap-2">
            {item.subtaskTotal > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary/70">
                <CheckSquare className="size-3.5" aria-hidden="true" />
                {item.subtaskCompleted} / {item.subtaskTotal}
              </span>
            ) : null}

            <AssigneeAvatar
              item={item}
              className="bg-primary/15 text-primary"
            />
          </div>
        </div>
      </div>
    </article>
  );
}
