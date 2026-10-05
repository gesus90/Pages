import { Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { InlineEditTrigger } from "@/app/components/ui/inline-edit-trigger";
import { Input } from "@/app/components/ui/input";
import { focusOnMount } from "@/app/lib/focus-on-mount";

import type { ChangeEvent, KeyboardEvent } from "react";

interface ProjectNameHeadingProps {
  readonly name: string;
  readonly canWrite: boolean;
}

/**
 * Renders the project title with hover and double-click inline editing.
 *
 * @remarks
 * Editing is only offered to writers (administrators, managers, and project
 * managers); everyone else sees plain text. Saving reuses the existing
 * `update-name` action, so the server-side permission check still applies.
 */
export function ProjectNameHeading({
  name,
  canWrite,
}: ProjectNameHeadingProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  function handleStartEdit(): void {
    setDraft(name);
    setIsEditing(true);
  }

  function handleCancel(): void {
    setIsEditing(false);
  }

  function handleSave(): void {
    if (draft === name || draft.trim() === "") {
      return;
    }

    const formData = new FormData();
    formData.set("intent", "update-name");
    formData.set("name", draft);
    void submit(formData, { method: "post" });
    setIsEditing(false);
  }

  function handleDraftChange(event: ChangeEvent<HTMLInputElement>): void {
    setDraft(event.currentTarget.value);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      handleSave();
    } else if (event.key === "Escape") {
      handleCancel();
    }
  }

  if (!canWrite) {
    return <span className="select-none">Projekt: {name}</span>;
  }

  if (isEditing) {
    return (
      <span className="inline-flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <span className="select-none">Projekt:</span>
        <Input
          className="h-10 min-w-36 max-w-sm flex-1 text-xl font-semibold"
          name="name"
          value={draft}
          maxLength={200}
          ref={focusOnMount}
          onChange={handleDraftChange}
          onKeyDown={handleInputKeyDown}
          aria-label={t("projectDetail.editName")}
        />
        {draft !== name && draft.trim() !== "" ? (
          <Button
            className="h-8 shrink-0 px-3 text-xs"
            type="button"
            onClick={handleSave}
          >
            {t("projects.edit.submit")}
          </Button>
        ) : null}
        <Button
          className="h-8 shrink-0 px-3 text-xs"
          variant="ghost"
          type="button"
          onClick={handleCancel}
        >
          {t("projects.actions.cancel")}
        </Button>
      </span>
    );
  }

  return (
    <span className="group inline-flex select-none items-center gap-2">
      <InlineEditTrigger
        className="cursor-text text-left outline-none"
        onStartEdit={handleStartEdit}
      >
        Projekt: {name}
      </InlineEditTrigger>
      <button
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground opacity-0 transition-opacity outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
        type="button"
        aria-label={t("projectDetail.editName")}
        onClick={handleStartEdit}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}
