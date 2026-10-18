import {
  File as FileIcon,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  Presentation,
} from "lucide-react";

import { CHAT_OFFICE_TYPES } from "@/definition/ChatPreview";

import type { LucideIcon } from "lucide-react";

const TYPE_ICONS: Readonly<Record<string, LucideIcon>> = {
  "application/pdf": FileText,
  "text/csv": FileSpreadsheet,
  "application/json": FileCode,
  [CHAT_OFFICE_TYPES.document]: FileText,
  [CHAT_OFFICE_TYPES.workbook]: FileSpreadsheet,
  [CHAT_OFFICE_TYPES.presentation]: Presentation,
};

/** The short type name a person knows: the extension of the file, or its kind. */
export function attachmentTypeLabel(fileName: string): string {
  const extension = /\.([a-z0-9]{1,8})$/iu.exec(fileName)?.[1];
  return extension ? extension.toUpperCase() : "—";
}

/** The icon of an attachment by the type Pages determined from its content. */
export function attachmentIcon(contentType: string): LucideIcon {
  if (contentType.startsWith("image/")) return FileImage;
  if (contentType.startsWith("text/") && contentType !== "text/csv")
    return FileText;
  return TYPE_ICONS[contentType] ?? FileIcon;
}
