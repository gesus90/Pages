import { CircleAlert } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";
import { InlineEditTrigger } from "@/app/components/ui/inline-edit-trigger";
import { Textarea } from "@/app/components/ui/textarea";
import { focusOnMount } from "@/app/lib/focus-on-mount";
import { formatCounter } from "@/app/lib/project-format";
import { MAXIMUM_PROJECT_DESCRIPTION_LENGTH } from "@/definition/Project";

import type { ChangeEvent, KeyboardEvent } from "react";

interface DescriptionFormProps {
  readonly savedDescription: string;
  readonly draft: string;
  readonly onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  readonly onCancel: () => void;
  readonly onSubmit: () => void;
}

/** Renders the description editor with a character counter and save button. */
function DescriptionForm({
  savedDescription,
  draft,
  onChange,
  onKeyDown,
  onCancel,
  onSubmit,
}: DescriptionFormProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Form method="post" className="mt-2" onSubmit={onSubmit}>
      <input name="intent" type="hidden" value="update-description" />
      <Textarea
        className="min-h-48 resize-y px-5 py-5 text-sm leading-relaxed"
        name="description"
        value={draft}
        maxLength={MAXIMUM_PROJECT_DESCRIPTION_LENGTH}
        onChange={onChange}
        onKeyDown={onKeyDown}
        ref={focusOnMount}
        aria-label={t("projectDetail.general.description")}
      />
      <div className="mt-2 flex items-center justify-end gap-2">
        <span className="mr-auto text-xs text-muted-foreground">
          {t("projectDetail.general.descriptionCounter", {
            count: formatCounter(draft.length),
          })}
        </span>
        <Button variant="ghost" type="button" onClick={onCancel}>
          {t("projects.actions.cancel")}
        </Button>
        {draft !== savedDescription ? (
          <Button type="submit">{t("projects.edit.submit")}</Button>
        ) : null}
      </div>
    </Form>
  );
}

interface GeneralDescriptionSectionProps {
  readonly description: string;
  readonly tags: readonly string[];
  readonly canWrite: boolean;
}

/** Renders the project description with inline editing and the project tags. */
export function GeneralDescriptionSection({
  description,
  tags,
  canWrite,
}: GeneralDescriptionSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(description);
  const shownDescription = description || t("projects.noDescription");

  function handleStartEdit(): void {
    setDraft(description);
    setIsEditing(true);
  }

  function handleStopEdit(): void {
    setIsEditing(false);
  }

  function handleDraftChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    setDraft(event.currentTarget.value);
  }

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Escape") {
      handleStopEdit();
    }
  }

  return (
    <section className="rounded-2xl bg-muted/40 p-6">
      <h2 className="flex select-none items-center gap-2 font-semibold text-foreground">
        <CircleAlert className="size-5 text-primary" aria-hidden="true" />
        {t("projectDetail.general.overview")}
      </h2>
      <p className="mt-4 text-sm font-medium text-foreground">
        {t("projectDetail.general.description")}
      </p>
      {isEditing ? (
        <DescriptionForm
          draft={draft}
          onCancel={handleStopEdit}
          onChange={handleDraftChange}
          onKeyDown={handleDraftKeyDown}
          onSubmit={handleStopEdit}
          savedDescription={description}
        />
      ) : (
        <div className="mt-2 min-h-40 rounded-xl bg-surface px-5 py-5 shadow-xs">
          {canWrite ? (
            <InlineEditTrigger
              className="block w-full cursor-text select-text whitespace-pre-wrap text-left text-sm leading-relaxed text-muted-foreground outline-none"
              onStartEdit={handleStartEdit}
            >
              {shownDescription}
            </InlineEditTrigger>
          ) : (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground outline-none">
              {shownDescription}
            </p>
          )}
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
  );
}
