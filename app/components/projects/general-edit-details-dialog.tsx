import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { Textarea } from "@/app/components/ui/textarea";
import { PROJECT_STATUS } from "@/definition/Project";

import type {
  Project,
  ProjectMember,
  ProjectStatus,
} from "@/definition/Project";

interface DateFieldProps {
  readonly name: string;
  readonly label: string;
  readonly defaultValue: string;
}

function DateField({
  name,
  label,
  defaultValue,
}: DateFieldProps): React.ReactElement {
  return (
    <label className="flex flex-col gap-2 text-sm font-medium">
      <span className="select-none">{label}</span>
      <Input name={name} type="date" defaultValue={defaultValue} />
    </label>
  );
}

interface DetailsSelectFieldsProps {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
}

/** Renders status, manager and date fields; status and manager are selects. */
function DetailsSelectFields({
  project,
  members,
}: DetailsSelectFieldsProps): React.ReactElement {
  const { t } = useTranslation();
  const [selectedStatus, setSelectedStatus] = useState<ProjectStatus>(
    project.status,
  );
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    project.managerId ?? "",
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input name="status" type="hidden" value={selectedStatus} />
      <input name="managerId" type="hidden" value={selectedManagerId} />
      <div className="flex flex-col gap-2 text-sm font-medium">
        <span className="select-none">{t("projects.fields.status")}</span>
        <Select
          id="detail-status"
          ariaLabel={t("projects.fields.status")}
          value={selectedStatus}
          onValueChange={setSelectedStatus}
          className="w-full"
          options={Object.values(PROJECT_STATUS).map((status) => ({
            value: status,
            label: t(`projects.status.${status}`),
          }))}
        />
      </div>
      <div className="flex flex-col gap-2 text-sm font-medium">
        <span className="select-none">
          {t("projectDetail.general.manager")}
        </span>
        <Select
          id="detail-manager"
          ariaLabel={t("projectDetail.general.manager")}
          value={selectedManagerId}
          onValueChange={setSelectedManagerId}
          className="w-full"
          options={[
            { value: "", label: t("projectDetail.general.noManager") },
            ...members.map((member) => ({
              value: member.userId,
              label: member.displayName,
            })),
          ]}
        />
      </div>
      <DateField
        defaultValue={project.startDate ?? ""}
        label={t("projectDetail.general.startDate")}
        name="startDate"
      />
      <DateField
        defaultValue={project.targetDate ?? ""}
        label={t("projectDetail.general.targetDate")}
        name="targetDate"
      />
    </div>
  );
}

interface EditDetailsDialogProps {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

/** Renders the dialog for editing status, manager, dates and notes of a project. */
export function EditDetailsDialog({
  project,
  members,
  open,
  onOpenChange,
}: EditDetailsDialogProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(36rem,92vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projectDetail.general.editTitle")}
        </DialogTitle>
        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="update-details" />
          <label
            className="select-none text-sm font-medium"
            htmlFor="detail-name"
          >
            {t("projects.fields.name")}
          </label>
          <Input
            id="detail-name"
            name="name"
            defaultValue={project.name}
            required
          />
          <DetailsSelectFields members={members} project={project} />
          <label
            className="select-none text-sm font-medium"
            htmlFor="detail-notes"
          >
            {t("projectDetail.general.notes")}
          </label>
          <Textarea
            className="min-h-24 resize-y"
            id="detail-notes"
            name="notes"
            defaultValue={project.notes}
            placeholder={t("projectDetail.general.notesPlaceholder")}
          />
          <div className="mt-2 flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost">{t("projects.actions.cancel")}</Button>
            </DialogClose>
            <Button type="submit">{t("projects.edit.submit")}</Button>
          </div>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
