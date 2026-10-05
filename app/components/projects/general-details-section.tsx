import {
  Calendar,
  Clock,
  Fingerprint,
  Flag,
  History,
  Pencil,
  Users,
} from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { EditDetailsDialog } from "@/app/components/projects/general-edit-details-dialog";
import { InlineDateField } from "@/app/components/projects/general-inline-date-field";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { formatDate } from "@/app/lib/project-format";
import { PROJECT_STATUS } from "@/definition/Project";

import type {
  Project,
  ProjectMember,
  ProjectStatus,
} from "@/definition/Project";

interface DetailRowProps {
  readonly icon: React.ReactElement;
  readonly label: string;
  readonly children: React.ReactNode;
}

function DetailRow({
  icon,
  label,
  children,
}: DetailRowProps): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

interface StatusDetailProps {
  readonly status: ProjectStatus;
  readonly canWrite: boolean;
}

/** Renders the project status, changeable inline for writers. */
function StatusDetail({
  status,
  canWrite,
}: StatusDetailProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();

  function handleChange(nextStatus: ProjectStatus): void {
    void submit(
      { intent: "update-status", status: nextStatus },
      { method: "post" },
    );
  }

  return (
    <DetailRow
      icon={<Flag className="size-4 shrink-0" aria-hidden="true" />}
      label={t("projectDetail.general.status")}
    >
      {canWrite ? (
        <Select
          id="detail-inline-status"
          ariaLabel={t("projectDetail.general.status")}
          value={status}
          onValueChange={handleChange}
          className="min-w-36"
          options={Object.values(PROJECT_STATUS).map((option) => ({
            value: option,
            label: t(`projects.status.${option}`),
          }))}
        />
      ) : (
        <span className="inline-flex items-center gap-2 font-medium text-foreground">
          <span className="size-2 rounded-full bg-primary" aria-hidden="true" />
          {t(`projects.status.${status}`)}
        </span>
      )}
    </DetailRow>
  );
}

interface ManagerDetailProps {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly canWrite: boolean;
}

/** Renders the project manager, changeable inline for writers. */
function ManagerDetail({
  project,
  members,
  canWrite,
}: ManagerDetailProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();

  function handleChange(managerId: string): void {
    void submit({ intent: "update-manager", managerId }, { method: "post" });
  }

  return (
    <DetailRow
      icon={<Users className="size-4 shrink-0" aria-hidden="true" />}
      label={t("projectDetail.general.manager")}
    >
      {canWrite ? (
        <Select
          id="detail-inline-manager"
          ariaLabel={t("projectDetail.general.manager")}
          value={project.managerId ?? ""}
          onValueChange={handleChange}
          className="min-w-36"
          options={[
            { value: "", label: t("projectDetail.general.noManager") },
            ...members.map((member) => ({
              value: member.userId,
              label: member.displayName,
            })),
          ]}
        />
      ) : (
        <span className="font-medium text-foreground">
          {project.managerName ?? t("projectDetail.general.noManager")}
        </span>
      )}
    </DetailRow>
  );
}

interface DateDetailProps {
  readonly field: "startDate" | "targetDate";
  readonly project: Project;
  readonly canWrite: boolean;
}

/** Renders the start or target date, changeable inline for writers. */
function DateDetail({
  field,
  project,
  canWrite,
}: DateDetailProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const label = t(`projectDetail.general.${field}`);
  const Icon = field === "startDate" ? Calendar : Flag;

  function handleCommit(value: string): void {
    void submit(
      {
        intent: "update-dates",
        startDate: project.startDate ?? "",
        targetDate: project.targetDate ?? "",
        [field]: value,
      },
      { method: "post" },
    );
  }

  return (
    <DetailRow
      icon={<Icon className="size-4 shrink-0" aria-hidden="true" />}
      label={label}
    >
      {canWrite ? (
        <InlineDateField
          label={label}
          onCommit={handleCommit}
          value={project[field]}
        />
      ) : (
        <span className="text-muted-foreground">
          {formatDate(project[field])}
        </span>
      )}
    </DetailRow>
  );
}

interface GeneralDetailsSectionProps {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly canWrite: boolean;
}

/** Renders the project facts, editable inline or through the edit dialog. */
export function GeneralDetailsSection({
  project,
  members,
  canWrite,
}: GeneralDetailsSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [isEditOpen, setIsEditOpen] = useState(false);

  function handleOpenEdit(): void {
    setIsEditOpen(true);
  }

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <div className="flex items-start justify-between gap-3">
        <h2 className="select-none font-semibold text-foreground">
          {t("projectDetail.general.details")}
        </h2>
        {canWrite ? (
          <Button
            variant="ghost"
            className="h-8 shrink-0 px-3 text-xs"
            onClick={handleOpenEdit}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("projectDetail.general.edit")}
          </Button>
        ) : null}
      </div>
      <dl className="mt-4 flex flex-col gap-3 text-sm">
        <StatusDetail canWrite={canWrite} status={project.status} />
        <ManagerDetail
          canWrite={canWrite}
          members={members}
          project={project}
        />
        <DateDetail canWrite={canWrite} field="startDate" project={project} />
        <DateDetail canWrite={canWrite} field="targetDate" project={project} />
        <DetailRow
          icon={<Fingerprint className="size-4 shrink-0" aria-hidden="true" />}
          label={t("projectDetail.general.projectId")}
        >
          <span className="text-muted-foreground">
            {project.id.slice(0, 8)}
          </span>
        </DetailRow>
        <DetailRow
          icon={<Clock className="size-4 shrink-0" aria-hidden="true" />}
          label={t("projectDetail.general.createdAt")}
        >
          <span className="text-muted-foreground">{project.createdAt}</span>
        </DetailRow>
        <DetailRow
          icon={<History className="size-4 shrink-0" aria-hidden="true" />}
          label={t("projectDetail.general.updatedAt")}
        >
          <span className="text-muted-foreground">{project.updatedAt}</span>
        </DetailRow>
      </dl>
      <EditDetailsDialog
        members={members}
        onOpenChange={setIsEditOpen}
        open={isEditOpen}
        project={project}
      />
    </section>
  );
}
