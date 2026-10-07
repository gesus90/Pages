import { GeneralDescriptionSection } from "@/app/components/projects/general-description-section";
import { GeneralDetailsSection } from "@/app/components/projects/general-details-section";
import { GeneralGoalsSection } from "@/app/components/projects/general-goals-section";
import { GeneralIconSection } from "@/app/components/projects/general-icon-section";
import { GeneralNextDatesSection } from "@/app/components/projects/general-next-dates-section";
import { GeneralNotesSection } from "@/app/components/projects/general-notes-section";
import { GeneralProgressSection } from "@/app/components/projects/general-progress-section";
import { GeneralQuickActionsSection } from "@/app/components/projects/general-quick-actions-section";
import { ProjectManagementSection } from "@/app/components/projects/project-management-section";

import type {
  Project,
  ProjectEvent,
  ProjectGoal,
  ProjectMember,
  ProjectActionPermissions,
  ProjectDepartmentChoices,
} from "@/definition/Project";
import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface ProjectGeneralTabProps {
  readonly permissions: ProjectActionPermissions;
  readonly departmentChoices: ProjectDepartmentChoices;
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly goals: readonly ProjectGoal[];
  readonly tags: readonly string[];
  readonly events: readonly ProjectEvent[];
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly canWrite: boolean;
}

/** Renders the general overview tab with description focus and a slim side column. */
export function ProjectGeneralTab({
  permissions,
  departmentChoices,
  project,
  members,
  goals,
  tags,
  events,
  milestones,
  workItems,
  canWrite,
}: ProjectGeneralTabProps): React.ReactElement {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <GeneralDescriptionSection
          canWrite={canWrite}
          description={project.description}
          tags={tags}
        />
        <GeneralGoalsSection canWrite={canWrite} goals={goals} />
        <div className="grid gap-4 md:grid-cols-2">
          <GeneralProgressSection
            milestones={milestones}
            workItems={workItems}
          />
          <GeneralNextDatesSection events={events} />
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <GeneralIconSection canWrite={canWrite} project={project} />
        <ProjectManagementSection
          project={project}
          permissions={permissions}
          departmentChoices={departmentChoices}
        />
        <GeneralDetailsSection
          canWrite={canWrite}
          members={members}
          project={project}
        />
        <GeneralQuickActionsSection />
        <GeneralNotesSection notes={project.notes} />
      </div>
    </div>
  );
}
