import { Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { formatBytes, formatModified } from "../storage-format";
import { StorageItemIcon } from "../storage-item-icon";

import { storagePreviewTypeLabel } from "./storage-preview-subject";

import type { StoragePreviewSubjectInfo } from "./storage-preview-subject";

interface StoragePreviewHeaderProps {
  readonly subject: StoragePreviewSubjectInfo;
  /** The download of the file; `null` where none can work or none is offered. */
  readonly downloadHref: string | null;
  readonly onClose: () => void;
}

/** Type, size and change date of the file; a value Drive does not name is left out. */
function useMetaLine(subject: StoragePreviewSubjectInfo): string {
  const { t, i18n } = useTranslation();
  const modified =
    subject.modifiedAt === null
      ? ""
      : formatModified(subject.modifiedAt, i18n.language);

  return [
    subject.name === "" ? "" : storagePreviewTypeLabel(subject, t),
    subject.sizeBytes === null
      ? ""
      : formatBytes(subject.sizeBytes, i18n.language),
    modified === "" ? "" : t("storage.preview.modified", { date: modified }),
  ]
    .filter((part) => part !== "")
    .join(" · ");
}

/**
 * The head of the preview: type tile, name and facts on the left, download
 * and close on the right.
 * @remarks
 * The name is cut after one line and stays complete in the text of the
 * heading. The head grows with the text size instead of clipping it. On a
 * phone the download is an icon, and every target is at least 44 px square.
 */
export function StoragePreviewHeader({
  subject,
  downloadHref,
  onClose,
}: StoragePreviewHeaderProps): React.ReactElement {
  const { t } = useTranslation();
  const meta = useMetaLine(subject);
  const name = subject.name === "" ? t("storage.untitled") : subject.name;

  return (
    <header className="flex min-h-15 shrink-0 items-center gap-3 border-b border-border bg-surface px-3 py-2 md:min-h-16 md:px-4">
      <StorageItemIcon isLarge kind={subject.kind} />
      <div className="min-w-0 flex-1">
        <h2
          className="truncate text-base leading-6 font-bold text-foreground"
          title={name}
        >
          {name}
        </h2>
        {meta === "" ? null : (
          <p className="truncate text-xs leading-4 text-muted-foreground">
            {meta}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {downloadHref === null ? null : (
          <a
            className={cn(
              buttonVariants({ size: "default", variant: "outline" }),
              "max-md:size-11 max-md:px-0 md:min-h-9 md:text-sm",
            )}
            download
            href={downloadHref}
          >
            <Download aria-hidden="true" className="size-4" />
            <span className="max-md:sr-only">
              {t("storage.preview.download")}
            </span>
          </a>
        )}
        <button
          aria-label={t("storage.preview.close")}
          className={cn(
            buttonVariants({ size: "icon", variant: "outline" }),
            "md:size-9 md:min-h-9",
          )}
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </div>
    </header>
  );
}
