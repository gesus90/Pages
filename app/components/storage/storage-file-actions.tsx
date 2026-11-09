import { Download, MoreHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/app/components/ui/dropdown-menu";

import { storageDownloadHref } from "./storage-actions-requests";

import type {
  StorageActionsModel,
  StorageActionTarget,
} from "./use-storage-actions";

/** Short names of the export formats; an unknown one shows its MIME type. */
const FORMAT_LABELS: Readonly<Record<string, string>> = {
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "PowerPoint (.pptx)",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    "Excel (.xlsx)",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "Word (.docx)",
  "image/png": "PNG",
  "image/svg+xml": "SVG",
  "text/csv": "CSV",
  "text/html": "HTML",
  "text/markdown": "Markdown",
  "text/plain": "Text (.txt)",
};

/** Google's own types carry no bytes; only their export formats download. */
const GOOGLE_APPS_PREFIX = "application/vnd.google-apps.";

/** A file or folder of the list with what its menu needs. */
export interface StorageFileActionTarget extends StorageActionTarget {
  readonly mimeType: string;
  /** The export formats of a Google document, else empty. */
  readonly exportFormats: readonly string[];
}

interface StorageFileActionsProps {
  readonly target: StorageFileActionTarget;
  readonly actions: StorageActionsModel;
}

function DownloadItems({
  target,
}: {
  readonly target: StorageFileActionTarget;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const label = (
    <>
      <Download aria-hidden="true" className="mr-2 size-4" />
      {t("storage.actions.download")}
    </>
  );

  if (target.isFolder) {
    return null;
  }

  if (!target.mimeType.startsWith(GOOGLE_APPS_PREFIX)) {
    return (
      <DropdownMenuItem asChild>
        <a download href={storageDownloadHref(target.ref, null)}>
          {label}
        </a>
      </DropdownMenuItem>
    );
  }

  if (target.exportFormats.length === 0) {
    return null;
  }

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{label}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {target.exportFormats.map((format) => (
          <DropdownMenuItem asChild key={format}>
            <a download href={storageDownloadHref(target.ref, format)}>
              {FORMAT_LABELS[format] ?? format}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * The menu of one file: download, with the export formats of a Google
 * document. Changing actions live in the menu bar and the context menu of
 * the list (PAGE-272).
 */
export function StorageFileActions({
  target,
  actions,
}: StorageFileActionsProps): React.ReactElement | null {
  const { t } = useTranslation();
  const hasDownload =
    !target.isFolder &&
    (!target.mimeType.startsWith(GOOGLE_APPS_PREFIX) ||
      target.exportFormats.length > 0);

  if (!hasDownload) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("storage.actions.menu", { name: target.name })}
          disabled={actions.isBusy}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DownloadItems target={target} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
