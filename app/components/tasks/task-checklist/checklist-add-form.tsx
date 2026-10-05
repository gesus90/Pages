import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

interface ChecklistAddFormProps {
  readonly title: string;
  readonly isSubmitting: boolean;
  readonly onTitleChange: (title: string) => void;
  readonly onAdd: () => void;
}

/** Renders the input and button that add an item to the checklist. */
export function ChecklistAddForm({
  title,
  isSubmitting,
  onTitleChange,
  onAdd,
}: ChecklistAddFormProps): React.ReactElement {
  const { t } = useTranslation();

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();
      onAdd();
    }
  }

  return (
    <div className="flex gap-2">
      <Input
        aria-label={t("tasks.checklist.addPlaceholder")}
        className="h-9 xl:h-9"
        onChange={(event) => onTitleChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("tasks.checklist.addPlaceholder")}
        value={title}
      />
      <Button
        className="h-9 shrink-0 gap-1.5 px-3 text-xs"
        disabled={isSubmitting || !title.trim()}
        onClick={onAdd}
        type="button"
      >
        <Plus className="size-4" aria-hidden="true" />
        {t("tasks.checklist.add")}
      </Button>
    </div>
  );
}
