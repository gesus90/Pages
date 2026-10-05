import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

interface GitHubDetailsErrorProps {
  readonly taskId: string;
  readonly message: string;
  readonly isSyncing: boolean;
}

/** Renders the last synchronization error of a ticket with a retry button. */
export function GitHubDetailsError({
  taskId,
  message,
  isSyncing,
}: GitHubDetailsErrorProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="font-medium text-destructive">
        {t("tasks.github.syncFailed")}
      </p>
      <p className="mt-1 break-words text-muted-foreground">{message}</p>
      <Form className="mt-2" method="post">
        <input name="intent" type="hidden" value="sync-github-task" />
        <input name="id" type="hidden" value={taskId} />
        <Button className="h-8 px-3 text-xs" disabled={isSyncing} type="submit">
          {t("tasks.github.retry")}
        </Button>
      </Form>
    </div>
  );
}
