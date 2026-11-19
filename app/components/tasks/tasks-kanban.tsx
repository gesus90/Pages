import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { groupWorkItems } from "@/app/lib/board-groups";

import { KanbanColumn } from "./kanban/kanban-column";
import { useKanbanDrag } from "./kanban/use-kanban-drag";

import type {
  BoardGroupLookups,
  BoardGroupSection,
} from "@/app/lib/board-groups";
import type { BoardGroup } from "@/definition/BoardPreferences";
import type { Label, WorkItemDetail, WorkflowStatus } from "@/definition/Task";
import type { ReactNode } from "react";
import type { KanbanDrag } from "./kanban/use-kanban-drag";

// Cards rendered per kanban column before progressive disclosure; column
// headers always show the true totals from the full item list.
const KANBAN_COLUMN_PAGE_SIZE = 50;

interface TasksKanbanProps {
  readonly statuses: readonly WorkflowStatus[];
  /** The tickets of the board in display order. */
  readonly workItems: readonly WorkItemDetail[];
  readonly group: BoardGroup;
  readonly groupLookups: BoardGroupLookups;
  readonly selectedTaskId: string | null;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly Label[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onQuickCreate: (statusId: string) => void;
  readonly onMoveTask: (
    taskId: string,
    targetStatusId: string,
    sortOrder: number,
  ) => void;
}

interface KanbanStatusColumnsProps {
  readonly statuses: readonly WorkflowStatus[];
  readonly items: readonly WorkItemDetail[];
  readonly groupKey: string;
  readonly drag: KanbanDrag;
  readonly draggedItem: WorkItemDetail | null;
  readonly visibleCount: number;
  readonly selectedTaskId: string | null;
  readonly labelsByWorkItem?: Readonly<Record<string, readonly Label[]>>;
  readonly onSelectTask: (key: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onQuickCreate: (statusId: string) => void;
  readonly onShowMore: () => void;
  readonly onChangeStatus: (taskId: string, statusId: string) => void;
}

interface KanbanGroupSectionProps {
  readonly section: BoardGroupSection;
  readonly children: ReactNode;
}

function sectionTitle(
  section: BoardGroupSection,
  translate: (key: string) => string,
): string {
  if (section.kind === "priority") {
    return translate(`tasks.priority.${section.key}`);
  }

  return section.title ?? translate(`tasks.groupEmpty.${section.kind}`);
}

function KanbanScrollArea({
  children,
}: {
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <ScrollViewport
      axis="horizontal"
      containerClassName="h-full min-h-48 w-full"
      className="overscroll-x-contain"
      id="tasks-kanban-viewport"
    >
      <div className="flex h-full w-max min-w-full items-stretch gap-4 px-1 py-2 md:gap-5">
        {children}
      </div>
    </ScrollViewport>
  );
}

function KanbanStatusColumns({
  statuses,
  items,
  groupKey,
  ...columnProps
}: KanbanStatusColumnsProps): React.ReactElement {
  return (
    <>
      {statuses.map((status) => (
        <KanbanColumn
          key={status.id}
          {...columnProps}
          columnId={`${groupKey}:${status.id}`}
          items={items.filter((item) => item.statusId === status.id)}
          status={status}
          statuses={statuses}
        />
      ))}
    </>
  );
}

function KanbanGroupSection({
  section,
  children,
}: KanbanGroupSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="min-w-0">
      <h2
        className="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-foreground"
        id={headingId}
      >
        {sectionTitle(section, t)}
        <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-[11px] font-semibold text-muted-foreground">
          {section.items.length}
        </span>
      </h2>
      {/* The lane is as tall as its fullest column up to a cap, and every column stretches to it; taller columns scroll inside. */}
      <ScrollViewport
        axis="horizontal"
        className="overflow-x-auto overflow-y-hidden pb-2"
      >
        <div className="flex max-h-[34rem] w-max min-w-full items-stretch gap-4 px-1 md:gap-5 [&>section]:h-auto">
          {children}
        </div>
      </ScrollViewport>
    </section>
  );
}

/** Renders the drag-and-drop Kanban board spanning all five standard workflow phases, optionally in sections per group. */
export function TasksKanban({
  statuses,
  workItems,
  group,
  groupLookups,
  selectedTaskId,
  labelsByWorkItem,
  onSelectTask,
  onOpenTask,
  onQuickCreate,
  onMoveTask,
}: TasksKanbanProps): React.ReactElement {
  const drag = useKanbanDrag(onMoveTask);
  const [visibleColumnCount, setVisibleColumnCount] = useState<number>(
    KANBAN_COLUMN_PAGE_SIZE,
  );
  const draggedItem =
    workItems.find((item) => item.id === drag.draggedTaskId) ?? null;

  function handleShowMore(): void {
    setVisibleColumnCount((count) => count + KANBAN_COLUMN_PAGE_SIZE);
  }

  // The select of a card moves the ticket to the end of the target column.
  function handleChangeStatus(taskId: string, statusId: string): void {
    const targetItems = workItems.filter((item) => item.statusId === statusId);

    onMoveTask(taskId, statusId, targetItems.length + 1);
  }

  const columnProps = {
    drag,
    draggedItem,
    labelsByWorkItem,
    onChangeStatus: handleChangeStatus,
    onOpenTask,
    onQuickCreate,
    onSelectTask,
    onShowMore: handleShowMore,
    selectedTaskId,
    statuses,
    visibleCount: visibleColumnCount,
  };

  if (group === "none") {
    return (
      <KanbanScrollArea>
        <KanbanStatusColumns
          {...columnProps}
          groupKey="all"
          items={workItems}
        />
      </KanbanScrollArea>
    );
  }

  return (
    <ScrollViewport
      axis="vertical"
      containerClassName="min-h-0 flex-1"
      className="flex flex-col gap-6 overflow-y-auto pr-1"
    >
      {groupWorkItems(workItems, group, groupLookups).map((section) => (
        <KanbanGroupSection key={section.key} section={section}>
          <KanbanStatusColumns
            {...columnProps}
            groupKey={section.key}
            items={section.items}
          />
        </KanbanGroupSection>
      ))}
    </ScrollViewport>
  );
}
