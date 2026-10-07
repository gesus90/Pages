import { useState } from "react";

import { KanbanScrollArea } from "@/app/components/tasks/kanban-scroll-area";
import { groupWorkItems } from "@/app/lib/board-groups";

import { KanbanGroupSection } from "./kanban/kanban-group-section";
import { KanbanStatusColumns } from "./kanban/kanban-status-columns";
import { useKanbanDrag } from "./kanban/use-kanban-drag";

import type { BoardGroupLookups } from "@/app/lib/board-groups";
import type { BoardGroup } from "@/definition/BoardPreferences";
import type { Label, WorkItemDetail, WorkflowStatus } from "@/definition/Task";

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

// Cards rendered per kanban column before progressive disclosure; column
// headers always show the true totals from the full item list.
const KANBAN_COLUMN_PAGE_SIZE = 50;

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
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pr-1">
      {groupWorkItems(workItems, group, groupLookups).map((section) => (
        <KanbanGroupSection key={section.key} section={section}>
          <KanbanStatusColumns
            {...columnProps}
            groupKey={section.key}
            items={section.items}
          />
        </KanbanGroupSection>
      ))}
    </div>
  );
}
