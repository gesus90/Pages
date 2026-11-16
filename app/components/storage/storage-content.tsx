import { FolderOpen, Loader2 } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { StorageFileList } from "./storage-file-list";
import { StorageLoadingBar } from "./storage-loading-bar";
import {
  StorageConnectionNotice,
  StorageFailureNotice,
  StorageFolderProblemNotice,
  StorageStartFolderProblemNotice,
} from "./storage-notices";
import { useHasWaited } from "./use-has-waited";

import type {
  StorageBrowseResult,
  StorageFolderView,
  StorageItem,
} from "@/definition/GoogleDriveStorage";
import type { ReactNode } from "react";

import type { StorageMenuPoint } from "./storage-context-menu";
import type { StorageFolderModel } from "./use-storage-folder";
import type { StorageSelection } from "./use-storage-selection";

/** The file management around the list of a loaded folder. */
export interface StorageListTools {
  /** The menu bar above the list; it stays visible while the list scrolls. */
  readonly menuBar: ReactNode;
  readonly selection: StorageSelection;
  /** Opens the own context menu instead of the browser's. */
  readonly onOpenMenu: (point: StorageMenuPoint) => void;
}

/** How long a folder may take to answer before the card shows its progress bar. */
const PROGRESS_DELAY_MS = 150;

interface StorageContentProps {
  readonly model: StorageFolderModel;
  /** The folder the address asks for while it loads; its row shows the progress. */
  readonly openingFolderId: string | null;
  /** The menu of one entry of the shown folder, when entries have one. */
  readonly renderActions?: (item: StorageItem) => ReactNode;
  readonly tools?: StorageListTools;
  readonly onChooseStartFolder: () => void;
  readonly onClearStartFolder: () => void;
}

function CenteredMessage({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="flex min-h-48 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function FolderFooter({
  folder,
  model,
}: {
  readonly folder: StorageFolderView;
  readonly model: StorageFolderModel;
}): React.ReactElement {
  const { t } = useTranslation();
  const isLoaded = model.reading.kind === "loaded";
  const isFailed = model.reading.kind === "failed";
  const countKey = folder.nextPageToken
    ? "storage.list.countMore"
    : "storage.list.count";

  // The footer stands where it is; it counts the shown folder, so it says
  // nothing while a failed one has no rows, and offers nothing while another
  // folder is asked.
  return (
    <footer
      className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground"
      inert={!isLoaded}
    >
      <span aria-live="polite">
        {isFailed ? null : t(countKey, { count: folder.items.length })}
      </span>
      {model.loadMoreFailed && !isFailed ? (
        <span className="text-destructive" role="alert">
          {t("storage.list.loadMoreFailed")}
        </span>
      ) : null}
      {folder.nextPageToken && !isFailed ? (
        <Button
          isPending={model.isLoadingMore}
          onClick={model.loadMore}
          size="xs"
          type="button"
          variant="outline"
        >
          {t("storage.list.loadMore")}
        </Button>
      ) : null}
    </footer>
  );
}

/** The card without a folder to show: the first load or a failure. */
function ReadingNotice({
  model,
}: {
  readonly model: StorageFolderModel;
}): React.ReactElement {
  const { t } = useTranslation();
  const { reading, reload } = model;

  if (reading.kind === "failed") {
    return (
      <div className="p-4">
        <StorageFailureNotice failure={reading.failure} onRetry={reload} />
      </div>
    );
  }

  if (reading.kind === "connection") {
    return (
      <div className="p-4">
        <StorageConnectionNotice
          connection={reading.connection}
          onRetry={reload}
        />
      </div>
    );
  }

  return (
    <CenteredMessage>
      <Loader2 aria-hidden="true" className="size-6 animate-spin" />
      <p role="status">{t("storage.loading")}</p>
    </CenteredMessage>
  );
}

/** Scrolls the list to the top when another folder shows, and not on a reload of the same one. */
function useScrollToTopOnFolder(
  folderId: string,
): React.RefObject<HTMLDivElement | null> {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const shownFolderRef = useRef(folderId);

  useLayoutEffect(() => {
    if (shownFolderRef.current === folderId) return;

    shownFolderRef.current = folderId;

    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [folderId]);

  return scrollerRef;
}

function FolderBody({
  result,
  folder,
  model,
  openingFolderId,
  isWaiting,
  renderActions,
  tools,
}: {
  readonly result: StorageBrowseResult;
  readonly folder: StorageFolderView;
  readonly model: StorageFolderModel;
  readonly openingFolderId: string | null;
  readonly isWaiting: boolean;
  readonly renderActions?: (item: StorageItem) => ReactNode;
  readonly tools?: StorageListTools;
}): React.ReactElement {
  const { t } = useTranslation();
  const scrollerRef = useScrollToTopOnFolder(folder.folderId);
  const isFailed = model.reading.kind === "failed";
  // Menu bar and rows are the former folder's until the asked one is shown:
  // they stay in place and in full color, but nothing of them can be used.
  const isFormer = model.reading.kind !== "loaded";

  function handleContextMenu(event: React.MouseEvent<HTMLDivElement>): void {
    if (!tools || isFormer) return;

    // A right click beside the rows opens the menu without a selection change.
    event.preventDefault();
    tools.onOpenMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <>
      <div className="contents" inert={isFormer}>
        {tools?.menuBar}
      </div>
      {isWaiting ? <StorageLoadingBar /> : null}
      {/* The scroller and the column heads stay for every folder; another
          folder starts at the top, a reload keeps the place. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onContextMenu={handleContextMenu}
        ref={scrollerRef}
      >
        <div className="contents" inert={isFormer}>
          <StorageFileList
            folderId={folder.folderId}
            items={isFailed ? [] : folder.items}
            onOpenMenu={tools?.onOpenMenu}
            openingFolderId={openingFolderId}
            renderActions={renderActions}
            selection={tools?.selection}
          />
        </div>
        {isFailed ? <ReadingNotice model={model} /> : null}
        {!isFailed && folder.items.length === 0 ? (
          <CenteredMessage>
            <FolderOpen aria-hidden="true" className="size-8" />
            <p>
              {t(
                result.reach === "full"
                  ? "storage.list.empty"
                  : "storage.list.emptyAppFiles",
              )}
            </p>
          </CenteredMessage>
        ) : null}
      </div>
      <FolderFooter folder={folder} model={model} />
    </>
  );
}

function LoadedContent({
  result,
  model,
  isWaiting,
  openingFolderId,
  onChooseStartFolder,
  onClearStartFolder,
  renderActions,
  tools,
}: StorageContentProps & {
  readonly result: StorageBrowseResult;
  readonly isWaiting: boolean;
}): React.ReactElement {
  if (result.folder) {
    return (
      <FolderBody
        folder={result.folder}
        isWaiting={isWaiting}
        model={model}
        openingFolderId={openingFolderId}
        renderActions={renderActions}
        result={result}
        tools={tools}
      />
    );
  }

  return (
    <>
      {isWaiting ? <StorageLoadingBar /> : null}
      <div className="p-4" inert={model.reading.kind !== "loaded"}>
        {result.startFolderProblem ? (
          <StorageStartFolderProblemNotice
            onChoose={onChooseStartFolder}
            onClear={onClearStartFolder}
            problem={result.startFolderProblem}
            startFolderName={result.startFolder?.name ?? null}
          />
        ) : null}
        {result.folderProblem ? (
          <StorageFolderProblemNotice problem={result.folderProblem} />
        ) : null}
      </div>
    </>
  );
}

/**
 * The file card of the Storage area with its loading, empty and error states.
 * @remarks
 * Only the list scrolls; the card keeps its menu bar, column heads and
 * footer visible and its bottom edge above the free space of the Pica
 * launcher. Loading and failures stay inside the card. While another folder
 * loads, the former one stays in place in full color without being operable;
 * a bar under the menu bar shows the wait only when it lasts longer than
 * 150 ms. A failure replaces only the rows.
 */
export function StorageContent(props: StorageContentProps): React.ReactElement {
  const { reading, previousResult } = props.model;
  const result = reading.kind === "loaded" ? reading.result : previousResult;
  const isWaiting = useHasWaited(
    reading.kind === "loading" && result !== null,
    PROGRESS_DELAY_MS,
  );

  return (
    <div
      aria-busy={reading.kind === "loading"}
      className="pages-content-card relative flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden p-0"
    >
      {result ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <LoadedContent {...props} isWaiting={isWaiting} result={result} />
        </div>
      ) : (
        <ReadingNotice model={props.model} />
      )}
    </div>
  );
}
