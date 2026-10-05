import { ChecklistAddForm } from "@/app/components/tasks/task-checklist/checklist-add-form";
import { ChecklistItemRow } from "@/app/components/tasks/task-checklist/checklist-item-row";
import { ChecklistProgress } from "@/app/components/tasks/task-checklist/checklist-progress";
import { useChecklistActions } from "@/app/components/tasks/task-checklist/use-checklist-actions";

import type { WorkItemChecklistItem } from "@/definition/Task";

interface TaskChecklistProps {
  readonly workItemId: string;
  readonly items: readonly WorkItemChecklistItem[];
  readonly isArchived?: boolean;
  readonly isSubmitting?: boolean;
}

/** Renders the ticket's acceptance-criteria checklist with inline CRUD. */
export function TaskChecklist({
  workItemId,
  items,
  isArchived = false,
  isSubmitting = false,
}: TaskChecklistProps): React.ReactElement {
  const actions = useChecklistActions(workItemId);

  const doneCount = items.filter((item) => item.isDone).length;

  return (
    <div className="flex flex-col gap-3">
      <ChecklistProgress doneCount={doneCount} totalCount={items.length} />

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <ChecklistItemRow
              key={item.id}
              isArchived={isArchived}
              item={item}
              onDelete={actions.deleteItem}
              onToggle={actions.toggleItem}
            />
          ))}
        </ul>
      ) : null}

      {!isArchived ? (
        <ChecklistAddForm
          isSubmitting={isSubmitting}
          onAdd={actions.addItem}
          onTitleChange={actions.setNewTitle}
          title={actions.newTitle}
        />
      ) : null}
    </div>
  );
}
