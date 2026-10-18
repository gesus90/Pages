import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { WorkspaceFolderBreadcrumb } from "./workspace-folder-breadcrumb";
import { WorkspaceFolderList } from "./workspace-folder-list";
import { WorkspaceFolderNotice } from "./workspace-folder-notice";
import { useFolderBrowser } from "./use-folder-browser";

import type { TFunction } from "i18next";
import type { WorkspaceFolderListing } from "@/definition/AgentWorkspace";

/** Stable error codes are translated here; the server never sends error text. */
function errorMessage(t: TFunction, code: string): string {
  return t(`agentExecution.error.${code}`, {
    defaultValue: t(`settings.agents.error.${code}`, {
      defaultValue: t("workspaces.folders.loadError"),
    }),
  });
}

function FolderSelection(props: {
  readonly listing: WorkspaceFolderListing | null;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const { listing } = props;
  if (listing === null) return null;
  return (
    <div className="mt-4 space-y-2 border-t border-border/60 pt-4">
      {listing.path === null ? (
        <WorkspaceFolderNotice tone="neutral">
          {t("workspaces.folders.rootsLevel")}
        </WorkspaceFolderNotice>
      ) : (
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {t("workspaces.folders.current")}
          </p>
          <p className="pages-selectable text-sm break-all">{listing.path}</p>
        </div>
      )}
      {listing.selectionIssue === null ? null : (
        <WorkspaceFolderNotice tone="warning">
          {t("workspaces.folders.unusable", {
            reason: errorMessage(t, listing.selectionIssue),
          })}
        </WorkspaceFolderNotice>
      )}
    </div>
  );
}

/**
 * Lets a person pick a directory of the server instead of typing its path.
 *
 * @remarks
 * Only the directories below the approved locations are listed; the server
 * decides and rechecks the person's right on every level.
 */
export function WorkspaceFolderBrowser(props: {
  readonly startPath: string;
  readonly onSelect: (path: string) => void;
  readonly onClose: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const browser = useFolderBrowser(props.startPath.trim() || null);
  const { listing } = browser;
  const hasFailed = browser.errorCode !== null;
  const chosenPath =
    !hasFailed && listing !== null && listing.selectionIssue === null
      ? listing.path
      : null;
  return (
    <DialogContent size="md" className="flex max-h-[90dvh] flex-col">
      <DialogTitle className="text-lg font-semibold">
        {t("workspaces.folders.title")}
      </DialogTitle>
      <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
        {t("workspaces.folders.description")}
      </DialogDescription>
      <WorkspaceFolderBreadcrumb listing={listing} onOpen={browser.open} />
      <VerticalScrollArea className="mt-3 h-72 max-h-[40dvh] rounded-xl border border-border bg-surface">
        <WorkspaceFolderList
          listing={listing}
          errorMessage={
            browser.errorCode === null
              ? null
              : errorMessage(t, browser.errorCode)
          }
          failedPath={browser.failedPath}
          isLoading={browser.isLoading}
          onOpen={browser.open}
          onRetry={browser.reload}
        />
      </VerticalScrollArea>
      {!hasFailed && listing?.isTruncated ? (
        <div className="mt-3">
          <WorkspaceFolderNotice tone="warning">
            {t("workspaces.folders.truncated", {
              count: listing.folders.length,
            })}
          </WorkspaceFolderNotice>
        </div>
      ) : null}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <Checkbox
          checked={browser.showHidden}
          onChange={(event) => browser.setShowHidden(event.target.checked)}
        />
        {t("workspaces.folders.showHidden")}
      </label>
      <FolderSelection listing={hasFailed ? null : listing} />
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("settings.agents.cancel")}
        </Button>
        <Button
          type="button"
          disabled={chosenPath === null || browser.isLoading}
          onClick={() => {
            if (chosenPath !== null) props.onSelect(chosenPath);
          }}
        >
          {t("workspaces.folders.use")}
        </Button>
      </div>
    </DialogContent>
  );
}
