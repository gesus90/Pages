import { Check, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { cn } from "@/app/lib/cn";

import type { WorkItemChecklistItem } from "@/definition/Task";

interface TaskChecklistProps {
  readonly workItemId: string;
  readonly items: readonly WorkItemChecklistItem[];
  readonly isArchived?: boolean;
  readonly isSubmitting?: boolean;
}

/** Renders the ticket's acceptance-criteria checklist with inline CRUD. */
export function TaskChecklist({
  workItemId,
  items,
  isArchived = false,
  isSubmitting = false,
}: TaskChecklistProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [newTitle, setNewTitle] = useState("");

  const doneCount = items.filter((item) => item.isDone).length;
  const progress =
    items.length > 0 ? Math.round((doneCount / items.length) * 100) : 0;

  function handleToggle(item: WorkItemChecklistItem): void {
    submit(
      {
        checklistItemId: item.id,
        intent: "checklist-toggle",
        isDone: item.isDone ? "false" : "true",
      },
      { method: "post" },
    );
  }

  function handleDelete(item: WorkItemChecklistItem): void {
    submit(
      { checklistItemId: item.id, intent: "checklist-delete" },
      { method: "post" },
    );
  }

  function handleAdd(): void {
    const title = newTitle.trim();

    if (!title) {
      return;
    }

    submit({ intent: "checklist-add", title, workItemId }, { method: "post" });
    setNewTitle("");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="shrink-0 font-medium text-foreground">
            {doneCount} / {items.length}
          </span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t("tasks.none")}</p>
      )}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="group flex items-center gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"
            >
              <button
                aria-pressed={item.isDone}
                className={cn(
                  "flex size-5 shrink-0 items-center justify-center rounded-md border border-muted-foreground/40 text-transparent transition-colors disabled:opacity-60",
                  item.isDone &&
                    "border-primary bg-primary text-primary-foreground",
                )}
                disabled={isArchived}
                onClick={() => handleToggle(item)}
                type="button"
              >
                <Check className="size-3.5" aria-hidden="true" />
              </button>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate",
                  item.isDone
                    ? "text-muted-foreground line-through"
                    : "text-foreground",
                )}
              >
                {item.title}
              </span>
              {!isArchived ? (
                <button
                  aria-label={t("tasks.checklist.remove")}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                  onClick={() => handleDelete(item)}
                  type="button"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!isArchived ? (
        <div className="flex gap-2">
          <Input
            aria-label={t("tasks.checklist.addPlaceholder")}
            className="h-9 xl:h-9"
            onChange={(event) => setNewTitle(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("tasks.checklist.addPlaceholder")}
            value={newTitle}
          />
          <Button
            className="h-9 shrink-0 gap-1.5 px-3 text-xs"
            disabled={isSubmitting || !newTitle.trim()}
            onClick={handleAdd}
            type="button"
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("tasks.checklist.add")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
