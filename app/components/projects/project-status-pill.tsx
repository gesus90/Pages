import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useActionData, useSubmit } from "react-router";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";
import { PROJECT_STATUS } from "@/definition/Project";

import type { ProjectDetailActionResult } from "@/app/lib/project-actions/project-action-support.server";
import type { ProjectStatus } from "@/definition/Project";

/** Dot colors for the project statuses selectable in the header. */
const PROJECT_STATUS_DOT: Record<ProjectStatus, string> = {
  planned: "bg-emerald-500",
  active: "bg-blue-500",
  paused: "bg-amber-500",
  completed: "bg-emerald-700",
};

interface ProjectStatusPillProps {
  readonly status: ProjectStatus;
  readonly canWrite: boolean;
}

/** Renders the project status as a pill that writers can change inline. */
export function ProjectStatusPill({
  status,
  canWrite,
}: ProjectStatusPillProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const actionData = useActionData<ProjectDetailActionResult>();
  const [lastSubmittedStatus, setLastSubmittedStatus] =
    useState<ProjectStatus | null>(null);

  useEffect(() => {
    if (actionData?.ok) {
      setLastSubmittedStatus(null);
    }
  }, [actionData]);

  function handleSelect(nextStatus: ProjectStatus): void {
    setLastSubmittedStatus(nextStatus);

    const formData = new FormData();
    formData.set("intent", "update-status");
    formData.set("status", nextStatus);
    void submit(formData, { method: "post" });
  }

  const showError =
    lastSubmittedStatus !== null && actionData !== undefined && !actionData.ok;

  if (!canWrite) {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-foreground">
        <span
          className={`size-2 shrink-0 rounded-full ${PROJECT_STATUS_DOT[status]}`}
          aria-hidden="true"
        />
        {t(`projects.status.${status}`)}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="inline-flex cursor-pointer items-center gap-2 rounded-full bg-muted/60 px-3 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            type="button"
            aria-label={t("projectDetail.changeStatus")}
          >
            <span
              className={`size-2 shrink-0 rounded-full ${PROJECT_STATUS_DOT[status]}`}
              aria-hidden="true"
            />
            {t(`projects.status.${status}`)}
            <ChevronDown
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          {Object.values(PROJECT_STATUS).map((option) => (
            <DropdownMenuItem
              key={option}
              onSelect={() => handleSelect(option)}
            >
              <span
                className={`mr-2 size-2 shrink-0 rounded-full ${PROJECT_STATUS_DOT[option]}`}
                aria-hidden="true"
              />
              {t(`projects.status.${option}`)}
              {option === status ? (
                <Check
                  className="ml-auto size-4 shrink-0 text-primary"
                  aria-hidden="true"
                />
              ) : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {showError ? (
        <span className="text-xs text-destructive" role="alert">
          {t("projectDetail.statusError")}
        </span>
      ) : null}
    </span>
  );
}
