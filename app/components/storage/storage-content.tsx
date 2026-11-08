import { FolderOpen, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";

import { StorageFileList } from "./storage-file-list";
import {
  StorageConnectionNotice,
  StorageFailureNotice,
  StorageFolderProblemNotice,
  StorageStartFolderProblemNotice,
} from "./storage-notices";

import type {
  StorageBrowseResult,
  StorageFolderView,
} from "@/definition/GoogleDriveStorage";

import type { StorageFolderModel } from "./use-storage-folder";

interface StorageContentProps {
  readonly model: StorageFolderModel;
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

  return (
    <footer className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-xs text-muted-foreground">
      <span aria-live="polite">
        {t(
          folder.nextPageToken
            ? "storage.list.countMore"
            : "storage.list.count",
          {
            count: folder.items.length,
          },
        )}
      </span>
      {model.loadMoreFailed ? (
        <span className="text-destructive" role="alert">
          {t("storage.list.loadMoreFailed")}
        </span>
      ) : null}
      {folder.nextPageToken ? (
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

function FolderBody({
  result,
  folder,
  model,
}: {
  readonly result: StorageBrowseResult;
  readonly folder: StorageFolderView;
  readonly model: StorageFolderModel;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {folder.items.length === 0 ? (
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
        ) : (
          <StorageFileList items={folder.items} />
        )}
      </div>
      <FolderFooter folder={folder} model={model} />
    </>
  );
}

function LoadedContent({
  result,
  model,
  onChooseStartFolder,
  onClearStartFolder,
}: StorageContentProps & {
  readonly result: StorageBrowseResult;
}): React.ReactElement {
  if (result.folder) {
    return <FolderBody folder={result.folder} model={model} result={result} />;
  }

  return (
    <div className="p-4">
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
  );
}

/**
 * The file card of the Storage area with its loading, empty and error states.
 *
 * @remarks
 * Only the list scrolls; the card keeps its footer visible and its bottom
 * edge above the free space of the Pica launcher.
 */
export function StorageContent(props: StorageContentProps): React.ReactElement {
  const { t } = useTranslation();
  const { reading, reload } = props.model;

  return (
    <div className="pages-content-card flex min-h-48 min-w-0 flex-1 flex-col overflow-hidden p-0">
      {reading.kind === "loading" ? (
        <CenteredMessage>
          <Loader2 aria-hidden="true" className="size-6 animate-spin" />
          <p role="status">{t("storage.loading")}</p>
        </CenteredMessage>
      ) : null}
      {reading.kind === "failed" ? (
        <div className="p-4">
          <StorageFailureNotice failure={reading.failure} onRetry={reload} />
        </div>
      ) : null}
      {reading.kind === "connection" ? (
        <div className="p-4">
          <StorageConnectionNotice
            connection={reading.connection}
            onRetry={reload}
          />
        </div>
      ) : null}
      {reading.kind === "loaded" ? (
        <LoadedContent {...props} result={reading.result} />
      ) : null}
    </div>
  );
}
