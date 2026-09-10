import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Bookmark,
  CheckCircle2,
  CheckSquare,
  Circle,
  Layers,
  Plus,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TaskPriorityBadge,
  TaskTypeBadge,
} from "@/app/components/tasks/task-badges";
import { KanbanScrollArea } from "@/app/components/tasks/kanban-scroll-area";
import { TaskLabelList } from "@/app/components/tasks/task-labels";
import { cn } from "@/app/lib/cn";
import { WORK_ITEM_PRIORITY, WORK_ITEM_TYPE } from "@/definition/Task";

import styles from "./tasks-kanban.module.css";

import type { ReactNode } from "react";
import type {
  ProjectLabel,
  WorkItemDetail,
  WorkflowStatus,
} from "@/definition/Task";

interface TasksKanbanProps {
  readonly statuses: readonly WorkflowStatus[];
  readonly workItems: readonly WorkItemDetail[];
  readonly selectedTaskId: string | null;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly ProjectLabel[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onQuickCreate: (statusId: string) => void;
  readonly onMoveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void;
}

interface KanbanTicketViewportProps {
  readonly children: ReactNode;
  readonly statusKey: string;
}

interface KanbanTicketGhostProps {
  readonly item: WorkItemDetail;
  readonly labels: readonly ProjectLabel[];
}

interface ScrollEdges {
  readonly hasContentAbove: boolean;
  readonly hasContentBelow: boolean;
}

// Cards rendered per kanban column before progressive disclosure; column
// headers always show the true totals from the full item list.
const KANBAN_COLUMN_PAGE_SIZE = 50;

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

function KanbanTicketViewport({
  children,
  statusKey,
}: KanbanTicketViewportProps): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [scrollEdges, setScrollEdges] = useState<ScrollEdges>({
    hasContentAbove: false,
    hasContentBelow: false,
  });

  useEffect(() => {
    const viewport = viewportRef.current as HTMLDivElement;

    function updateScrollEdges(): void {
      const hasContentAbove = viewport.scrollTop > 1;
      const hasContentBelow =
        viewport.scrollTop + viewport.clientHeight < viewport.scrollHeight - 1;

      setScrollEdges((previous) => {
        if (
          previous.hasContentAbove === hasContentAbove &&
          previous.hasContentBelow === hasContentBelow
        ) {
          return previous;
        }

        return { hasContentAbove, hasContentBelow };
      });
    }

    updateScrollEdges();
    viewport.addEventListener("scroll", updateScrollEdges, { passive: true });

    if (typeof ResizeObserver === "undefined") {
      return () => {
        viewport.removeEventListener("scroll", updateScrollEdges);
      };
    }

    const observer = new ResizeObserver(updateScrollEdges);
    observer.observe(viewport);
    observer.observe(contentRef.current as HTMLDivElement);

    return () => {
      viewport.removeEventListener("scroll", updateScrollEdges);
      observer.disconnect();
    };
  }, []);

  return (
    <div className={cn(styles.ticketScrollArea, getColumnFadeClass(statusKey))}>
      <div
        ref={viewportRef}
        className={cn(styles.ticketViewport, "pages-hover-scrollbar")}
      >
        <div ref={contentRef} className={styles.ticketList}>
          {children}
        </div>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-top",
          styles.fade,
          styles.fadeTop,
          scrollEdges.hasContentAbove && styles.fadeVisible,
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          "pages-scroll-fade-bottom",
          styles.fade,
          styles.fadeBottom,
          scrollEdges.hasContentBelow && styles.fadeVisible,
        )}
      />
    </div>
  );
}

/**
 * Renders the orange insertion preview shown while dragging a ticket.
 *
 * @remarks
 * Mirrors the dimensions and layout of a real ticket so it occupies exactly
 * the space the dropped ticket will take, without shifting the column.
 */
function KanbanTicketGhost({
  item,
  labels,
}: KanbanTicketGhostProps): React.ReactElement {
  const { t } = useTranslation();

  let typeIcon: ReactNode = (
    <Circle className="size-3 fill-current" aria-hidden="true" />
  );
  let typeLabel = t("tasks.type.task");

  if (item.type === WORK_ITEM_TYPE.INITIATIVE) {
    typeIcon = <Layers className="size-3.5" aria-hidden="true" />;
    typeLabel = t("tasks.type.initiative");
  } else if (item.type === WORK_ITEM_TYPE.EPIC) {
    typeIcon = (
      <Bookmark className="size-3.5 fill-current" aria-hidden="true" />
    );
    typeLabel = t("tasks.type.epic");
  } else if (item.type === WORK_ITEM_TYPE.SUBTASK) {
    typeIcon = <CheckCircle2 className="size-3.5" aria-hidden="true" />;
    typeLabel = t("tasks.type.subtask");
  }

  let priorityIcon: ReactNode = (
    <span className="size-1.5 rounded-full bg-primary/60" aria-hidden="true" />
  );
  let priorityLabel = t("tasks.priority.normal");

  if (item.priority === WORK_ITEM_PRIORITY.URGENT) {
    priorityIcon = <AlertCircle className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.urgent");
  } else if (item.priority === WORK_ITEM_PRIORITY.HIGH) {
    priorityIcon = <ArrowUp className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.high");
  } else if (item.priority === WORK_ITEM_PRIORITY.LOW) {
    priorityIcon = <ArrowDown className="size-3.5" aria-hidden="true" />;
    priorityLabel = t("tasks.priority.low");
  }

  return (
    <article
      className="pointer-events-none relative rounded-2xl bg-primary/10 p-4 opacity-60"
      aria-hidden="true"
      data-drop-ghost
    >
      <div className="absolute inset-0 rounded-2xl border-2 border-dashed border-primary/40" />
      <div className="relative">
        <div className="flex items-start justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
            {typeIcon}
            {typeLabel}
          </span>
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
          <span className="inline-flex items-center gap-1 font-medium text-primary">
            {priorityIcon}
            {priorityLabel}
          </span>

          <div className="flex items-center gap-2">
            {item.subtaskTotal > 0 ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary/70">
                <CheckSquare className="size-3.5" aria-hidden="true" />
                {item.subtaskCompleted} / {item.subtaskTotal}
              </span>
            ) : null}

            <span className="inline-flex size-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary select-none">
              {item.assigneeName
                ? item.assigneeName.trim().charAt(0).toUpperCase()
                : "?"}
            </span>
          </div>
        </div>
      </div>
    </article>
  );
}

/**
 * Resolves the 0-based insertion index within a column's ticket list based on
 * the pointer's vertical position.
 *
 * @remarks
 * Die eingeblendete Ghost-Karte verschiebt alle nachfolgenden Karten nach
 * unten. Ohne Korrektur würde die Vorschau deshalb zwischen zwei Positionen
 * hin- und herspringen, sobald der Zeiger nahe einer Kartenmitte steht. Die
 * Verschiebung wird aus dem tatsächlichen Abstand zwischen Ghost und
 * Folgekarte gemessen und wieder herausgerechnet.
 */
function computeInsertIndex(column: HTMLElement, clientY: number): number {
  const cards = Array.from(
    column.querySelectorAll<HTMLElement>("[data-ticket-item]"),
  );
  const ghost = column.querySelector<HTMLElement>("[data-drop-ghost]");
  const ghostTop = ghost ? ghost.getBoundingClientRect().top : null;
  const cardTops = cards.map((card) => card.getBoundingClientRect().top);

  let ghostShift = 0;

  if (ghostTop !== null) {
    const nextCardTop = cardTops.find((top) => top > ghostTop);
    ghostShift = nextCardTop === undefined ? 0 : nextCardTop - ghostTop;
  }

  for (let index = 0; index < cards.length; index += 1) {
    const rect = cards[index].getBoundingClientRect();
    const top =
      ghostTop !== null && rect.top > ghostTop
        ? rect.top - ghostShift
        : rect.top;

    if (clientY < top + rect.height / 2) {
      return index;
    }
  }

  return cards.length;
}

/** Renders the drag-and-drop Kanban board spanning all five standard workflow phases. */
export function TasksKanban({
  statuses,
  workItems,
  selectedTaskId,
  labelsByWorkItem,
  onSelectTask,
  onOpenTask,
  onQuickCreate,
  onMoveTask,
}: TasksKanbanProps): React.ReactElement {
  const { t } = useTranslation();
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatusId, setDragOverStatusId] = useState<string | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number>(-1);
  const [visibleColumnCount, setVisibleColumnCount] = useState<number>(
    KANBAN_COLUMN_PAGE_SIZE,
  );

  function handleShowMore(): void {
    setVisibleColumnCount((count) => count + KANBAN_COLUMN_PAGE_SIZE);
  }

  function handleDragStart(
    event: React.DragEvent<HTMLElement>,
    taskId: string,
  ): void {
    setDraggedTaskId(taskId);
    event.dataTransfer.setData("text/plain", taskId);
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDragEnd(): void {
    setDraggedTaskId(null);
    setDragOverStatusId(null);
    setDragOverIndex(-1);
  }

  function handleDragOver(
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ): void {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    if (dragOverStatusId !== statusId) {
      setDragOverStatusId(statusId);
    }

    if (draggedTaskId) {
      const target = event.currentTarget as HTMLElement;
      const insertIndex = computeInsertIndex(target, event.clientY);

      if (insertIndex !== dragOverIndex) {
        setDragOverIndex(insertIndex);
      }
    }
  }

  function handleDragLeave(
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ): void {
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }

    if (dragOverStatusId === statusId) {
      setDragOverStatusId(null);
      setDragOverIndex(-1);
    }
  }

  function handleDrop(
    event: React.DragEvent<HTMLElement>,
    statusId: string,
  ): void {
    event.preventDefault();
    setDragOverStatusId(null);
    setDragOverIndex(-1);

    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;

    if (!taskId) {
      return;
    }

    const target = event.currentTarget as HTMLElement;
    const insertIndex = computeInsertIndex(target, event.clientY);

    const columnItems = workItems.filter((item) => item.statusId === statusId);
    const draggedIndexInColumn = columnItems.findIndex(
      (item) => item.id === taskId,
    );

    const sortOrder =
      draggedIndexInColumn === -1
        ? insertIndex + 1
        : (insertIndex <= draggedIndexInColumn
            ? insertIndex
            : insertIndex - 1) + 1;

    onMoveTask(taskId, statusId, sortOrder);
    setDraggedTaskId(null);
  }

  return (
    <KanbanScrollArea>
      {statuses.map((status) => {
        const columnItems = workItems.filter(
          (item) => item.statusId === status.id,
        );
        const visibleItems = columnItems.slice(0, visibleColumnCount);
        const hiddenCount = columnItems.length - visibleItems.length;
        const isTarget = dragOverStatusId === status.id;
        const draggedItem = draggedTaskId
          ? (workItems.find((item) => item.id === draggedTaskId) ?? null)
          : null;
        const ghostLabels = draggedItem
          ? (labelsByWorkItem?.[draggedItem.id] ?? [])
          : [];

        return (
          <section
            key={status.id}
            className={cn(
              "flex h-full w-80 shrink-0 flex-col rounded-3xl p-4 shadow-column transition-shadow",
              getColumnBgClass(status.key),
              isTarget && "ring-2 ring-primary/30",
            )}
            onDragLeave={(event) => handleDragLeave(event, status.id)}
            onDragOver={(event) => handleDragOver(event, status.id)}
            onDrop={(event) => handleDrop(event, status.id)}
          >
            <header className="flex items-center justify-between gap-2 px-1 pb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-foreground">
                  {status.name}
                </h3>
                <span className="inline-flex size-5 items-center justify-center rounded-full bg-surface/70 text-[11px] font-semibold text-muted-foreground select-none">
                  {columnItems.length}
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

            <KanbanTicketViewport statusKey={status.key}>
              {visibleItems.map((item, index) => {
                const isSelected =
                  item.id === selectedTaskId || item.key === selectedTaskId;
                const isBeingDragged = item.id === draggedTaskId;
                const itemLabels = labelsByWorkItem?.[item.id] ?? [];

                return (
                  <Fragment key={item.id}>
                    {isTarget && draggedItem && dragOverIndex === index ? (
                      <KanbanTicketGhost
                        item={draggedItem}
                        labels={ghostLabels}
                      />
                    ) : null}
                    <article
                      className={cn(
                        "group relative cursor-grab rounded-2xl bg-surface p-4 shadow-card transition-shadow select-none hover:shadow-floating active:cursor-grabbing",
                        isSelected && "ring-2 ring-primary",
                        isBeingDragged ? "opacity-40" : "opacity-100",
                      )}
                      data-ticket-item
                      draggable
                      onClick={() => onSelectTask(item.key)}
                      onDoubleClick={() => onOpenTask(item.key)}
                      onDragEnd={handleDragEnd}
                      onDragStart={(event) => handleDragStart(event, item.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <TaskTypeBadge type={item.type} />
                        <span className="flex items-center gap-1.5">
                          {item.githubIssueNumber !== null ? (
                            <span
                              className="size-2 rounded-full bg-emerald-500"
                              title={t("tasks.github.synchronized")}
                              aria-hidden="true"
                            />
                          ) : null}
                          <span className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                            {item.key}
                          </span>
                        </span>
                      </div>

                      <h4 className="mt-2.5 line-clamp-2 text-sm font-semibold text-foreground">
                        {item.title}
                      </h4>

                      <p className="mt-1 text-[11px] font-medium text-muted-foreground">
                        {item.projectName}
                      </p>

                      {itemLabels.length > 0 ? (
                        <div className="mt-2.5">
                          <TaskLabelList labels={itemLabels} maxVisible={3} />
                        </div>
                      ) : null}

                      <div className="mt-3.5 flex items-center justify-between gap-2 text-xs">
                        <TaskPriorityBadge priority={item.priority} />

                        <div className="flex items-center gap-2">
                          {item.subtaskTotal > 0 ? (
                            <span className="inline-flex items-center gap-1 font-medium text-muted-foreground">
                              <CheckSquare
                                className="size-3.5"
                                aria-hidden="true"
                              />
                              {item.subtaskCompleted} / {item.subtaskTotal}
                            </span>
                          ) : null}

                          <span
                            className="inline-flex size-6 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground select-none"
                            title={item.assigneeName ?? t("tasks.unassigned")}
                          >
                            {item.assigneeName
                              ? item.assigneeName.trim().charAt(0).toUpperCase()
                              : "?"}
                          </span>
                        </div>
                      </div>
                    </article>
                  </Fragment>
                );
              })}
              {isTarget &&
              draggedItem &&
              dragOverIndex >= visibleItems.length ? (
                <KanbanTicketGhost item={draggedItem} labels={ghostLabels} />
              ) : null}
              {hiddenCount > 0 ? (
                <button
                  className="mt-3 inline-flex min-h-9 w-full items-center justify-center rounded-xl bg-surface/70 px-3 text-sm font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
                  onClick={handleShowMore}
                  type="button"
                >
                  {t("tasks.view.showMore", { count: hiddenCount })}
                </button>
              ) : null}
            </KanbanTicketViewport>
          </section>
        );
      })}
    </KanbanScrollArea>
  );
}
