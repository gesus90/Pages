import { ChevronRight, House } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { WorkspaceFolderListing } from "@/definition/AgentWorkspace";

const CRUMB_CLASS =
  "rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary";

/** The way from the approved location to the open folder; every step above it is a link. */
export function WorkspaceFolderBreadcrumb(props: {
  readonly listing: WorkspaceFolderListing | null;
  readonly onOpen: (path: string | null) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { listing } = props;
  const steps = listing?.breadcrumbs ?? [];
  const isRootLevel = listing !== null && listing.path === null;
  return (
    <nav aria-label={t("workspaces.folders.breadcrumb")} className="mt-4">
      <ol className="flex flex-wrap items-center gap-0.5 text-sm">
        {listing?.hasSeveralRoots ? (
          <li className="flex items-center gap-0.5">
            {isRootLevel ? (
              <span aria-current="page" className="px-1.5 py-1 font-semibold">
                {t("workspaces.folders.roots")}
              </span>
            ) : (
              <button
                type="button"
                className={`${CRUMB_CLASS} flex items-center gap-1.5`}
                onClick={() => props.onOpen(null)}
              >
                <House className="size-4" aria-hidden="true" />
                {t("workspaces.folders.roots")}
              </button>
            )}
          </li>
        ) : null}
        {steps.map((step, index) => {
          const isCurrent = index === steps.length - 1;
          const hasLead = index > 0 || listing?.hasSeveralRoots === true;
          return (
            <li key={step.path} className="flex items-center gap-0.5">
              {hasLead ? (
                <ChevronRight
                  className="size-4 text-muted-foreground"
                  aria-hidden="true"
                />
              ) : null}
              {isCurrent ? (
                <span
                  aria-current="page"
                  className="pages-selectable px-1.5 py-1 font-semibold break-all"
                >
                  {step.name}
                </span>
              ) : (
                <button
                  type="button"
                  className={`${CRUMB_CLASS} break-all`}
                  onClick={() => props.onOpen(step.path)}
                >
                  {step.name}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
