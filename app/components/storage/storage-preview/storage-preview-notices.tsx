import {
  Download,
  FileQuestion,
  FileX,
  Loader2,
  Lock,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button, buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { formatLimit } from "../storage-format";

import type { LucideIcon } from "lucide-react";
import type { StoragePreviewOutcome } from "./storage-preview-load";

interface StoragePreviewNoticeProps {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly text: string;
  /** Failures are announced at once; a plain statement waits to be read. */
  readonly isAlert?: boolean;
  readonly children?: React.ReactNode;
}

/** One state of the preview in the body: icon, title, explanation and actions. */
function StoragePreviewNotice({
  icon: Icon,
  title,
  text,
  isAlert = false,
  children,
}: StoragePreviewNoticeProps): React.ReactElement {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-10 text-center"
      role={isAlert ? "alert" : undefined}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"
      >
        <Icon className="size-6" />
      </span>
      <h3 className="max-w-md text-base leading-6 font-bold text-foreground">
        {title}
      </h3>
      <p className="max-w-md text-sm leading-6 text-muted-foreground">{text}</p>
      {children === undefined ? null : (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {children}
        </div>
      )}
    </div>
  );
}

/** The placeholder lines of a document that loads. */
export function StoragePreviewLoading(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div
      aria-busy="true"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden p-6"
    >
      <p className="sr-only" role="status">
        {t("storage.preview.loading")}
      </p>
      <Loader2
        aria-hidden="true"
        className="size-5 animate-spin text-muted-foreground"
      />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <span className="h-6 w-1/3 rounded-md bg-muted" />
        <span className="h-4 w-full rounded-md bg-muted" />
        <span className="h-4 w-5/6 rounded-md bg-muted" />
        <span className="h-4 w-2/3 rounded-md bg-muted" />
        <span className="mt-4 h-4 w-1/4 rounded-md bg-muted" />
        <span className="h-4 w-full rounded-md bg-muted" />
      </div>
    </div>
  );
}

/** The download that is the main action of a file the preview cannot show. */
function DownloadAction({
  href,
  isMain,
}: {
  readonly href: string | null;
  readonly isMain: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();

  if (href === null) return null;

  return (
    <a
      className={cn(
        buttonVariants({ variant: isMain ? "default" : "outline" }),
        "md:min-h-9",
      )}
      download
      href={href}
    >
      <Download aria-hidden="true" className="size-4" />
      {t("storage.preview.download")}
    </a>
  );
}

/**
 * The notice a preview shows instead of content.
 * @remarks
 * Missing rights and a removed file offer no download, because none would
 * work. A file that is too large, unknown or unreadable offers the download
 * as its main action; a failed read offers a new attempt first.
 */
export function StoragePreviewOutcomeNotice({
  outcome,
  downloadHref,
  onRetry,
}: {
  readonly outcome: Exclude<StoragePreviewOutcome, { readonly kind: "ready" }>;
  readonly downloadHref: string | null;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();

  switch (outcome.kind) {
    case "unsupported":
      return (
        <StoragePreviewNotice
          icon={FileQuestion}
          text={t("storage.preview.unsupported.text")}
          title={t("storage.preview.unsupported.title")}
        >
          <DownloadAction href={downloadHref} isMain />
        </StoragePreviewNotice>
      );
    case "tooLarge":
      return (
        <StoragePreviewNotice
          icon={FileQuestion}
          text={t("storage.preview.tooLarge.text", {
            limit: formatLimit(outcome.limitBytes, i18n.language),
          })}
          title={t("storage.preview.tooLarge.title")}
        >
          <DownloadAction href={downloadHref} isMain />
        </StoragePreviewNotice>
      );
    case "unreadable":
      return (
        <StoragePreviewNotice
          icon={outcome.reason === "encrypted" ? Lock : FileX}
          text={t(`storage.preview.unreadable.${outcome.reason}`)}
          title={t("storage.preview.unreadable.title")}
        >
          <DownloadAction href={downloadHref} isMain />
        </StoragePreviewNotice>
      );
    case "failed":
      return outcome.reason === "failed" ? (
        <StoragePreviewNotice
          icon={TriangleAlert}
          isAlert
          text={t("storage.preview.failed.text")}
          title={t("storage.preview.failed.title")}
        >
          <Button onClick={onRetry} type="button">
            <RefreshCw aria-hidden="true" className="size-4" />
            {t("storage.preview.retry")}
          </Button>
          <DownloadAction href={downloadHref} isMain={false} />
        </StoragePreviewNotice>
      ) : (
        <StoragePreviewNotice
          icon={outcome.reason === "forbidden" ? Lock : FileX}
          isAlert
          text={t(`storage.preview.${outcome.reason}.text`)}
          title={t(`storage.preview.${outcome.reason}.title`)}
        />
      );
  }
}
