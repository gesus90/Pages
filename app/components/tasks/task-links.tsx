import { LinkAddForm } from "@/app/components/tasks/task-links/link-add-form";
import { LinkEmptyState } from "@/app/components/tasks/task-links/link-empty-state";
import { LinkRow } from "@/app/components/tasks/task-links/link-row";
import { useTaskLinkActions } from "@/app/components/tasks/task-links/use-task-link-actions";

import type { WorkItemDetail, WorkItemLink } from "@/definition/Task";

interface TaskLinksProps {
  readonly workItemId: string;
  readonly currentWorkItemKey: string;
  readonly links: readonly WorkItemLink[];
  readonly workItems: readonly WorkItemDetail[];
  readonly isArchived?: boolean;
  readonly isSubmitting?: boolean;
  /** Shows the add form; omit to keep it permanently visible. */
  readonly isAddFormOpen?: boolean;
  readonly onAddFormOpenChange?: (isOpen: boolean) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders and edits Jira-style ticket relations (blocks/relates/duplicates). */
export function TaskLinks({
  workItemId,
  currentWorkItemKey,
  links,
  workItems,
  isArchived = false,
  isSubmitting = false,
  isAddFormOpen,
  onAddFormOpenChange,
  onSelectTask,
}: TaskLinksProps): React.ReactElement {
  const actions = useTaskLinkActions(workItemId, onAddFormOpenChange);

  const targetOptions = workItems.filter(
    (item) => item.key !== currentWorkItemKey && item.archivedAt === null,
  );
  const canAddLinks = !isArchived && targetOptions.length > 0;
  const showAddForm = canAddLinks && (isAddFormOpen ?? true);

  return (
    <div className="flex flex-col gap-3">
      {links.length === 0 ? (
        <LinkEmptyState />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {links.map((link) => (
            <LinkRow
              key={link.id}
              isArchived={isArchived}
              link={link}
              onRemove={actions.removeLink}
              onSelectTask={onSelectTask}
            />
          ))}
        </ul>
      )}

      {showAddForm ? (
        <LinkAddForm
          canCancel={onAddFormOpenChange !== undefined}
          isSubmitting={isSubmitting}
          linkType={actions.linkType}
          onAdd={actions.addLink}
          onCancel={actions.cancelAdd}
          onLinkTypeChange={actions.changeLinkType}
          onTargetKeyChange={actions.setTargetKey}
          targetKey={actions.targetKey}
          targetOptions={targetOptions}
        />
      ) : null}
    </div>
  );
}
