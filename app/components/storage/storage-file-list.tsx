import {
  ExternalLink,
  File,
  FileArchive,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Presentation,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import {
  formatBytes,
  formatModified,
  storageFolderHref,
} from "./storage-format";

import type { StorageItem } from "@/definition/GoogleDriveStorage";
import type { LucideIcon } from "lucide-react";

interface StorageFileListProps {
  readonly items: readonly StorageItem[];
}

/** Icons by the beginning of a MIME type; the first match wins. */
const ICONS_BY_MIME: readonly (readonly [string, LucideIcon])[] = [
  ["application/vnd.google-apps.spreadsheet", FileSpreadsheet],
  ["application/vnd.google-apps.presentation", Presentation],
  ["application/vnd.google-apps.document", FileText],
  ["application/pdf", FileText],
  ["text/", FileText],
  ["image/", FileImage],
  ["video/", FileVideo],
  ["application/zip", FileArchive],
];

function iconOf(item: StorageItem): LucideIcon {
  if (item.isFolder) {
    return Folder;
  }

  return (
    ICONS_BY_MIME.find(([prefix]) => item.mimeType.startsWith(prefix))?.[1] ??
    File
  );
}

function ItemName({
  item,
}: {
  readonly item: StorageItem;
}): React.ReactElement {
  const { t } = useTranslation();
  const Icon = iconOf(item);
  const name = item.name === "" ? t("storage.untitled") : item.name;
  const icon = (
    <Icon
      aria-hidden="true"
      className={
        item.isFolder
          ? "size-5 shrink-0 text-primary"
          : "size-5 shrink-0 text-muted-foreground"
      }
    />
  );
  const linkClass =
    "flex min-w-0 items-center gap-3 rounded-md py-1 text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary";

  if (item.isFolder) {
    return (
      <Link className={linkClass} to={storageFolderHref(item.id)}>
        {icon}
        <span className="truncate font-medium">{name}</span>
      </Link>
    );
  }

  if (item.webViewLink === null) {
    return (
      <span className="flex min-w-0 items-center gap-3 py-1">
        {icon}
        <span className="truncate">{name}</span>
      </span>
    );
  }

  return (
    <a
      className={linkClass}
      href={item.webViewLink}
      referrerPolicy="no-referrer"
      rel="noopener noreferrer"
      target="_blank"
      title={t("storage.list.openInDrive")}
    >
      {icon}
      <span className="truncate">{name}</span>
      <ExternalLink
        aria-hidden="true"
        className="size-3.5 shrink-0 text-muted-foreground"
      />
    </a>
  );
}

function ItemRow({ item }: { readonly item: StorageItem }): React.ReactElement {
  const { t, i18n } = useTranslation();

  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-surface-hover">
      <td className="max-w-0 px-4 py-2">
        <ItemName item={item} />
      </td>
      <td className="hidden px-4 py-2 text-sm whitespace-nowrap text-muted-foreground md:table-cell">
        {item.modifiedAt === null
          ? "—"
          : formatModified(item.modifiedAt, i18n.language)}
      </td>
      <td className="hidden px-4 py-2 text-right text-sm whitespace-nowrap text-muted-foreground tabular-nums sm:table-cell">
        {item.isFolder ? t("storage.list.folder") : null}
        {!item.isFolder && item.sizeBytes !== null
          ? formatBytes(item.sizeBytes, i18n.language)
          : null}
        {!item.isFolder && item.sizeBytes === null ? "—" : null}
      </td>
    </tr>
  );
}

/** The content of a folder: folders first, then files, as Drive sorts them. */
export function StorageFileList({
  items,
}: StorageFileListProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <table className="w-full table-fixed border-collapse text-left">
      <thead className="sticky top-0 z-10 bg-card">
        <tr className="border-b border-border text-xs font-medium text-muted-foreground uppercase">
          <th className="px-4 py-2.5 font-medium" scope="col">
            {t("storage.list.name")}
          </th>
          <th
            className="hidden w-48 px-4 py-2.5 font-medium md:table-cell"
            scope="col"
          >
            {t("storage.list.modified")}
          </th>
          <th
            className="hidden w-28 px-4 py-2.5 text-right font-medium sm:table-cell"
            scope="col"
          >
            {t("storage.list.size")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <ItemRow item={item} key={item.id} />
        ))}
      </tbody>
    </table>
  );
}
