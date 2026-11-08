import { ChevronRight } from "lucide-react";
import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import googleDriveLogoUrl from "@/assets/google-drive/google-drive-product-logo.png?no-inline";

import { pathEntryLabel, storageFolderHref } from "./storage-format";
import { StorageQuotaPanel } from "./storage-quota";

import type { StoragePathEntry } from "@/definition/GoogleDriveStorage";

interface StorageHeaderProps {
  readonly path: readonly StoragePathEntry[];
  readonly isConnected: boolean;
}

function PathStep({
  entry,
  isCurrent,
}: {
  readonly entry: StoragePathEntry;
  readonly isCurrent: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  const label = pathEntryLabel(entry, t);

  if (isCurrent) {
    return (
      <span
        aria-current="page"
        className="truncate font-semibold text-foreground"
      >
        {label}
      </span>
    );
  }

  if (entry.role === "detached") {
    return (
      <span
        className="text-muted-foreground"
        title={t("storage.path.detached")}
      >
        {label}
      </span>
    );
  }

  return (
    <Link
      className="truncate rounded-sm text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-primary"
      to={storageFolderHref(entry.id)}
    >
      {label}
    </Link>
  );
}

/** The path from the root of Google Drive to the shown folder, every step clickable. */
function StorageBreadcrumb({
  path,
}: {
  readonly path: readonly StoragePathEntry[];
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <nav aria-label={t("storage.path.label")} className="min-w-0">
      <ol className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
        <li className="flex items-center gap-2">
          <img
            alt=""
            className="size-6 shrink-0"
            draggable={false}
            height={24}
            src={googleDriveLogoUrl}
            width={24}
          />
          <span className="font-semibold text-foreground">
            {t("storage.googleDrive")}
          </span>
        </li>
        {path.map((entry, index) => (
          <Fragment key={`${entry.role}:${entry.id}:${index}`}>
            <li aria-hidden="true" className="text-muted-foreground">
              <ChevronRight className="size-4" />
            </li>
            <li className="min-w-0 max-w-64">
              <PathStep entry={entry} isCurrent={index === path.length - 1} />
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  );
}

function ConnectedBadge(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-success-subtle px-2.5 py-1 text-xs font-semibold text-success">
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-success-dot"
      />
      {t("storage.connected")}
    </span>
  );
}

/**
 * The head of the Storage area: Drive logo and path on the left, the
 * connection badge and the storage quota on the right.
 *
 * @remarks
 * "Verbunden" appears only when the server confirmed the connection with a
 * Drive request for this view.
 */
export function StorageHeader({
  path,
  isConnected,
}: StorageHeaderProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0 flex-1">
        <h1 className="mb-2 text-2xl font-semibold text-foreground">
          {t("storage.title")}
        </h1>
        <StorageBreadcrumb path={path} />
      </div>
      <div className="flex shrink-0 flex-col items-start gap-3 sm:flex-row sm:items-start lg:items-start">
        {isConnected ? <ConnectedBadge /> : null}
        {isConnected ? <StorageQuotaPanel /> : null}
      </div>
    </header>
  );
}
