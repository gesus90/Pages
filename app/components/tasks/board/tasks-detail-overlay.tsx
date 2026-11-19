import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useRef } from "react";
import { useTranslation } from "react-i18next";

import { TaskDetailPanel } from "@/app/components/tasks/task-detail-panel";
import { Button } from "@/app/components/ui/button";

import type { TaskSelection } from "@/app/lib/task-selection.server";
import type { loader } from "@/app/routes/tasks-server";
import type { Label, WorkItemDetail } from "@/definition/Task";
import type { useTaskSelection } from "./use-task-selection";
import type { TasksDialog } from "./use-tasks-dialog";

interface TasksDetailOverlayProps {
  readonly loaderData: Awaited<ReturnType<typeof loader>>;
  readonly dialog: TasksDialog;
  readonly details: ReturnType<typeof useTaskSelection>;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
}

interface TasksDetailProps {
  readonly loaderData: Awaited<ReturnType<typeof loader>>;
  readonly dialog: TasksDialog;
  readonly selectedItem: WorkItemDetail;
  readonly selection: TaskSelection;
  readonly labels: readonly Label[];
  readonly labelUsage: Readonly<Record<string, number>> | null;
  readonly onRefresh: () => void;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
}

// The image viewer opens above the ticket. Its dialog layer is only
// registered a moment after it appears, and an Escape in that moment would
// close the ticket as well. The dialog that holds the focus owns Escape.
function isInOtherDialog(
  target: EventTarget | null,
  ticket: Element | null,
): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  const dialog = target.closest('[role="dialog"]');

  return dialog !== null && dialog !== ticket;
}

function TasksDetail({
  loaderData,
  dialog,
  selectedItem,
  selection,
  labels,
  labelUsage,
  onRefresh,
  isArchiving,
  isSyncing,
}: TasksDetailProps): React.ReactElement {
  return (
    <TaskDetailPanel
      key={selectedItem.id}
      assignees={loaderData.assignees}
      attachments={selection.selectedAttachments}
      descendants={selection.selectedDescendants}
      assigneesByProject={loaderData.assigneesByProject}
      checklist={selection.selectedChecklist}
      history={selection.selectedHistory}
      isArchiving={isArchiving}
      isSyncing={isSyncing}
      labels={loaderData.labels}
      labelUsage={labelUsage ?? loaderData.labelUsage}
      links={selection.selectedLinks}
      milestones={loaderData.milestones}
      onClose={dialog.closeDetail}
      onCreateSubtask={dialog.createSubtask}
      onEdit={dialog.editTask}
      onOpenTask={dialog.openTask}
      onRefresh={onRefresh}
      onSelectTask={dialog.openTask}
      projects={loaderData.projects}
      pullRequests={selection.selectedPullRequests}
      statuses={loaderData.statuses}
      subtasks={selection.selectedSubtasks}
      task={selectedItem}
      taskLabels={labels}
      workItems={loaderData.workItems}
    />
  );
}

/** Keeps the board mounted beneath the accessible ticket dialog. */
export function TasksDetailOverlay({
  loaderData,
  dialog,
  details,
  isArchiving,
  isSyncing,
}: TasksDetailOverlayProps): React.ReactElement {
  const { t } = useTranslation();
  const selectedItem = details.selection?.selectedItem;
  const content = useRef<HTMLDivElement>(null);

  return (
    <DialogPrimitive.Root
      open={details.selectedKey !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) dialog.closeDetail();
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-scrim backdrop-blur-[1.5px]" />
        <DialogPrimitive.Content
          ref={content}
          aria-describedby={undefined}
          aria-modal="true"
          className="pages-floating-panel fixed inset-3 z-50 mx-auto flex max-w-6xl flex-col overflow-hidden bg-surface p-0 outline-none sm:inset-6"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            dialog.restoreFocus();
          }}
          onEscapeKeyDown={(event) => {
            if (isInOtherDialog(event.target, content.current)) {
              event.preventDefault();
            }
          }}
          onInteractOutside={(event) => event.preventDefault()}
        >
          <DialogPrimitive.Title className="sr-only">
            {selectedItem
              ? `${selectedItem.key} ${selectedItem.title}`
              : t("tasks.detail.loading")}
          </DialogPrimitive.Title>
          {selectedItem && details.selection ? (
            <TasksDetail
              dialog={dialog}
              isArchiving={isArchiving}
              isSyncing={isSyncing}
              labels={details.labels}
              labelUsage={details.labelUsage}
              onRefresh={details.reload}
              loaderData={loaderData}
              selectedItem={selectedItem}
              selection={details.selection}
            />
          ) : (
            <div className="flex flex-col items-start gap-4 p-6">
              <p className="text-sm text-muted-foreground" role="status">
                {t(
                  details.isUnavailable
                    ? "tasks.detail.unavailable"
                    : "tasks.detail.loading",
                )}
              </p>
              <Button
                onClick={dialog.closeDetail}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("tasks.actions.close")}
              </Button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
