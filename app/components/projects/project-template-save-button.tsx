import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { showSuccessToast } from "@/app/components/ui/toast";

import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";

/** Saves the source's single template snapshot and reports only this form's outcome. */
export function ProjectTemplateSaveButton(): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<ProjectDetailActionResult>();
  const previous = useRef(fetcher.data);
  useEffect(() => {
    if (fetcher.data === previous.current) return;
    previous.current = fetcher.data;
    if (fetcher.data?.ok) showSuccessToast(t("projects.templates.saved"));
  }, [fetcher.data, t]);
  return (
    <fetcher.Form method="post" className="mt-5 flex flex-col gap-2">
      <input type="hidden" name="intent" value="save-template" />
      <Button variant="link" type="submit" isPending={fetcher.state !== "idle"}>
        {t("projects.templates.save")}
      </Button>
      {fetcher.data && !fetcher.data.ok ? (
        <p role="alert" className="pages-selectable text-sm text-destructive">
          {t(`projects.error.${fetcher.data.error}`)}
        </p>
      ) : null}
    </fetcher.Form>
  );
}
