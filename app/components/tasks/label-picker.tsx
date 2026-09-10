import { Check, Pencil, Plus, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { LabelEditor } from "@/app/components/tasks/label-editor";
import { Button } from "@/app/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";
import { DEFAULT_LABEL_COLOR } from "@/definition/Task";

import type { ProjectLabel } from "@/definition/Task";

interface LabelPickerProps {
  readonly isOpen: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly workItemId: string;
  readonly projectId: string;
  readonly projectLabels: readonly ProjectLabel[];
  readonly assignedLabelIds: ReadonlySet<string>;
  readonly labelUsage: Readonly<Record<string, number>>;
  readonly isSubmitting?: boolean;
}

/** Picks project labels for a ticket and manages the project catalog. */
export function LabelPicker({
  isOpen,
  onOpenChange,
  workItemId,
  projectId,
  projectLabels,
  assignedLabelIds,
  labelUsage,
  isSubmitting = false,
}: LabelPickerProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [query, setQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<string>(DEFAULT_LABEL_COLOR);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState<string>(DEFAULT_LABEL_COLOR);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingAssignName, setPendingAssignName] = useState<string | null>(
    null,
  );
  const knownLabelIds = useRef<ReadonlySet<string>>(new Set());

  const normalizedQuery = query.trim().toLowerCase();
  const visibleLabels = normalizedQuery
    ? projectLabels.filter((label) =>
        label.name.toLowerCase().includes(normalizedQuery),
      )
    : projectLabels;

  // A freshly created label is selected for the current ticket once the
  // revalidated catalog contains it. Only ids unseen at creation time
  // qualify, so an unrelated label with the same name can never match.
  useEffect(() => {
    if (!pendingAssignName) {
      return;
    }

    const created = projectLabels.find(
      (label) =>
        label.name.toLowerCase() === pendingAssignName.toLowerCase() &&
        !knownLabelIds.current.has(label.id) &&
        !assignedLabelIds.has(label.id),
    );

    if (created) {
      setPendingAssignName(null);
      submit(
        { intent: "label-assign", labelId: created.id, workItemId },
        { method: "post" },
      );
    }
  }, [pendingAssignName, projectLabels, assignedLabelIds, submit, workItemId]);

  function handleOpenChange(open: boolean): void {
    setPendingAssignName(null);
    onOpenChange(open);
  }

  function handleToggle(label: ProjectLabel): void {
    submit(
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

  function handleCreate(): void {
    const name = newName.trim();
    const color = newColor;

    knownLabelIds.current = new Set(projectLabels.map((label) => label.id));
    submit(
      { color, intent: "label-create", name, projectId },
      { method: "post" },
    );
    setPendingAssignName(name);
    setNewName("");
    setNewColor(DEFAULT_LABEL_COLOR);
    setIsCreating(false);
  }

  function handleStartEdit(label: ProjectLabel): void {
    setEditingId(label.id);
    setEditName(label.name);
    setEditColor(label.color);
    setConfirmDeleteId(null);
  }

  function handleSaveEdit(label: ProjectLabel): void {
    const name = editName.trim();

    submit(
      { color: editColor, intent: "label-update", labelId: label.id, name },
      { method: "post" },
    );
    setEditingId(null);
  }

  function handleDelete(label: ProjectLabel): void {
    if (confirmDeleteId !== label.id) {
      setConfirmDeleteId(label.id);
      return;
    }

    submit({ intent: "label-delete", labelId: label.id }, { method: "post" });
    setConfirmDeleteId(null);
    setEditingId(null);
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] w-[min(28rem,94vw)] overflow-y-auto">
        <DialogTitle className="select-none text-lg font-semibold text-foreground">
          {t("tasks.labels.pickerTitle")}
        </DialogTitle>

        <div className="mt-4 flex h-11 items-center gap-2.5 rounded-xl bg-muted/60 pr-2 pl-3.5 outline-none transition-shadow focus-within:bg-muted/80 focus-within:ring-2 focus-within:ring-primary">
          <Search
            className="size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <input
            aria-label={t("tasks.labels.search")}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("tasks.labels.search")}
            value={query}
          />
          {query ? (
            <button
              aria-label={t("tasks.actions.clearSearch")}
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={() => setQuery("")}
              type="button"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <ul className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
          {visibleLabels.map((label) => {
            const isAssigned = assignedLabelIds.has(label.id);
            const usage = labelUsage[label.id] ?? 0;
            const isEditing = editingId === label.id;

            return (
              <li
                key={label.id}
                className={cn(
                  "group rounded-xl p-1.5 text-sm transition-colors",
                  isAssigned
                    ? "bg-primary/10 ring-1 ring-primary/40"
                    : "bg-muted/40 hover:bg-muted/70",
                )}
              >
                {isEditing ? (
                  <div className="flex flex-col gap-2 p-1">
                    <LabelEditor
                      name={editName}
                      color={editColor}
                      isSaving={isSubmitting}
                      canSave={editName.trim().length > 0}
                      saveLabel={t("tasks.labels.save")}
                      onNameChange={setEditName}
                      onColorChange={setEditColor}
                      onSave={() => handleSaveEdit(label)}
                      onCancel={() => {
                        setEditingId(null);
                        setConfirmDeleteId(null);
                      }}
                    />
                    {confirmDeleteId === label.id ? (
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
                            onClick={() => setConfirmDeleteId(null)}
                            type="button"
                            variant="ghost"
                          >
                            {t("tasks.actions.cancel")}
                          </Button>
                          <Button
                            className="h-8 px-3 text-xs"
                            disabled={isSubmitting}
                            onClick={() => handleDelete(label)}
                            type="button"
                          >
                            {t("tasks.labels.deleteSubmit")}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex justify-start">
                        <Button
                          className="h-8 gap-1.5 px-3 text-xs text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(label)}
                          type="button"
                          variant="ghost"
                        >
                          {t("tasks.labels.delete")}
                        </Button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1">
                    <button
                      aria-pressed={isAssigned}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
                      onClick={() => handleToggle(label)}
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
                        <Check
                          className="size-4 shrink-0 text-primary"
                          aria-hidden="true"
                        />
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
                      onClick={() => handleStartEdit(label)}
                      type="button"
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {visibleLabels.length === 0 ? (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            {t("tasks.labels.noMatches")}
          </p>
        ) : null}

        <div className="mt-4 border-t border-border pt-4">
          {isCreating ? (
            <div className="flex flex-col gap-2">
              <p className="text-sm font-semibold text-foreground">
                {t("tasks.labels.createTitle")}
              </p>
              <LabelEditor
                name={newName}
                color={newColor}
                isSaving={isSubmitting}
                canSave={newName.trim().length > 0}
                saveLabel={t("tasks.labels.create")}
                onNameChange={setNewName}
                onColorChange={setNewColor}
                onSave={handleCreate}
                onCancel={() => {
                  setIsCreating(false);
                  setNewName("");
                  setNewColor(DEFAULT_LABEL_COLOR);
                }}
              />
            </div>
          ) : (
            <Button
              className="w-full gap-1.5"
              onClick={() => setIsCreating(true)}
              type="button"
              variant="outline"
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("tasks.labels.createTitle")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
