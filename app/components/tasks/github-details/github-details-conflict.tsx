import { useTranslation } from "react-i18next";
import { Form } from "react-router";

import { Button } from "@/app/components/ui/button";

interface GitHubDetailsConflictProps {
  readonly taskId: string;
  readonly isSyncing: boolean;
}

/** Renders the choice between the Pages and the GitHub version of a conflicting ticket. */
export function GitHubDetailsConflict({
  taskId,
  isSyncing,
}: GitHubDetailsConflictProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
      <p className="font-medium text-destructive">
        {t("tasks.github.conflict")}
      </p>
      <div className="mt-2 flex gap-2">
        <Form method="post">
          <input name="intent" type="hidden" value="github-resolve-conflict" />
          <input name="id" type="hidden" value={taskId} />
          <input name="resolution" type="hidden" value="pages" />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isSyncing}
            type="submit"
          >
            {t("tasks.github.keepPages")}
          </Button>
        </Form>
        <Form method="post">
          <input name="intent" type="hidden" value="github-resolve-conflict" />
          <input name="id" type="hidden" value={taskId} />
          <input name="resolution" type="hidden" value="github" />
          <Button
            className="h-8 px-3 text-xs"
            disabled={isSyncing}
            type="submit"
            variant="ghost"
          >
            {t("tasks.github.useGitHub")}
          </Button>
        </Form>
      </div>
    </div>
  );
}
