import { useTranslation } from "react-i18next";

import { ProjectDepartmentChips } from "./project-department-chips";
import { ProjectDepartmentDialog } from "./project-department-dialog";
import { ProjectLifecycleDialog } from "./project-lifecycle-dialog";
import { ProjectTemplateSaveButton } from "./project-template-save-button";

import type {
  Project,
  ProjectActionPermissions,
  ProjectDepartmentChoices,
} from "@/definition/Project";

interface ProjectManagementSectionProps {
  readonly project: Project;
  readonly permissions: ProjectActionPermissions;
  readonly departmentChoices: ProjectDepartmentChoices;
}

/** Presents live assignment and retention actions with their scope requirements. */
export function ProjectManagementSection({
  project,
  permissions,
  departmentChoices,
}: ProjectManagementSectionProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="rounded-2xl bg-surface p-6 shadow-xs">
      <h2 className="text-base font-semibold">
        {t("projects.departments.label")}
      </h2>
      <div className="mt-3">
        <ProjectDepartmentChips departments={project.departments} />
      </div>
      {permissions.canChangeDepartments ? (
        <div className="mt-4">
          <ProjectDepartmentDialog
            project={project}
            choices={departmentChoices}
          />
        </div>
      ) : null}
      {permissions.canEditGeneral && !permissions.canChangeDepartments ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {t("projects.departments.completeScopeHint")}
        </p>
      ) : null}
      {departmentChoices.selectionRequired &&
      project.departments.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t("projects.departments.reassignmentRequired")}
        </p>
      ) : null}
      {permissions.canEditGeneral ? <ProjectTemplateSaveButton /> : null}
      {permissions.canArchive || permissions.canDelete ? (
        <div className="mt-5 flex flex-wrap gap-2">
          {permissions.canArchive ? (
            <ProjectLifecycleDialog
              projectId={project.id}
              name={project.name}
              kind="archive"
            />
          ) : null}
          {permissions.canDelete ? (
            <ProjectLifecycleDialog
              projectId={project.id}
              name={project.name}
              kind="delete"
            />
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
