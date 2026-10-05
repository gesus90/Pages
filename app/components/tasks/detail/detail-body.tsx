import {
  DetailMainColumn,
  DetailSideColumn,
} from "@/app/components/tasks/detail/detail-columns";
import { cn } from "@/app/lib/cn";

import styles from "../task-detail-panel.module.css";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { Project } from "@/definition/Project";
import type {
  Milestone,
  ProjectLabel,
  WorkItemChecklistItem,
  WorkItemDetail,
  WorkItemLink,
} from "@/definition/Task";
import type { User } from "@/definition/User";

/**
 * Lists who can be picked as reporter: the project's people plus the current
 * reporter, who may no longer belong to the project.
 */
function buildReporterOptions(
  task: WorkItemDetail,
  people: readonly User[],
): readonly User[] {
  if (people.some((user) => user.id === task.createdBy)) {
    return people;
  }

  return [
    ...people,
    {
      displayName: task.reporterName ?? task.createdBy,
      id: task.createdBy,
      isActive: true,
      role: "employee",
      username: task.createdBy,
    },
  ];
}

interface DetailBodyProps {
  readonly task: WorkItemDetail;
  readonly subtasks: readonly WorkItemDetail[];
  readonly checklist: readonly WorkItemChecklistItem[];
  readonly links: readonly WorkItemLink[];
  readonly taskLabels: readonly ProjectLabel[];
  readonly assignees: readonly User[];
  readonly assigneesByProject: Readonly<Record<string, readonly User[]>>;
  readonly projects: readonly Project[];
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly actions: TaskPanelActions;
  readonly isArchiving: boolean;
  readonly isSyncing: boolean;
  readonly onCreateSubtask: (parentTask: WorkItemDetail) => void;
  readonly onEditLabels: () => void;
  readonly onChangeProject: (projectId: string) => void;
  readonly onOpenTask: (key: string) => void;
  readonly onSelectTask: (key: string) => void;
}

/** Renders the two content panes of the ticket panel. */
export function DetailBody({
  task,
  subtasks,
  checklist,
  links,
  taskLabels,
  assignees,
  assigneesByProject,
  projects,
  milestones,
  workItems,
  actions,
  isArchiving,
  isSyncing,
  onCreateSubtask,
  onEditLabels,
  onChangeProject,
  onOpenTask,
  onSelectTask,
}: DetailBodyProps): React.ReactElement {
  const isArchived = task.archivedAt !== null;
  const projectAssignees = assigneesByProject[task.projectId] ?? assignees;

  return (
    <div
      className={cn(
        styles.body,
        "mt-5 grid min-h-0 flex-1 grid-rows-2 gap-3 p-3 sm:p-4 lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-1",
      )}
    >
      <DetailMainColumn
        actions={actions}
        checklist={checklist}
        isArchived={isArchived}
        isSyncing={isSyncing}
        onCreateSubtask={onCreateSubtask}
        onOpenTask={onOpenTask}
        onSelectTask={onSelectTask}
        subtasks={subtasks}
        task={task}
      />
      <DetailSideColumn
        actions={actions}
        assignees={projectAssignees}
        isArchived={isArchived}
        isArchiving={isArchiving}
        isSyncing={isSyncing}
        links={links}
        milestones={milestones.filter(
          (milestone) => milestone.projectId === task.projectId,
        )}
        onChangeProject={onChangeProject}
        onEditLabels={onEditLabels}
        onSelectTask={onSelectTask}
        projects={projects}
        reporters={buildReporterOptions(task, projectAssignees)}
        task={task}
        taskLabels={taskLabels}
        workItems={workItems}
      />
    </div>
  );
}
