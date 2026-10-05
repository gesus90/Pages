import { Archive } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

interface DetailArchiveFormProps {
  readonly workItemId: string;
  readonly isArchiving: boolean;
}

/** Renders the button that archives a ticket. */
export function DetailArchiveForm({
  workItemId,
  isArchiving,
}: DetailArchiveFormProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Form method="post">
      <input name="intent" type="hidden" value="archive-task" />
      <input name="id" type="hidden" value={workItemId} />
      <Button
        className="w-full gap-1.5 text-destructive hover:text-destructive"
        disabled={isArchiving}
        type="submit"
        variant="ghost"
      >
        <Archive className="size-4" aria-hidden="true" />
        {isArchiving
          ? t("tasks.actions.archiving")
          : t("tasks.actions.archive")}
      </Button>
    </Form>
  );
}
