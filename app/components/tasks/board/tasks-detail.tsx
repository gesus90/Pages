import { TaskDetailPanel } from "@/app/components/tasks/task-detail-panel";

import type { TasksDialog } from "@/app/components/tasks/board/use-tasks-dialog";
import type { loader } from "@/app/routes/tasks";
import type { WorkItemDetail } from "@/definition/Task";

interface TasksDetailProps {
  readonly loaderData: Awaited<ReturnType<typeof loader>>;
  readonly dialog: TasksDialog;
  readonly selectedItem: WorkItemDetail;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
}

/** Renders the floating panel of the ticket the address selects. */
export function TasksDetail({
  loaderData,
  dialog,
  selectedItem,
  isArchiving,
  isSyncing,
}: TasksDetailProps): React.ReactElement {
  return (
    <TaskDetailPanel
      key={selectedItem.id}
      assignees={loaderData.assignees}
      attachments={loaderData.selectedAttachments}
      descendants={loaderData.selectedDescendants}
      assigneesByProject={loaderData.assigneesByProject}
      checklist={loaderData.selectedChecklist}
      history={loaderData.selectedHistory}
      isArchiving={isArchiving}
      isSyncing={isSyncing}
      labels={loaderData.labels}
      labelUsage={loaderData.labelUsage}
      links={loaderData.selectedLinks}
      milestones={loaderData.milestones}
      onClose={dialog.closeDetail}
      onCreateSubtask={dialog.createSubtask}
      onEdit={dialog.editTask}
      onOpenTask={dialog.openTask}
      onSelectTask={dialog.openTask}
      projects={loaderData.projects}
      pullRequests={loaderData.selectedPullRequests}
      statuses={loaderData.statuses}
      subtasks={loaderData.selectedSubtasks}
      task={selectedItem}
      taskLabels={loaderData.labelsByWorkItem[selectedItem.id] ?? []}
      workItems={loaderData.workItems}
    />
  );
}
