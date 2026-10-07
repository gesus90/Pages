import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

import { TemplateManagerDialog } from "@/app/components/tasks/templates/template-manager-dialog";
import { Button } from "@/app/components/ui/button";

import type { WorkItemTemplateView } from "@/definition/WorkItemTemplate";

interface ToolbarTitleProps {
  readonly onCreate: () => void;
  readonly templates: readonly WorkItemTemplateView[];
}

/** Renders the page title with the buttons that manage templates and create a ticket. */
export function ToolbarTitle({
  onCreate,
  templates,
}: ToolbarTitleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="select-none text-3xl font-semibold tracking-tight text-foreground xl:text-2xl">
          {t("tasks.title")}
        </h1>
        <p className="mt-1.5 select-none text-sm text-muted-foreground max-md:hidden">
          {t("tasks.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <TemplateManagerDialog templates={templates} />
        <Button className="gap-2" onClick={onCreate} type="button">
          <Plus className="size-4" aria-hidden="true" />
          {t("tasks.create.trigger")}
        </Button>
      </div>
    </div>
  );
}
