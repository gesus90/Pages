import { Edit3, Folder, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { TaskTypeBadge } from "@/app/components/tasks/task-badges";
import { useTicketAccess } from "@/app/components/tasks/ticket-access";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { Select } from "@/app/components/ui/select";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import type { WorkItemDetail, WorkflowStatus } from "@/definition/Task";

interface TopBarProps {
  readonly task: WorkItemDetail;
  readonly statuses: readonly WorkflowStatus[];
  readonly isArchived: boolean;
  readonly onEdit: (task: WorkItemDetail) => void;
  readonly onClose: () => void;
  readonly onSelectTask: (key: string) => void;
  readonly onChangeStatus: (statusId: string) => void;
}

/** Renders type, key, parent and the actions in the first row of the header. */
function TopBar({
  task,
  statuses,
  isArchived,
  onEdit,
  onClose,
  onSelectTask,
  onChangeStatus,
}: TopBarProps): React.ReactElement {
  const { t } = useTranslation();
  const parentKey = task.parentKey;

  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-muted-foreground">
        <TaskTypeBadge type={task.type} />
        <span className="font-semibold">{task.key}</span>
        {parentKey && task.parentTitle ? (
          <button
            className="flex min-w-0 items-center gap-1 truncate hover:text-foreground hover:underline"
            onClick={() => onSelectTask(parentKey)}
            type="button"
          >
            <Folder className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0 font-semibold">{parentKey}</span>
            <span className="min-w-0 truncate">{task.parentTitle}</span>
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1 truncate">
            <Folder className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{task.projectName}</span>
          </span>
        )}
        {isArchived ? (
          <span className="shrink-0 rounded-md bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-700">
            {t("tasks.archived.badge")}
          </span>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!isArchived ? (
          <Button
            className="h-9 gap-1.5 px-3 text-xs"
            onClick={() => onEdit(task)}
            type="button"
            variant="outline"
          >
            {t("tasks.edit.trigger")}
          </Button>
        ) : null}
        <Select
          ariaLabel={t("tasks.fields.status")}
          className="h-9 font-semibold"
          disabled={isArchived}
          onValueChange={onChangeStatus}
          options={statuses.map((status) => ({
            label: status.name,
            value: status.id,
          }))}
          value={task.statusId}
        />
        <Button
          aria-label={t("tasks.actions.close")}
          className="size-9 min-h-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={onClose}
          type="button"
          variant="ghost"
        >
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

interface TitleProps {
  readonly title: string;
  readonly isArchived: boolean;
  readonly onSave: (title: string) => void;
  /** The heading level; the full ticket page uses its main heading. */
  readonly level?: "h1" | "h2";
}

/** Renders the ticket title, which is edited in place; panel and full view share it. */
export function EditableTicketTitle({
  title,
  isArchived,
  onSave,
  level: Heading = "h2",
}: TitleProps): React.ReactElement {
  const { t } = useTranslation();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);

  function handleStartEditTitle(): void {
    setTitleDraft(title);
    setIsEditingTitle(true);
  }

  function handleCancelEditTitle(): void {
    setIsEditingTitle(false);
    setTitleDraft(title);
  }

  function handleSaveTitle(): void {
    const trimmedTitle = titleDraft.trim();

    if (trimmedTitle && trimmedTitle !== title) {
      onSave(trimmedTitle);
    }

    setIsEditingTitle(false);
  }

  function handleTitleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setTitleDraft(event.target.value);
  }

  function handleTitleKeyDown(
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSaveTitle();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      handleCancelEditTitle();
    }
  }

  function handleTitleDoubleClick(): void {
    if (!isArchived) {
      handleStartEditTitle();
    }
  }

  return (
    <div className="group mt-3 flex items-start gap-2">
      {!isArchived && !isEditingTitle ? (
        <button
          aria-label={t("tasks.actions.editTitle")}
          className="mt-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
          onClick={handleStartEditTitle}
          type="button"
        >
          <Edit3 className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
      {isEditingTitle ? (
        <div className="flex flex-1 items-start gap-2">
          <Input
            ref={focusOnMount}
            className="flex-1 text-xl font-semibold sm:text-2xl"
            onChange={handleTitleChange}
            onKeyDown={handleTitleKeyDown}
            value={titleDraft}
          />
          <Button
            className="h-9 gap-1.5 px-3 text-xs"
            onClick={handleSaveTitle}
            type="button"
          >
            {t("tasks.actions.save")}
          </Button>
          <Button
            className="h-9 gap-1.5 px-3 text-xs"
            onClick={handleCancelEditTitle}
            type="button"
            variant="ghost"
          >
            {t("tasks.actions.cancel")}
          </Button>
        </div>
      ) : (
        <div className="min-w-0 flex-1">
          <Heading
            className="cursor-text text-xl font-semibold tracking-tight text-foreground transition-colors sm:text-2xl"
            onDoubleClick={handleTitleDoubleClick}
          >
            {title}
          </Heading>
          {!isArchived ? (
            <p className="mt-0.5 text-xs text-muted-foreground select-none">
              {t("tasks.detail.doubleClickHint")}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface ArchivedBannerProps {
  readonly workItemId: string;
  readonly isArchiving: boolean;
}

/** Renders the notice of an archived ticket with the button to restore it. */
function ArchivedBanner({
  workItemId,
  isArchiving,
}: ArchivedBannerProps): React.ReactElement {
  const { t } = useTranslation();
  const { canWrite } = useTicketAccess();

  return (
    <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-orange-50 px-4 py-2 text-xs">
      <span className="font-semibold text-foreground">
        {t("tasks.archived.banner")}
      </span>
      {canWrite ? (
        <Form method="post">
          <input name="intent" type="hidden" value="restore-task" />
          <input name="id" type="hidden" value={workItemId} />
          <Button
            className="h-8 gap-1.5 px-3 text-xs"
            disabled={isArchiving}
            type="submit"
            variant="ghost"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            {t("tasks.archived.restore")}
          </Button>
        </Form>
      ) : null}
    </div>
  );
}

interface DetailHeaderProps {
  readonly task: WorkItemDetail;
  readonly statuses: readonly WorkflowStatus[];
  readonly isArchived: boolean;
  readonly isArchiving: boolean;
  readonly onEdit: (task: WorkItemDetail) => void;
  readonly onClose: () => void;
  readonly onSelectTask: (key: string) => void;
  readonly onChangeStatus: (statusId: string) => void;
  readonly onSaveTitle: (title: string) => void;
}

/** Renders ticket type, key, parent, actions and the editable title. */
export function DetailHeader({
  task,
  statuses,
  isArchived,
  isArchiving,
  onEdit,
  onClose,
  onSelectTask,
  onChangeStatus,
  onSaveTitle,
}: DetailHeaderProps): React.ReactElement {
  return (
    <header className="shrink-0 px-5 pt-5 sm:px-7 sm:pt-6">
      <TopBar
        isArchived={isArchived}
        onChangeStatus={onChangeStatus}
        onClose={onClose}
        onEdit={onEdit}
        onSelectTask={onSelectTask}
        statuses={statuses}
        task={task}
      />
      <EditableTicketTitle
        isArchived={isArchived}
        onSave={onSaveTitle}
        title={task.title}
      />
      {isArchived ? (
        <ArchivedBanner isArchiving={isArchiving} workItemId={task.id} />
      ) : null}
    </header>
  );
}
