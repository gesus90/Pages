import { KanbanColumn } from "./kanban-column";

import type { KanbanDrag } from "./use-kanban-drag";
import type { Label, WorkItemDetail, WorkflowStatus } from "@/definition/Task";

interface KanbanStatusColumnsProps {
  readonly statuses: readonly WorkflowStatus[];
  /** The tickets of one group, or of the whole board when it is not grouped. */
  readonly items: readonly WorkItemDetail[];
  /** Tells the columns of different groups apart for the drag state. */
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

/** Renders one column per workflow status for the tickets of one group. */
export function KanbanStatusColumns({
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
