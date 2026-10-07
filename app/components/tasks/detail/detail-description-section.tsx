import { Edit3 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { MarkdownText } from "@/app/components/markdown/markdown-text";
import { DetailSection } from "@/app/components/tasks/detail-section";
import { Button } from "@/app/components/ui/button";
import { Textarea } from "@/app/components/ui/textarea";
import { focusOnMount } from "@/app/lib/focus-on-mount";

interface DetailDescriptionSectionProps {
  readonly description: string;
  readonly isArchived: boolean;
  readonly onSave: (description: string) => void;
}

/** The read-only description, or a hint that there is none. */
function DescriptionText({
  description,
}: {
  readonly description: string;
}): React.ReactElement {
  const { t } = useTranslation();

  if (!description) {
    return (
      <p className="text-sm italic text-muted-foreground/70">
        {t("tasks.none")}
      </p>
    );
  }

  return (
    <MarkdownText className="text-muted-foreground" source={description} />
  );
}

/** Renders the ticket description with inline editing. */
export function DetailDescriptionSection({
  description,
  isArchived,
  onSave,
}: DetailDescriptionSectionProps): React.ReactElement {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(description);

  function handleStartEdit(): void {
    setDraft(description);
    setIsEditing(true);
  }

  function handleCancel(): void {
    setIsEditing(false);
    setDraft(description);
  }

  function handleSave(): void {
    onSave(draft);
    setIsEditing(false);
  }

  return (
    <DetailSection
      title={t("tasks.tabs.description")}
      trailing={
        !isEditing && !isArchived ? (
          <button
            aria-label={t("tasks.detail.editDescription")}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors hover:text-foreground"
            onClick={(event) => {
              event.stopPropagation();
              handleStartEdit();
            }}
            type="button"
          >
            <Edit3 className="size-3.5" aria-hidden="true" />
          </button>
        ) : undefined
      }
    >
      {isEditing ? (
        <div className="flex flex-col gap-2">
          <Textarea
            ref={focusOnMount}
            className="min-h-40 text-sm"
            onChange={(event) => setDraft(event.target.value)}
            value={draft}
          />
          <div className="flex justify-end gap-2">
            <Button
              className="h-8 px-3 text-xs"
              onClick={handleCancel}
              type="button"
              variant="ghost"
            >
              {t("tasks.actions.cancel")}
            </Button>
            <Button
              className="h-8 px-3 text-xs"
              onClick={handleSave}
              type="button"
            >
              {t("tasks.actions.save")}
            </Button>
          </div>
        </div>
      ) : (
        <DescriptionText description={description} />
      )}
    </DetailSection>
  );
}
