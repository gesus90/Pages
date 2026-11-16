import { documentFormatOf } from "@/app/components/chat-page/content/documents/document-kinds";
import { documentKindLabel } from "@/app/components/chat-page/content/documents/document-labels";
import { isGoogleAppsType } from "@/backend/google/GoogleDriveFormats";

import { storageDownloadHref } from "../storage-actions-requests";
import { storageItemKind } from "../storage-item-kind";

import { storagePreviewPlanOf } from "./storage-preview-kind";

import type { StorageItem } from "@/definition/GoogleDriveStorage";
import type { TFunction } from "i18next";
import type { StorageItemKind } from "../storage-item-kind";
import type { StoragePreviewEntry } from "./storage-preview-request";

/** The PDF export of a Google document, the format the preview shows. */
const PDF_TYPE = "application/pdf";

/** The file the preview head names, from Drive's answer or from the list. */
export interface StoragePreviewSubjectInfo {
  readonly ref: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number | null;
  readonly modifiedAt: string | null;
  /** The export formats of a Google document; empty before Drive answered. */
  readonly exportFormats: readonly string[];
  readonly kind: StorageItemKind;
}

/**
 * Describes the file of the preview for its head.
 * @param entry - What Drive answered, or `null` before and without an answer.
 * @param listed - The row of the list the file was opened from, if it is there.
 * @param ref - The reference the preview was asked for.
 * @returns The best known description; the name stays empty when nothing names it.
 */
export function storagePreviewSubjectOf(
  entry: StoragePreviewEntry | null,
  listed: StorageItem | null,
  ref: string,
): StoragePreviewSubjectInfo {
  const source = entry ?? listed;
  const named = {
    isFolder: false,
    mimeType: source?.mimeType ?? "",
    name: source?.name ?? "",
  };

  return {
    exportFormats: entry?.exportFormats ?? [],
    kind: storageItemKind(named),
    mimeType: named.mimeType,
    modifiedAt: source?.modifiedAt ?? null,
    name: named.name,
    ref,
    sizeBytes: source?.sizeBytes ?? null,
  };
}

/**
 * The name of the type of a file for the head, such as "PDF" or "Word-Dokument".
 * @param subject - The file.
 * @param t - Translation function.
 * @returns The type; an unknown file gets the name of its icon kind.
 */
export function storagePreviewTypeLabel(
  subject: StoragePreviewSubjectInfo,
  t: TFunction,
): string {
  const format = documentFormatOf(subject);

  if (format !== null) return documentKindLabel(format, t);

  const plan = storagePreviewPlanOf(subject);

  if (plan?.kind === "markdown") return t("storage.preview.kind.markdown");
  if (plan?.kind === "pdf") return t("storage.preview.kind.pdf");

  return t(`storage.preview.kind.${subject.kind}`);
}

/**
 * The address that downloads a file in a format Drive really offers.
 * @param subject - The file.
 * @returns The address; `null` for a Google document without a known export,
 * where no original exists to download.
 * @remarks
 * A Google document downloads as its PDF export when that is offered, else as
 * the first format Drive names.
 */
export function storagePreviewDownloadHref(
  subject: StoragePreviewSubjectInfo,
): string | null {
  if (!isGoogleAppsType(subject.mimeType)) {
    return storageDownloadHref(subject.ref, null);
  }

  const format = subject.exportFormats.includes(PDF_TYPE)
    ? PDF_TYPE
    : subject.exportFormats.at(0);

  return format === undefined ? null : storageDownloadHref(subject.ref, format);
}
