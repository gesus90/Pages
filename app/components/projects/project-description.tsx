import { Pencil } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Button } from "@/app/components/ui/button";
import { InlineEditTrigger } from "@/app/components/ui/inline-edit-trigger";
import { Textarea } from "@/app/components/ui/textarea";
import { focusOnMount } from "@/app/lib/focus-on-mount";
import { MAXIMUM_PROJECT_DESCRIPTION_LENGTH } from "@/definition/Project";

import type { ChangeEvent, KeyboardEvent } from "react";

interface DescriptionEditorProps {
  readonly draft: string;
  readonly onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onCancel: () => void;
  readonly onSave: () => void;
}

/** Renders the text area and the save and cancel buttons of the editor. */
function DescriptionEditor({
  draft,
  onChange,
  onKeyDown,
  onCancel,
  onSave,
}: DescriptionEditorProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-1 max-w-3xl">
      <Textarea
        className="min-h-20 resize-y text-sm leading-relaxed"
        name="description"
        value={draft}
        maxLength={MAXIMUM_PROJECT_DESCRIPTION_LENGTH}
        ref={focusOnMount}
        onChange={onChange}
        onKeyDown={onKeyDown}
        aria-label={t("projectDetail.general.description")}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <Button
          className="h-8 shrink-0 px-3 text-xs"
          variant="ghost"
          type="button"
          onClick={onCancel}
        >
          {t("projects.actions.cancel")}
        </Button>
        <Button
          className="h-8 shrink-0 px-3 text-xs"
          type="button"
          onClick={onSave}
        >
          {t("projects.edit.submit")}
        </Button>
      </div>
    </div>
  );
}

interface ProjectDescriptionProps {
  readonly description: string;
  readonly canWrite: boolean;
}

/**
 * Renders the header description with double-click inline editing.
 *
 * @remarks
 * Editing is only offered to writers (administrators, managers, and project
 * managers); everyone else sees plain text. Saving reuses the existing
 * `update-description` action, so the server-side permission check still applies.
 */
export function ProjectDescription({
  description,
  canWrite,
}: ProjectDescriptionProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(description);

  function handleStartEdit(): void {
    setDraft(description);
    setIsEditing(true);
  }

  function handleCancel(): void {
    setIsEditing(false);
  }

  function handleSave(): void {
    if (draft === description) {
      setIsEditing(false);
      return;
    }

    if (draft.length > MAXIMUM_PROJECT_DESCRIPTION_LENGTH) {
      return;
    }

    const formData = new FormData();
    formData.set("intent", "update-description");
    formData.set("description", draft);
    void submit(formData, { method: "post" });
    setIsEditing(false);
  }

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(event.currentTarget.value);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      handleCancel();
    }
  }

  if (!canWrite) {
    return (
      <p className="mt-1 line-clamp-2 max-w-3xl text-sm text-muted-foreground">
        {description || t("projects.noDescription")}
      </p>
    );
  }

  if (isEditing) {
    return (
      <DescriptionEditor
        draft={draft}
        onChange={handleDraftChange}
        onKeyDown={handleInputKeyDown}
        onCancel={handleCancel}
        onSave={handleSave}
      />
    );
  }

  return (
    <span className="group mt-1 flex max-w-3xl items-start gap-2">
      <InlineEditTrigger
        className="line-clamp-2 cursor-text text-left text-sm text-muted-foreground outline-none"
        onStartEdit={handleStartEdit}
      >
        {description || t("projects.noDescription")}
      </InlineEditTrigger>
      <button
        className="inline-flex shrink-0 items-center justify-center rounded-md p-1 text-muted-foreground opacity-0 transition-opacity outline-none hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-primary group-hover:opacity-100"
        type="button"
        aria-label={t("projectDetail.general.description")}
        onClick={handleStartEdit}
      >
        <Pencil className="size-4" aria-hidden="true" />
      </button>
    </span>
  );
}
