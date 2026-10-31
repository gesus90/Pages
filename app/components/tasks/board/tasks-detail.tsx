import { TaskDetailPanel } from "@/app/components/tasks/task-detail-panel";

import type { TasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import type { loader } from "@/app/routes/tasks";
import type { TaskSelection } from "@/app/lib/task-selection.server";
import type { Label, WorkItemDetail } from "@/definition/Task";

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

/** Renders the floating panel of the ticket the address selects. */
export function TasksDetail({
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
