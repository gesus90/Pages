import { ChevronRight, Folder, HardDrive, Users } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import {
  STORAGE_MY_DRIVE_ID,
  STORAGE_SHARED_DRIVES_ID,
} from "@/definition/GoogleDriveStorage";

import { pathEntryLabel, pathText } from "./storage-format";
import { requestStartFolderChange } from "./storage-requests";
import { useStorageFolder } from "./use-storage-folder";

import type {
  StorageFolderView,
  StorageStartFolder,
} from "@/definition/GoogleDriveStorage";

import type { StorageFolderReading } from "./use-storage-folder";

interface StorageStartFolderPickerProps {
  readonly isOpen: boolean;
  readonly initialFolderId: string;
  readonly startFolder: StorageStartFolder | null;
  readonly onOpenChange: (isOpen: boolean) => void;
  readonly onSaved: (startFolder: StorageStartFolder | null) => void;
}

interface PickerBodyProps {
  readonly initialFolderId: string;
  readonly startFolder: StorageStartFolder | null;
  readonly onSaved: (startFolder: StorageStartFolder | null) => void;
}

const ROW_CLASS =
  "flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-foreground hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary";

function PickerPath({
  folder,
  onOpen,
}: {
  readonly folder: StorageFolderView;
  readonly onOpen: (folderId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <ol className="flex min-w-0 flex-wrap items-center gap-1 text-xs text-muted-foreground">
      {folder.path.map((entry, index) => (
        <li
          className="flex min-w-0 items-center gap-1"
          key={`${entry.id}:${index}`}
        >
          {index > 0 ? (
            <ChevronRight aria-hidden="true" className="size-3" />
          ) : null}
          {entry.role === "detached" || index === folder.path.length - 1 ? (
            <span className="truncate">{pathEntryLabel(entry, t)}</span>
          ) : (
            <button
              className="truncate rounded-sm hover:text-foreground hover:underline"
              onClick={() => onOpen(entry.id)}
              type="button"
            >
              {pathEntryLabel(entry, t)}
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

function PickerRoots({
  hasSharedDrives,
  onOpen,
}: {
  readonly hasSharedDrives: boolean;
  readonly onOpen: (folderId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap gap-2">
      <Button
        onClick={() => onOpen(STORAGE_MY_DRIVE_ID)}
        size="xs"
        type="button"
        variant="outline"
      >
        <HardDrive aria-hidden="true" className="size-3.5" />
        {t("storage.myDrive")}
      </Button>
      {hasSharedDrives ? (
        <Button
          onClick={() => onOpen(STORAGE_SHARED_DRIVES_ID)}
          size="xs"
          type="button"
          variant="outline"
        >
          <Users aria-hidden="true" className="size-3.5" />
          {t("storage.sharedDrives")}
        </Button>
      ) : null}
    </div>
  );
}

function PickerFolders({
  reading,
  onOpen,
}: {
  readonly reading: StorageFolderReading;
  readonly onOpen: (folderId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();

  if (reading.kind === "loading") {
    return (
      <p className="px-2.5 py-3 text-sm text-muted-foreground">
        {t("storage.loading")}
      </p>
    );
  }

  const folder = reading.kind === "loaded" ? reading.result.folder : null;

  if (!folder) {
    return (
      <p className="px-2.5 py-3 text-sm text-destructive">
        {t("storage.picker.unavailable")}
      </p>
    );
  }

  if (folder.items.length === 0) {
    return (
      <p className="px-2.5 py-3 text-sm text-muted-foreground">
        {t("storage.picker.noSubfolders")}
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {folder.items.map((item) => (
        <li key={item.id}>
          <button
            className={ROW_CLASS}
            onClick={() => onOpen(item.id)}
            type="button"
          >
            <Folder
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
            />
            <span className="truncate">
              {item.name === "" ? t("storage.untitled") : item.name}
            </span>
            <ChevronRight
              aria-hidden="true"
              className="ml-auto size-4 shrink-0 text-muted-foreground"
            />
          </button>
        </li>
      ))}
    </ul>
  );
}

function useSaveStartFolder(onSaved: PickerBodyProps["onSaved"]): {
  readonly isSaving: boolean;
  readonly error: string | null;
  readonly save: (folderId: string | null) => void;
} {
  const { t } = useTranslation();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function persist(folderId: string | null): Promise<void> {
    setIsSaving(true);
    setError(null);
    const reply = await requestStartFolderChange(folderId);
    setIsSaving(false);

    if (reply.ok && reply.value.ok) {
      onSaved(reply.value.startFolder);
      return;
    }

    const reason = reply.ok && !reply.value.ok ? reply.value.error : "failed";
    setError(t(`storage.picker.saveError.${reason}`));
  }

  function save(folderId: string | null): void {
    void persist(folderId);
  }

  return { error, isSaving, save };
}

function PickerBody({
  initialFolderId,
  startFolder,
  onSaved,
}: PickerBodyProps): React.ReactElement {
  const { t } = useTranslation();
  const [folderId, setFolderId] = useState(initialFolderId);
  const { reading } = useStorageFolder({ folderId, isFoldersOnly: true });
  const { error, isSaving, save } = useSaveStartFolder(onSaved);
  const result = reading.kind === "loaded" ? reading.result : null;
  const folder = result?.folder ?? null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {startFolder
          ? t("storage.picker.current", { path: pathText(startFolder.path, t) })
          : t("storage.picker.none")}
      </p>
      <PickerRoots
        hasSharedDrives={result?.hasSharedDrives ?? false}
        onOpen={setFolderId}
      />
      {folder ? <PickerPath folder={folder} onOpen={setFolderId} /> : null}
      <div className="max-h-72 min-h-32 overflow-y-auto rounded-xl border border-border p-1">
        <PickerFolders onOpen={setFolderId} reading={reading} />
      </div>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2">
        {startFolder ? (
          <Button
            disabled={isSaving}
            onClick={() => save(null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            {t("storage.startFolder.clear")}
          </Button>
        ) : null}
        <Button
          disabled={!folder?.canBeStartFolder}
          isPending={isSaving}
          onClick={() => folder && save(folder.folderId)}
          size="sm"
          type="button"
        >
          {t("storage.picker.confirm")}
        </Button>
      </div>
    </div>
  );
}

/**
 * The compact choice of the start folder: browse folders, then confirm.
 *
 * @remarks
 * The server checks the chosen folder with Drive and stores its identifier
 * with the readable name and path; the browser sends only the identifier.
 */
export function StorageStartFolderPicker({
  isOpen,
  initialFolderId,
  startFolder,
  onOpenChange,
  onSaved,
}: StorageStartFolderPickerProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Dialog onOpenChange={onOpenChange} open={isOpen}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold text-foreground">
          {t("storage.picker.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 mb-4 text-sm text-muted-foreground">
          {t("storage.picker.description")}
        </DialogDescription>
        {isOpen ? (
          <PickerBody
            initialFolderId={initialFolderId}
            onSaved={onSaved}
            startFolder={startFolder}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
