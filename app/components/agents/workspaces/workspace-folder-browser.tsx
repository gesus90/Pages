import { ChevronRight, House } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import { Checkbox } from "@/app/components/ui/checkbox";
import {
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { VerticalScrollArea } from "@/app/components/ui/vertical-scroll-area";

import { WorkspaceFolderList } from "./workspace-folder-list";
import { WorkspaceFolderNotice } from "./workspace-folder-notice";

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
      <VerticalScrollArea
        isShell
        className="mt-3 h-72 max-h-[40dvh] rounded-xl border border-border bg-surface"
      >
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

const CRUMB_CLASS =
  "rounded-md px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary";

function WorkspaceFolderBreadcrumb(props: {
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

type FolderResponse =
  WorkspaceFolderListing | { readonly ok: false; readonly error: string };

interface FolderTarget {
  readonly path: string | null;
  readonly showHidden: boolean;
}

function useFolderBrowser(startPath: string | null): {
  readonly listing: WorkspaceFolderListing | null;
  readonly errorCode: string | null;
  readonly failedPath: string | null;
  readonly isLoading: boolean;
  readonly showHidden: boolean;
  readonly open: (path: string | null) => void;
  readonly reload: () => void;
  readonly setShowHidden: (showHidden: boolean) => void;
} {
  const fetcher = useFetcher<FolderResponse>();
  const { load } = fetcher;
  const [target, setTarget] = useState<FolderTarget>({
    path: startPath,
    showHidden: false,
  });
  const [lastListing, setLastListing] = useState<WorkspaceFolderListing | null>(
    null,
  );
  useEffect(() => {
    const query = new URLSearchParams();
    if (target.path !== null) query.set("path", target.path);
    if (target.showHidden) query.set("hidden", "1");
    void load(`/agent-api/workspace-folders?${query.toString()}`);
  }, [target, load]);
  const response = fetcher.data;
  const loaded = response && "folders" in response ? response : null;
  if (loaded !== null && loaded !== lastListing) setLastListing(loaded);
  const errorCode = response && "error" in response ? response.error : null;
  return {
    listing: loaded ?? lastListing,
    errorCode,
    failedPath: errorCode === null ? null : target.path,
    isLoading: fetcher.state !== "idle" || response === undefined,
    showHidden: target.showHidden,
    open: (path) => setTarget({ ...target, path }),
    reload: () => setTarget({ ...target }),
    setShowHidden: (showHidden) => setTarget({ ...target, showHidden }),
  };
}
