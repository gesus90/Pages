import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { showSuccessToast, showToast } from "@/app/components/ui/toast";

import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";

/** Saves the source's single template snapshot and reports only this form's outcome. */
export function ProjectTemplateSaveButton(): React.ReactElement {
  const { t } = useTranslation();
  const fetcher = useFetcher<ProjectDetailActionResult>();
  const result = fetcher.data;
  const { submit } = fetcher;
  const previous = useRef(result);
  useEffect(() => {
    if (result === previous.current) return;
    previous.current = result;
    if (result?.ok) showSuccessToast(t("projects.templates.saved"));
    else if (result)
      showToast({
        type: "error",
        message: t("toast.saveFailed"),
        description: t(`projects.error.${result.error}`),
        action: {
          label: t("toast.retry"),
          onClick: () => {
            const formData = new FormData();
            formData.set("intent", "save-template");
            void submit(formData, { method: "post" });
          },
        },
      });
  }, [result, submit, t]);
  return (
    <fetcher.Form method="post" className="mt-5 flex flex-col gap-2">
      <input type="hidden" name="intent" value="save-template" />
      <Button variant="link" type="submit" isPending={fetcher.state !== "idle"}>
        {t("projects.templates.save")}
      </Button>
    </fetcher.Form>
  );
}
