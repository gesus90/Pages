import { useState } from "react";

import { KanbanScrollArea } from "@/app/components/tasks/kanban-scroll-area";

import { KanbanColumn } from "./kanban/kanban-column";
import { useKanbanDrag } from "./kanban/use-kanban-drag";

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

// Cards rendered per kanban column before progressive disclosure; column
// headers always show the true totals from the full item list.
const KANBAN_COLUMN_PAGE_SIZE = 50;

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
  const drag = useKanbanDrag(workItems, onMoveTask);
  const [visibleColumnCount, setVisibleColumnCount] = useState<number>(
    KANBAN_COLUMN_PAGE_SIZE,
  );
  const draggedItem =
    workItems.find((item) => item.id === drag.draggedTaskId) ?? null;

  function handleShowMore(): void {
    setVisibleColumnCount((count) => count + KANBAN_COLUMN_PAGE_SIZE);
  }

  return (
    <KanbanScrollArea>
      {statuses.map((status) => (
        <KanbanColumn
          key={status.id}
          drag={drag}
          draggedItem={draggedItem}
          items={workItems.filter((item) => item.statusId === status.id)}
          labelsByWorkItem={labelsByWorkItem}
          onOpenTask={onOpenTask}
          onQuickCreate={onQuickCreate}
          onSelectTask={onSelectTask}
          onShowMore={handleShowMore}
          selectedTaskId={selectedTaskId}
          status={status}
          visibleCount={visibleColumnCount}
        />
      ))}
    </KanbanScrollArea>
  );
}
