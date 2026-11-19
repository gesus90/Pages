import { Check, Pencil, Plus, Search, X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData, useSubmit } from "react-router";

import { LabelEditor } from "@/app/components/tasks/label-editor";
import { useLabelCreation } from "@/app/components/tasks/label-picker/use-label-creation";
import { useLabelEditing } from "@/app/components/tasks/label-picker/use-label-editing";
import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { ScrollViewport } from "@/app/components/ui/scroll-viewport";
import { cn } from "@/app/lib/cn";

import type { LabelCreation } from "@/app/components/tasks/label-picker/use-label-creation";
import type { LabelEditing } from "@/app/components/tasks/label-picker/use-label-editing";
import type { TaskActionErrorCode } from "@/app/lib/task-actions/task-action-support.server";
import type { action } from "@/app/routes/tasks-server";
import type { Label } from "@/definition/Task";

interface LabelPickerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workItemId: string;
  readonly labels: readonly Label[];
  readonly assignedLabelIds: ReadonlySet<string>;
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly isSubmitting?: boolean;
}

interface LabelFailure {
  readonly error: TaskActionErrorCode | null;
  readonly dismiss: () => void;
}

interface LabelSearchFieldProps {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}

interface LabelDeleteControlProps {
  readonly label: Label;
  readonly usage: number;
  readonly isConfirming: boolean;
  readonly isSubmitting: boolean;
  readonly onDelete: (label: Label) => void;
  readonly onCancel: () => void;
}

interface LabelEditRowProps {
  readonly label: Label;
  readonly usage: number;
  readonly isSubmitting: boolean;
  readonly editing: LabelEditing;
}

interface LabelRowProps {
  readonly label: Label;
  readonly isAssigned: boolean;
  readonly usage: number;
  readonly onToggle: (label: Label) => void;
  readonly onEdit: (label: Label) => void;
}

interface LabelListItemProps {
  readonly label: Label;
  readonly isAssigned: boolean;
  readonly usage: number;
  readonly isSubmitting: boolean;
  readonly editing: LabelEditing;
  readonly onToggle: (label: Label) => void;
}

interface LabelListProps {
  readonly labels: readonly Label[];
  readonly assignedLabelIds: ReadonlySet<string>;
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly isSubmitting: boolean;
  readonly editing: LabelEditing;
  readonly onToggle: (label: Label) => void;
}

interface LabelCreateSectionProps {
  readonly creation: LabelCreation;
  readonly isSubmitting: boolean;
}

function filterLabels(
  labels: readonly Label[],
  query: string,
): readonly Label[] {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return labels;
  }

  return labels.filter((label) =>
    label.name.toLowerCase().includes(normalizedQuery),
  );
}

// The failure stays until another action answers or the dialog closes, so
// reopening the dialog does not show the answer to an earlier attempt.
function useLabelFailure(): LabelFailure {
  const actionData = useActionData<typeof action>();
  const [dismissed, setDismissed] = useState<unknown>(null);

  function dismiss(): void {
    setDismissed(actionData);
  }

  if (
    !actionData ||
    actionData.ok ||
    !actionData.intent.startsWith("label-") ||
    actionData === dismissed
  ) {
    return { dismiss, error: null };
  }

  return { dismiss, error: actionData.error };
}

function LabelSearchField({
  query,
  onQueryChange,
}: LabelSearchFieldProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 flex h-11 items-center gap-2.5 rounded-xl bg-muted/60 pr-2 pl-3.5 outline-none transition-shadow focus-within:bg-muted/80 focus-within:ring-2 focus-within:ring-primary">
      <Search
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        aria-label={t("tasks.labels.search")}
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t("tasks.labels.search")}
        value={query}
      />
      {query ? (
        <button
          aria-label={t("tasks.actions.clearSearch")}
          className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={() => onQueryChange("")}
          type="button"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function LabelDeleteControl({
  label,
  usage,
  isConfirming,
  isSubmitting,
  onDelete,
  onCancel,
}: LabelDeleteControlProps): React.ReactElement {
  const { t } = useTranslation();

  if (!isConfirming) {
    return (
      <div className="flex justify-start">
        <Button
          className="h-8 gap-1.5 px-3 text-xs text-muted-foreground hover:text-destructive"
          onClick={() => onDelete(label)}
          type="button"
          variant="ghost"
        >
          {t("tasks.labels.delete")}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs">
      <p className="font-medium text-foreground">
        {t("tasks.labels.deleteConfirm", {
          count: usage,
          name: label.name,
        })}
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          className="h-8 px-3 text-xs"
          onClick={onCancel}
          type="button"
          variant="ghost"
        >
          {t("tasks.actions.cancel")}
        </Button>
        <Button
          className="h-8 px-3 text-xs"
          disabled={isSubmitting}
          onClick={() => onDelete(label)}
          type="button"
        >
          {t("tasks.labels.deleteSubmit")}
        </Button>
      </div>
    </div>
  );
}

function LabelEditRow({
  label,
  usage,
  isSubmitting,
  editing,
}: LabelEditRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2 p-1">
      <LabelEditor
        name={editing.editName}
        color={editing.editColor}
        isSaving={isSubmitting}
        canSave={editing.editName.trim().length > 0}
        saveLabel={t("tasks.labels.save")}
        onNameChange={editing.setEditName}
        onColorChange={editing.setEditColor}
        onSave={() => editing.saveEdit(label)}
        onCancel={editing.cancelEdit}
      />
      <LabelDeleteControl
        isConfirming={editing.confirmDeleteId === label.id}
        isSubmitting={isSubmitting}
        label={label}
        onCancel={editing.cancelDelete}
        onDelete={editing.deleteLabel}
        usage={usage}
      />
    </div>
  );
}

function LabelRow({
  label,
  isAssigned,
  usage,
  onToggle,
  onEdit,
}: LabelRowProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-1">
      <button
        aria-pressed={isAssigned}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
        onClick={() => onToggle(label)}
        type="button"
      >
        <span
          className="size-3.5 shrink-0 rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: label.color }}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">
          {label.name}
        </span>
        {isAssigned ? (
          <Check className="size-4 shrink-0 text-primary" aria-hidden="true" />
        ) : null}
      </button>
      <span
        className="shrink-0 px-1 text-xs text-muted-foreground tabular-nums"
        title={t("tasks.labels.usage", { count: usage })}
      >
        {usage}
      </span>
      <button
        aria-label={`${t("tasks.labels.edit")} ${label.name}`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-all group-hover:opacity-100 hover:bg-surface hover:text-foreground focus-visible:opacity-100"
        onClick={() => onEdit(label)}
        type="button"
      >
        <Pencil className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

function LabelListItem({
  label,
  isAssigned,
  usage,
  isSubmitting,
  editing,
  onToggle,
}: LabelListItemProps): React.ReactElement {
  return (
    <li
      className={cn(
        "group rounded-xl p-1.5 text-sm transition-colors",
        isAssigned
          ? "bg-primary/10 ring-1 ring-primary/40"
          : "bg-muted/40 hover:bg-muted/70",
      )}
    >
      {editing.editingId === label.id ? (
        <LabelEditRow
          editing={editing}
          isSubmitting={isSubmitting}
          label={label}
          usage={usage}
        />
      ) : (
        <LabelRow
          isAssigned={isAssigned}
          label={label}
          onEdit={editing.startEdit}
          onToggle={onToggle}
          usage={usage}
        />
      )}
    </li>
  );
}

function LabelList({
  labels,
  assignedLabelIds,
  labelUsage,
  isSubmitting,
  editing,
  onToggle,
}: LabelListProps): React.ReactElement {
  return (
    <ScrollViewport
      as="ul"
      axis="vertical"
      containerClassName="mt-3 max-h-64"
      className="flex flex-col gap-1 overflow-y-auto"
    >
      {labels.map((label) => (
        <LabelListItem
          key={label.id}
          editing={editing}
          isAssigned={assignedLabelIds.has(label.id)}
          isSubmitting={isSubmitting}
          label={label}
          onToggle={onToggle}
          usage={labelUsage[label.id] ?? 0}
        />
      ))}
    </ScrollViewport>
  );
}

function LabelCreateSection({
  creation,
  isSubmitting,
}: LabelCreateSectionProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-4 border-t border-border pt-4">
      {creation.isCreating ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-foreground">
            {t("tasks.labels.createTitle")}
          </p>
          <LabelEditor
            name={creation.newName}
            color={creation.newColor}
            isSaving={isSubmitting}
            canSave={creation.newName.trim().length > 0}
            saveLabel={t("tasks.labels.create")}
            onNameChange={creation.setNewName}
            onColorChange={creation.setNewColor}
            onSave={creation.createLabel}
            onCancel={creation.closeForm}
          />
        </div>
      ) : (
        <Button
          className="w-full gap-1.5"
          onClick={creation.startCreating}
          type="button"
          variant="outline"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("tasks.labels.createTitle")}
        </Button>
      )}
    </div>
  );
}

/** Picks labels for a ticket and manages the global label catalog. */
export function LabelPicker({
  isOpen,
  onOpenChange,
  workItemId,
  labels,
  assignedLabelIds,
  labelUsage,
  isSubmitting = false,
}: LabelPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [query, setQuery] = useState("");
  const creation = useLabelCreation({
    assignedLabelIds,
    labels,
    workItemId,
  });
  const editing = useLabelEditing();
  const failure = useLabelFailure();

  const visibleLabels = filterLabels(labels, query);

  function handleOpenChange(open: boolean): void {
    creation.cancelPendingAssign();
    failure.dismiss();
    onOpenChange(open);
  }

  function handleToggle(label: Label): void {
    void submit(
      {
        intent: assignedLabelIds.has(label.id)
          ? "label-unassign"
          : "label-assign",
        labelId: label.id,
        workItemId,
      },
      { method: "post" },
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(28rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("tasks.labels.pickerTitle")}
        </DialogTitle>

        {failure.error ? (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {t(`tasks.error.${failure.error}`)}
          </p>
        ) : null}

        <LabelSearchField query={query} onQueryChange={setQuery} />

        <LabelList
          assignedLabelIds={assignedLabelIds}
          editing={editing}
          isSubmitting={isSubmitting}
          labelUsage={labelUsage}
          labels={visibleLabels}
          onToggle={handleToggle}
        />

        {visibleLabels.length === 0 ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {t("tasks.labels.noMatches")}
          </p>
        ) : null}

        <LabelCreateSection creation={creation} isSubmitting={isSubmitting} />
      </DialogContent>
    </Dialog>
  );
}
