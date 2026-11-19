import { Plus } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import styles from "../tasks-kanban.module.css";
import { KanbanTicketCard } from "./kanban-ticket-card";
import { KanbanTicketGhost } from "./kanban-ticket-ghost";

import type { Label, WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { ReactNode } from "react";
import type { KanbanDrag } from "./use-kanban-drag";

interface KanbanColumnProps {
  /** Unique on the board; one status has one column per group. */
  readonly columnId: string;
  readonly status: WorkflowStatus;
  readonly statuses: readonly WorkflowStatus[];
  readonly items: readonly WorkItemDetail[];
  readonly visibleCount: number;
  readonly selectedTaskId: string | null;
  readonly draggedItem: WorkItemDetail | null;
  readonly drag: KanbanDrag;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly Label[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onQuickCreate: (statusId: string) => void;
  readonly onShowMore: () => void;
  readonly onChangeStatus: (taskId: string, statusId: string) => void;
}

interface KanbanColumnHeaderProps {
  readonly status: WorkflowStatus;
  readonly itemCount: number;
  readonly onQuickCreate: (statusId: string) => void;
}

function getColumnBgClass(key: string): string {
  if (key === "todo") {
    return "bg-column-todo";
  }

  if (key === "in_progress") {
    return "bg-column-progress";
  }

  if (key === "review") {
    return "bg-column-review";
  }

  if (key === "done") {
    return "bg-column-done";
  }

  return "bg-column-backlog";
}

function getColumnFadeClass(key: string): string {
  if (key === "todo") {
    return styles.todo;
  }

  if (key === "in_progress") {
    return styles.progress;
  }

  if (key === "review") {
    return styles.review;
  }

  if (key === "done") {
    return styles.done;
  }

  return styles.backlog;
}

function KanbanColumnHeader({
  status,
  itemCount,
  onQuickCreate,
}: KanbanColumnHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <header className="flex items-center justify-between gap-2 px-1 pb-4">
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-foreground">
          {status.name}
        </h3>
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface/70 text-[11px] font-semibold text-muted-foreground select-none">
          {itemCount}
        </span>
      </div>
      <button
        aria-label={`${t("tasks.create.trigger")} (${status.name})`}
        className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors select-none hover:bg-surface/70 hover:text-foreground"
        onClick={() => onQuickCreate(status.id)}
        type="button"
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </header>
  );
}

function KanbanTicketViewport({
  children,
  statusKey,
}: {
  readonly children: ReactNode;
  readonly statusKey: string;
}): React.ReactElement {
  return (
    <ScrollViewport
      containerClassName={cn(
        "-mx-1 min-h-0 flex-1",
        getColumnFadeClass(statusKey),
      )}
      className="overscroll-y-contain"
    >
      <div className="flex min-h-min flex-col gap-3 pt-1 pr-3.5 pb-2 pl-1">
        {children}
      </div>
    </ScrollViewport>
  );
}

/** Renders one workflow column with its tickets and the drop ghost. */
export function KanbanColumn({
  columnId,
  status,
  statuses,
  items,
  visibleCount,
  selectedTaskId,
  draggedItem,
  drag,
  labelsByWorkItem,
  onSelectTask,
  onOpenTask,
  onQuickCreate,
  onShowMore,
  onChangeStatus,
}: KanbanColumnProps): React.ReactElement {
  const { t } = useTranslation();
  const visibleItems = items.slice(0, visibleCount);
  const hiddenCount = items.length - visibleItems.length;
  const isTarget = drag.dragOverColumnId === columnId;
  const dropTarget = { id: columnId, items, statusId: status.id };
  const ghostItem = isTarget ? draggedItem : null;
  const ghostLabels = ghostItem ? (labelsByWorkItem?.[ghostItem.id] ?? []) : [];

  return (
    <section
      className={cn(
        "flex h-full w-80 shrink-0 flex-col rounded-3xl p-4 shadow-column transition-shadow",
        getColumnBgClass(status.key),
        isTarget && "ring-2 ring-primary/30",
      )}
      onDragLeave={(event) => drag.handleDragLeave(event, dropTarget)}
      onDragOver={(event) => drag.handleDragOver(event, dropTarget)}
      onDrop={(event) => drag.handleDrop(event, dropTarget)}
    >
      <KanbanColumnHeader
        itemCount={items.length}
        onQuickCreate={onQuickCreate}
        status={status}
      />

      <KanbanTicketViewport statusKey={status.key}>
        {visibleItems.map((item, index) => (
          <Fragment key={item.id}>
            {ghostItem && drag.dragOverIndex === index ? (
              <KanbanTicketGhost item={ghostItem} labels={ghostLabels} />
            ) : null}
            <KanbanTicketCard
              isBeingDragged={item.id === drag.draggedTaskId}
              isSelected={
                item.id === selectedTaskId || item.key === selectedTaskId
              }
              item={item}
              labels={labelsByWorkItem?.[item.id] ?? []}
              onDragEnd={drag.handleDragEnd}
              onDragStart={drag.handleDragStart}
              onChangeStatus={onChangeStatus}
              onOpenTask={onOpenTask}
              onSelectTask={onSelectTask}
              statuses={statuses}
            />
          </Fragment>
        ))}
        {ghostItem && drag.dragOverIndex >= visibleItems.length ? (
          <KanbanTicketGhost item={ghostItem} labels={ghostLabels} />
        ) : null}
        {hiddenCount > 0 ? (
          <button
            className="mt-3 inline-flex min-h-9 w-full items-center justify-center rounded-xl bg-surface/70 px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
            onClick={onShowMore}
            type="button"
          >
            {t("tasks.view.showMore", { count: hiddenCount })}
          </button>
        ) : null}
      </KanbanTicketViewport>
    </section>
  );
}
