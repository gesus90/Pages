import { useTranslation } from "react-i18next";

import {
  DateRows,
  PeopleRows,
  PlacementRows,
  StatusRows,
} from "@/app/components/tasks/detail/detail-property-rows";
import { DetailSection } from "@/app/components/tasks/detail-section";

import type { TaskPanelActions } from "@/app/components/tasks/detail/use-task-panel-actions";
import type { Project } from "@/definition/Project";
import type { Milestone, WorkItemDetail } from "@/definition/Task";
import type { User } from "@/definition/User";

interface DetailPropertiesSectionProps {
  readonly task: WorkItemDetail;
  readonly actions: TaskPanelActions;
  readonly assignees: readonly User[];
  readonly reporters: readonly User[];
  readonly projects: readonly Project[];
  readonly milestones: readonly Milestone[];
  readonly isArchived: boolean;
  readonly isSyncing: boolean;
  readonly onChangeProject: (projectId: string) => void;
}

/** Renders people, placement, progress, synchronization and dates of a ticket. */
export function DetailPropertiesSection({
  task,
  actions,
  assignees,
  reporters,
  projects,
  milestones,
  isArchived,
  isSyncing,
  onChangeProject,
}: DetailPropertiesSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <DetailSection title={t("tasks.detail.details")}>
      <dl className="flex flex-col gap-3">
        <PeopleRows
          assignees={assignees}
          isArchived={isArchived}
          onChangeAssignee={(assignee) => actions.update({ assignee })}
          onChangeReporter={(reporterId) => actions.update({ reporterId })}
          reporters={reporters}
          task={task}
        />
        <PlacementRows
          isArchived={isArchived}
          milestones={milestones}
          onChangeMilestone={(milestoneId) => actions.update({ milestoneId })}
          onChangeProject={onChangeProject}
          projects={projects}
          task={task}
        />
        <StatusRows isSyncing={isSyncing} task={task} />
        <DateRows
          isArchived={isArchived}
          onChangeDueAt={(event) =>
            actions.update({ dueAt: event.currentTarget.value })
          }
          onChangeStartAt={(event) =>
            actions.update({ startAt: event.currentTarget.value })
          }
          task={task}
        />
      </dl>
    </DetailSection>
  );
}
