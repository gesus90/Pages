import { useState } from "react";
import {
  Calendar,
  CalendarPlus,
  ChartColumn,
  CircleAlert,
  Clock,
  Flag,
  Hash,
  History,
  Pencil,
  Plus,
  StickyNote,
  Users,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form, Link } from "react-router";

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
import { isProjectStatus, PROJECT_STATUS } from "@/definition/Project";
import {
  countOpenSubtasks,
  getMilestoneCompletion,
  getTaskCompletion,
} from "@/app/components/projects/project-progress";

import type { ChangeEvent, KeyboardEvent } from "react";
import type {
  Project,
  ProjectEvent,
  ProjectGoal,
  ProjectMember,
  ProjectStatus,
} from "@/definition/Project";
import type { Milestone, WorkItemDetail } from "@/definition/Task";

interface ProjectGeneralTabProps {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly goals: readonly ProjectGoal[];
  readonly tags: readonly string[];
  readonly events: readonly ProjectEvent[];
  readonly milestones: readonly Milestone[];
  readonly workItems: readonly WorkItemDetail[];
  readonly canWrite: boolean;
}

const MAXIMUM_DESCRIPTION_LENGTH = 5000;

/** Formats a counter with German thousands grouping without locale data. */
function formatCounter(value: number): string {
  if (value < 1000) {
    return String(value);
  }

  return `${Math.floor(value / 1000)}.${String(value % 1000).padStart(3, "0")}`;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "---";
  }

  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("de-DE");
}

function EditDetailsDialog({
  project,
  members,
  open,
  onOpenChange,
}: {
  readonly project: Project;
  readonly members: readonly ProjectMember[];
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [selectedStatus, setSelectedStatus] = useState<ProjectStatus>(
    project.status,
  );
  const [selectedManagerId, setSelectedManagerId] = useState<string>(
    project.managerId ?? "",
  );

  function handleStatusChange(nextValue: string): void {
    setSelectedStatus(nextValue as ProjectStatus);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(36rem,92vw)]">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("projectDetail.general.editTitle")}
        </DialogTitle>
        <Form className="mt-5 flex flex-col gap-3" method="post" noValidate>
          <input name="intent" type="hidden" value="update-details" />
          <input name="status" type="hidden" value={selectedStatus} />
          <input name="managerId" type="hidden" value={selectedManagerId} />
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
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-2 text-sm font-medium">
              <span className="select-none">{t("projects.fields.status")}</span>
              <Select
                id="detail-status"
                ariaLabel={t("projects.fields.status")}
                value={selectedStatus}
                onValueChange={handleStatusChange}
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
            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="select-none">
                {t("projectDetail.general.startDate")}
              </span>
              <Input
                name="startDate"
                type="date"
                defaultValue={project.startDate ?? ""}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium">
              <span className="select-none">
                {t("projectDetail.general.targetDate")}
              </span>
              <Input
                name="targetDate"
                type="date"
                defaultValue={project.targetDate ?? ""}
              />
            </label>
          </div>
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

/** Renders the task completion as a ring with a centered percentage. */
function ProgressRing({
  percentage,
}: {
  readonly percentage: number;
}): React.ReactElement {
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(100, Math.max(0, percentage));

  return (
    <div
      className="relative size-[88px] shrink-0"
      role="img"
      aria-label={`${clamped} %`}
    >
      <svg
        viewBox="0 0 88 88"
        className="size-full -rotate-90"
        aria-hidden="true"
      >
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="8"
          className="stroke-muted"
        />
        <circle
          cx="44"
          cy="44"
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          className="stroke-primary"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - (clamped / 100) * circumference}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-lg font-bold text-foreground">
        {clamped} %
      </span>
    </div>
  );
}

/** Submits the surrounding date form when its value changes. */
function submitDateForm(event: ChangeEvent<HTMLInputElement>): void {
  event.currentTarget.form?.requestSubmit();
}

interface InlineDateFieldProps {
  readonly name: "startDate" | "targetDate";
  readonly value: string | null;
  readonly label: string;
}

/** Renders an inline date value that swaps to a native picker on click. */
function InlineDateField({
  name,
  value,
  label,
}: InlineDateFieldProps): React.ReactElement {
  const [isEditing, setIsEditing] = useState(false);

  function handleOpen(): void {
    setIsEditing(true);
  }

  function handleClose(): void {
    setIsEditing(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Escape") {
      setIsEditing(false);
    }
  }

  if (!isEditing) {
    return (
      <button
        className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        type="button"
        aria-label={label}
        onClick={handleOpen}
      >
        <Calendar className="size-4 shrink-0" aria-hidden="true" />
        {formatDate(value)}
      </button>
    );
  }

  return (
    <Input
      name={name}
      type="date"
      defaultValue={value ?? ""}
      autoFocus
      onChange={submitDateForm}
      onBlur={handleClose}
      onKeyDown={handleKeyDown}
      aria-label={label}
      className="h-9 w-40"
    />
  );
}

/** Renders the general overview tab with description focus and a slim side column. */
export function ProjectGeneralTab({
  project,
  members,
  goals,
  tags,
  events,
  milestones,
  workItems,
  canWrite,
}: ProjectGeneralTabProps): React.ReactElement {
  const { t } = useTranslation();
  const taskCompletion = getTaskCompletion(workItems);
  const milestoneCompletion = getMilestoneCompletion(milestones);
  const openSubtasks = countOpenSubtasks(workItems);
  const upcomingEvents = events.slice(0, 4);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isGoalFormOpen, setIsGoalFormOpen] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState(project.description);

  function handleOpenEditDialog(): void {
    setIsEditDialogOpen(true);
  }

  function handleToggleGoalForm(): void {
    setIsGoalFormOpen((isOpen) => !isOpen);
  }

  function handleStartDescriptionEdit(): void {
    setDescriptionDraft(project.description);
    setIsEditingDescription(true);
  }

  function handleDescriptionChange(
    event: ChangeEvent<HTMLTextAreaElement>,
  ): void {
    setDescriptionDraft(event.currentTarget.value);
  }

  function handleCancelDescriptionEdit(): void {
    setIsEditingDescription(false);
  }

  function handleDescriptionKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
  ): void {
    if (event.key === "Escape") {
      setIsEditingDescription(false);
    }
  }

  function handleSubmitDescription(): void {
    setIsEditingDescription(false);
  }

  function handleDescriptionTextKeyDown(
    event: KeyboardEvent<HTMLParagraphElement>,
  ): void {
    if (event.key === "Enter") {
      handleStartDescriptionEdit();
    }
  }

  function handleManagerChange(nextValue: string): void {
    const form = document.getElementById("detail-manager-form");

    if (form instanceof HTMLFormElement) {
      const managerInput = form.querySelector('input[name="managerId"]');

      if (managerInput instanceof HTMLInputElement) {
        managerInput.value = nextValue;
      }

      form.requestSubmit();
    }
  }

  function handleStatusChange(nextValue: string): void {
    if (!isProjectStatus(nextValue)) {
      return;
    }

    const form = document.getElementById("detail-status-form");

    if (form instanceof HTMLFormElement) {
      const statusInput = form.querySelector('input[name="status"]');

      if (statusInput instanceof HTMLInputElement) {
        statusInput.value = nextValue;
      }

      form.requestSubmit();
    }
  }

  const isDescriptionDirty = descriptionDraft !== project.description;

  return (
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl bg-muted/40 p-6">
          <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
            <CircleAlert className="size-5 text-primary" aria-hidden="true" />
            {t("projectDetail.general.overview")}
          </h2>
          <p className="mt-4 text-sm font-medium text-foreground">
            {t("projectDetail.general.description")}
          </p>
          {isEditingDescription ? (
            <Form
              method="post"
              className="mt-2"
              onSubmit={handleSubmitDescription}
            >
              <input name="intent" type="hidden" value="update-description" />
              <Textarea
                className="min-h-48 resize-y px-5 py-5 text-sm leading-relaxed"
                name="description"
                value={descriptionDraft}
                maxLength={MAXIMUM_DESCRIPTION_LENGTH}
                onChange={handleDescriptionChange}
                onKeyDown={handleDescriptionKeyDown}
                autoFocus
                aria-label={t("projectDetail.general.description")}
              />
              <div className="mt-2 flex items-center justify-end gap-2">
                <span className="mr-auto text-xs text-muted-foreground">
                  {t("projectDetail.general.descriptionCounter", {
                    count: formatCounter(descriptionDraft.length),
                  })}
                </span>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={handleCancelDescriptionEdit}
                >
                  {t("projects.actions.cancel")}
                </Button>
                {isDescriptionDirty ? (
                  <Button type="submit">{t("projects.edit.submit")}</Button>
                ) : null}
              </div>
            </Form>
          ) : (
            <div className="mt-2 min-h-40 rounded-xl bg-surface px-5 py-5 shadow-xs">
              <p
                className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground outline-none"
                onDoubleClick={
                  canWrite ? handleStartDescriptionEdit : undefined
                }
                onKeyDown={canWrite ? handleDescriptionTextKeyDown : undefined}
                tabIndex={canWrite ? 0 : undefined}
              >
                {project.description || t("projects.noDescription")}
              </p>
            </div>
          )}
          {tags.length ? (
            <ul className="mt-4 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <section className="rounded-2xl bg-muted/40 p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
              <CircleAlert className="size-5 text-primary" aria-hidden="true" />
              {t("projectDetail.general.goals")}
            </h2>
            {canWrite ? (
              <Button
                variant="ghost"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={handleToggleGoalForm}
              >
                <Plus className="size-3.5" aria-hidden="true" />
                {t("projectDetail.general.addGoal")}
              </Button>
            ) : null}
          </div>
          {goals.length ? (
            <ul className="mt-4 flex flex-col gap-2.5">
              {goals.map((goal) => (
                <li
                  key={goal.id}
                  className="flex items-center gap-3 rounded-xl bg-surface px-4 py-3 text-sm shadow-xs"
                >
                  {canWrite ? (
                    <Form method="post" className="flex shrink-0 items-center">
                      <input name="intent" type="hidden" value="toggle-goal" />
                      <input name="goalId" type="hidden" value={goal.id} />
                      <button
                        type="submit"
                        aria-label={goal.title}
                        className={`flex size-5 items-center justify-center rounded-full border-2 transition-colors ${
                          goal.isDone
                            ? "border-primary bg-primary text-white"
                            : "border-muted-foreground/40 text-transparent hover:border-primary"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className="text-xs leading-none"
                        >
                          ✓
                        </span>
                      </button>
                    </Form>
                  ) : (
                    <span
                      aria-hidden="true"
                      className={`flex size-5 shrink-0 items-center justify-center rounded-full border-2 ${
                        goal.isDone
                          ? "border-primary bg-primary text-white"
                          : "border-muted-foreground/40"
                      }`}
                    />
                  )}
                  <span
                    className={`min-w-0 flex-1 truncate ${
                      goal.isDone
                        ? "text-muted-foreground line-through"
                        : "text-foreground"
                    }`}
                  >
                    {goal.title}
                  </span>
                  <span
                    className={`shrink-0 text-xs font-medium ${
                      goal.isDone ? "text-emerald-600" : "text-muted-foreground"
                    }`}
                  >
                    {goal.isDone
                      ? t("projectDetail.general.goalDone")
                      : t("projectDetail.general.goalOpen")}
                  </span>
                  {canWrite ? (
                    <Form method="post" className="shrink-0">
                      <input name="intent" type="hidden" value="delete-goal" />
                      <input name="goalId" type="hidden" value={goal.id} />
                      <button
                        type="submit"
                        aria-label={`${t("projects.actions.archive")}: ${goal.title}`}
                        className="rounded-md px-2 text-xs text-muted-foreground hover:text-destructive"
                      >
                        ×
                      </button>
                    </Form>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-muted-foreground">
              {t("projectDetail.general.goalsEmpty")}
            </p>
          )}
          {canWrite && isGoalFormOpen ? (
            <Form method="post" className="mt-4 flex gap-2">
              <input name="intent" type="hidden" value="create-goal" />
              <Input
                name="title"
                maxLength={200}
                placeholder={t("projectDetail.general.goals")}
                aria-label={t("projectDetail.general.goals")}
              />
              <Button type="submit" variant="ghost" className="shrink-0 border">
                {t("projectDetail.planning.create")}
              </Button>
            </Form>
          ) : null}
        </section>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl bg-muted/40 p-6">
            <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
              <ChartColumn className="size-5 text-primary" aria-hidden="true" />
              {t("projectDetail.general.progress")}
            </h2>
            <div className="mt-4 flex items-center gap-5">
              <ProgressRing percentage={taskCompletion.percentage} />
              <p className="min-w-0 text-sm leading-relaxed text-muted-foreground">
                {t("projectDetail.general.progressHint")}
              </p>
            </div>
            <dl className="mt-4 flex flex-col gap-2 text-sm">
              <div className="flex items-center justify-between gap-3  pt-2">
                <dt className="text-muted-foreground">
                  {t("projectDetail.general.tasksDone")}
                </dt>
                <dd className="font-medium text-foreground">
                  {taskCompletion.done} / {taskCompletion.total}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3  pt-2">
                <dt className="text-muted-foreground">
                  {t("projectDetail.general.milestonesDone")}
                </dt>
                <dd className="font-medium text-foreground">
                  {milestoneCompletion.done} / {milestoneCompletion.total}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-3  pt-2">
                <dt className="text-muted-foreground">
                  {t("projectDetail.general.openSubtasks")}
                </dt>
                <dd className="font-medium text-foreground">{openSubtasks}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl bg-muted/40 p-6">
            <div className="flex items-start justify-between gap-3">
              <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
                <Calendar className="size-5 text-primary" aria-hidden="true" />
                {t("projectDetail.general.nextDates")}
              </h2>
              <Link
                to="?tab=planning"
                prefetch="intent"
                className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {t("projectDetail.general.showAllDates")}
              </Link>
            </div>
            {upcomingEvents.length ? (
              <ul className="mt-3 flex flex-col">
                {upcomingEvents.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-center gap-3 py-2.5 text-sm first:pt-0"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary">
                      <Calendar className="size-4" aria-hidden="true" />
                    </span>
                    <span className="w-24 shrink-0 text-muted-foreground">
                      {formatDate(event.eventDate)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-foreground">
                        {event.title}
                      </span>
                      {event.eventTime ? (
                        <span className="block text-xs text-muted-foreground">
                          {event.eventTime}
                        </span>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-3 flex flex-col items-center py-4 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  <Calendar className="size-5" aria-hidden="true" />
                </span>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t("projectDetail.general.noDates")}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <section className="rounded-2xl bg-muted/40 p-6">
          <h2 className="select-none font-semibold text-foreground">
            {t("projectDetail.general.icon")}
          </h2>
          <div className="mt-4 flex items-center gap-4">
            {project.hasIcon ? (
              <img
                className="size-16 shrink-0 rounded-xl object-cover"
                src={`/projekte/${project.id}/icon`}
                alt=""
              />
            ) : (
              <span
                className="inline-flex size-16 shrink-0 select-none items-center justify-center rounded-xl text-3xl font-semibold"
                style={{ backgroundColor: project.placeholderColor }}
                aria-hidden="true"
              >
                {project.name.trim().charAt(0).toLocaleUpperCase()}
              </span>
            )}
            {canWrite ? (
              <Form
                action={`/projekte/${project.id}/icon`}
                encType="multipart/form-data"
                method="post"
              >
                <label className="inline-flex min-h-9 cursor-pointer select-none items-center rounded-xl bg-muted px-3 text-sm font-semibold text-foreground hover:bg-sidebar-hover">
                  {t("projectDetail.general.changeIcon")}
                  <input
                    className="sr-only"
                    accept="image/jpeg,image/png,image/webp"
                    name="icon"
                    type="file"
                    onChange={(event) =>
                      event.currentTarget.form?.requestSubmit()
                    }
                  />
                </label>
              </Form>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl bg-muted/40 p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 className="select-none font-semibold text-foreground">
              {t("projectDetail.general.details")}
            </h2>
            {canWrite ? (
              <Button
                variant="ghost"
                className="h-8 shrink-0 px-3 text-xs"
                onClick={handleOpenEditDialog}
              >
                <Pencil className="size-3.5" aria-hidden="true" />
                {t("projectDetail.general.edit")}
              </Button>
            ) : null}
          </div>
          <dl className="mt-4 flex flex-col gap-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <Flag className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.status")}
              </dt>
              <dd>
                {canWrite ? (
                  <Form id="detail-status-form" method="post">
                    <input name="intent" type="hidden" value="update-status" />
                    <input name="status" type="hidden" value={project.status} />
                    <Select
                      id="detail-inline-status"
                      ariaLabel={t("projectDetail.general.status")}
                      value={project.status}
                      onValueChange={handleStatusChange}
                      className="min-w-36"
                      options={Object.values(PROJECT_STATUS).map((status) => ({
                        value: status,
                        label: t(`projects.status.${status}`),
                      }))}
                    />
                  </Form>
                ) : (
                  <span className="inline-flex items-center gap-2 font-medium text-foreground">
                    <span
                      className="size-2 rounded-full bg-primary"
                      aria-hidden="true"
                    />
                    {t(`projects.status.${project.status}`)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3  pt-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <Users className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.manager")}
              </dt>
              <dd>
                {canWrite ? (
                  <Form id="detail-manager-form" method="post">
                    <input name="intent" type="hidden" value="update-manager" />
                    <input
                      name="managerId"
                      type="hidden"
                      value={project.managerId ?? ""}
                    />
                    <Select
                      id="detail-inline-manager"
                      ariaLabel={t("projectDetail.general.manager")}
                      value={project.managerId ?? ""}
                      onValueChange={handleManagerChange}
                      className="min-w-36"
                      options={[
                        {
                          value: "",
                          label: t("projectDetail.general.noManager"),
                        },
                        ...members.map((member) => ({
                          value: member.userId,
                          label: member.displayName,
                        })),
                      ]}
                    />
                  </Form>
                ) : (
                  <span className="font-medium text-foreground">
                    {project.managerName ??
                      t("projectDetail.general.noManager")}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3  pt-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <Calendar className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.startDate")}
              </dt>
              <dd>
                {canWrite ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="update-dates" />
                    <input
                      name="targetDate"
                      type="hidden"
                      value={project.targetDate ?? ""}
                    />
                    <InlineDateField
                      name="startDate"
                      value={project.startDate}
                      label={t("projectDetail.general.startDate")}
                    />
                  </Form>
                ) : (
                  <span className="text-muted-foreground">
                    {formatDate(project.startDate)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3  pt-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <Flag className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.targetDate")}
              </dt>
              <dd>
                {canWrite ? (
                  <Form method="post">
                    <input name="intent" type="hidden" value="update-dates" />
                    <input
                      name="startDate"
                      type="hidden"
                      value={project.startDate ?? ""}
                    />
                    <InlineDateField
                      name="targetDate"
                      value={project.targetDate}
                      label={t("projectDetail.general.targetDate")}
                    />
                  </Form>
                ) : (
                  <span className="text-muted-foreground">
                    {formatDate(project.targetDate)}
                  </span>
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3  pt-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <Hash className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.projectId")}
              </dt>
              <dd className="text-muted-foreground">
                {project.id.slice(0, 8)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3  pt-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <Clock className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.createdAt")}
              </dt>
              <dd className="text-muted-foreground">{project.createdAt}</dd>
            </div>
            <div className="flex items-center justify-between gap-3  pt-3">
              <dt className="inline-flex select-none items-center gap-2 text-muted-foreground">
                <History className="size-4 shrink-0" aria-hidden="true" />
                {t("projectDetail.general.updatedAt")}
              </dt>
              <dd className="text-muted-foreground">{project.updatedAt}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl bg-muted/40 p-6">
          <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
            <Zap className="size-5 text-primary" aria-hidden="true" />
            {t("projectDetail.general.quickActions")}
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Link
              to="/aufgaben"
              prefetch="intent"
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-primary px-2 py-3 text-center text-xs font-semibold text-primary-foreground transition-all hover:brightness-[1.04]"
            >
              <Plus className="size-5 shrink-0" aria-hidden="true" />
              {t("projectDetail.general.newTask")}
            </Link>
            <Link
              to="?tab=planning"
              prefetch="intent"
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface px-2 py-3 text-center text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
            >
              <CalendarPlus className="size-5 shrink-0" aria-hidden="true" />
              {t("projectDetail.general.planEvent")}
            </Link>
            <Link
              to="?tab=team"
              prefetch="intent"
              className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl bg-surface px-2 py-3 text-center text-xs font-semibold text-foreground shadow-xs transition-colors hover:bg-surface-hover"
            >
              <Users className="size-5 shrink-0" aria-hidden="true" />
              {t("projectDetail.general.manageTeam")}
            </Link>
          </div>
        </section>

        <section className="rounded-2xl bg-muted/40 p-6">
          <h2 className="select-none font-semibold text-foreground">
            {t("projectDetail.general.notes")}
          </h2>
          {project.notes ? (
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {project.notes}
            </p>
          ) : (
            <div className="mt-3 flex flex-col items-center py-4 text-center">
              <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <StickyNote className="size-5" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm text-muted-foreground">
                {t("projectDetail.general.noNotes")}
              </p>
              <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
                {t("projectDetail.general.notesEmptyHint")}
              </p>
            </div>
          )}
        </section>
      </div>

      <EditDetailsDialog
        project={project}
        members={members}
        open={isEditDialogOpen}
        onOpenChange={setIsEditDialogOpen}
      />
    </div>
  );
}
