import { ChevronRight, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { WorkspaceFolderNotice } from "./workspace-folder-notice";

import type { WorkspaceFolderListing } from "@/definition/AgentWorkspace";

/** Names the failed request and offers the two ways on: try again, or begin again. */
function FolderFailure(props: {
  readonly message: string;
  readonly failedPath: string | null;
  readonly isLoading: boolean;
  readonly onOpen: (path: string | null) => void;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="space-y-3 p-4">
      <WorkspaceFolderNotice tone="error">
        {props.message}
      </WorkspaceFolderNotice>
      {props.failedPath === null ? null : (
        <p className="pages-selectable text-xs break-all text-muted-foreground">
          {props.failedPath}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={props.isLoading}
          onClick={props.onRetry}
        >
          {t("workspaces.retry")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.isLoading}
          onClick={() => props.onOpen(null)}
        >
          {t("workspaces.folders.toStart")}
        </Button>
      </div>
    </div>
  );
}

/** Shows the directories of the open level, or why there is nothing to list. */
export function WorkspaceFolderList(props: {
  readonly listing: WorkspaceFolderListing | null;
  readonly errorMessage: string | null;
  readonly failedPath: string | null;
  readonly isLoading: boolean;
  readonly onOpen: (path: string | null) => void;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const { listing } = props;
  if (props.errorMessage !== null)
    return (
      <FolderFailure
        message={props.errorMessage}
        failedPath={props.failedPath}
        isLoading={props.isLoading}
        onOpen={props.onOpen}
        onRetry={props.onRetry}
      />
    );
  if (listing === null)
    return (
      <div
        role="status"
        aria-label={t("workspaces.folders.loading")}
        className="flex flex-col gap-4 p-4"
      >
        {[1, 2, 3, 4].map((row) => (
          <div key={row} className="h-4 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  if (listing.folders.length === 0)
    return (
      <div className="p-4">
        <WorkspaceFolderNotice tone="neutral">
          {t("workspaces.folders.empty")}
        </WorkspaceFolderNotice>
      </div>
    );
  return (
    <ul
      className={cn(
        "divide-y divide-border/60",
        props.isLoading && "opacity-60",
      )}
      aria-busy={props.isLoading}
    >
      {listing.folders.map((folder) => (
        <li key={folder.path}>
          <button
            type="button"
            title={folder.path}
            disabled={props.isLoading}
            className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary xl:min-h-9"
            onClick={() => props.onOpen(folder.path)}
          >
            <Folder
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 break-all">{folder.name}</span>
            <ChevronRight
              className="size-4 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}
