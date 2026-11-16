import { useTranslation } from "react-i18next";

import { StoragePreviewBody } from "./storage-preview/storage-preview-body";
import { StoragePreviewHeader } from "./storage-preview/storage-preview-header";
import { StoragePreviewSurface } from "./storage-preview/storage-preview-surface";
import {
  storagePreviewDownloadHref,
  storagePreviewSubjectOf,
} from "./storage-preview/storage-preview-subject";

import type { StorageItem } from "@/definition/GoogleDriveStorage";
import type { StoragePreviewModel } from "./storage-preview/use-storage-preview";

interface StoragePreviewProps {
  /** The reference of the file; the preview reads it by this alone. */
  readonly fileRef: string;
  /** How loading the file stands. */
  readonly model: StoragePreviewModel;
  /** The row of the list the file was opened from, while the list has it. */
  readonly listed: StorageItem | null;
  readonly onClose: () => void;
}

/**
 * The read-only preview of one file inside Storage.
 * @remarks
 * It takes the content card of the list on desktop and the whole screen on a
 * phone. Head and download are known before the content: the head names the
 * file from the list until Drive answers, and stays when loading fails. A
 * missing right or a removed file offers no download, because none would
 * work. Opening always asks Drive again, and closing aborts the requests and
 * frees the opened PDF, which the loader owns.
 */
export function StoragePreview({
  fileRef,
  model,
  listed,
  onClose,
}: StoragePreviewProps): React.ReactElement {
  const { t } = useTranslation();
  const { outcome, retry } = model;
  const subject = storagePreviewSubjectOf(
    outcome?.entry ?? null,
    listed,
    fileRef,
  );
  const isUnavailable =
    outcome?.kind === "failed" && outcome.reason !== "failed";
  const downloadHref = isUnavailable
    ? null
    : storagePreviewDownloadHref(subject);
  const label = subject.name === "" ? t("storage.untitled") : subject.name;

  return (
    <StoragePreviewSurface label={label} onClose={onClose}>
      <StoragePreviewHeader
        downloadHref={downloadHref}
        onClose={onClose}
        subject={subject}
      />
      <StoragePreviewBody
        downloadHref={downloadHref}
        label={label}
        onRetry={retry}
        outcome={outcome}
      />
    </StoragePreviewSurface>
  );
}
