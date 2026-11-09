import {
  ClipboardList,
  File,
  FileArchive,
  FileCode,
  FileImage,
  FileMusic,
  FilePlay,
  FileScan,
  FileSpreadsheet,
  FileSymlink,
  FileText,
  FileType,
  Folder,
  PenTool,
  Presentation,
} from "lucide-react";

import { cn } from "@/app/lib/cn";

import type { StorageItemKind } from "./storage-item-kind";
import type { LucideIcon } from "lucide-react";

/** Icon and theme colors of each kind; the tile tints its own color. */
const KIND_STYLES: Readonly<
  Record<StorageItemKind, { readonly icon: LucideIcon; readonly tone: string }>
> = {
  archive: { icon: FileArchive, tone: "bg-file-archive/12 text-file-archive" },
  audio: { icon: FileMusic, tone: "bg-file-audio/12 text-file-audio" },
  code: { icon: FileCode, tone: "bg-file-code/12 text-file-code" },
  document: { icon: FileText, tone: "bg-file-document/12 text-file-document" },
  drawing: { icon: PenTool, tone: "bg-file-drawing/12 text-file-drawing" },
  file: { icon: File, tone: "bg-muted text-muted-foreground" },
  folder: { icon: Folder, tone: "bg-file-folder/12 text-file-folder" },
  form: { icon: ClipboardList, tone: "bg-file-form/12 text-file-form" },
  image: { icon: FileImage, tone: "bg-file-image/12 text-file-image" },
  pdf: { icon: FileScan, tone: "bg-file-pdf/12 text-file-pdf" },
  presentation: {
    icon: Presentation,
    tone: "bg-file-presentation/12 text-file-presentation",
  },
  shortcut: {
    icon: FileSymlink,
    tone: "bg-file-shortcut/12 text-file-shortcut",
  },
  spreadsheet: {
    icon: FileSpreadsheet,
    tone: "bg-file-spreadsheet/12 text-file-spreadsheet",
  },
  text: { icon: FileType, tone: "bg-file-text/12 text-file-text" },
  video: { icon: FilePlay, tone: "bg-file-video/12 text-file-video" },
};

/**
 * The colored tile with the icon of an entry's kind (PAGE-272).
 *
 * @remarks
 * The colors are theme tokens with a light and a dark value; the kind is
 * named in `data-kind`, so the tile stays checkable without its color.
 */
export function StorageItemIcon({
  kind,
}: {
  readonly kind: StorageItemKind;
}): React.ReactElement {
  const { icon: Icon, tone } = KIND_STYLES[kind];

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg",
        tone,
      )}
      data-kind={kind}
    >
      <Icon className={kind === "folder" ? "size-4 fill-current" : "size-4"} />
    </span>
  );
}
