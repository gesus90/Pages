import { AlertTriangle, Info, Settings } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button, buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

import { storageFolderHref } from "./storage-format";

import type {
  StorageConnectionUnavailable,
  StorageFolderProblem,
  StorageStartFolderProblem,
} from "@/definition/GoogleDriveStorage";
import type { ReactNode } from "react";

import type { StorageRequestFailure } from "./storage-requests";

/** Where the existing Google sign-in lives; Storage has no sign-in of its own. */
const SYSTEM_SETTINGS_PATH = "/settings/system";

interface NoticeProps {
  readonly tone: "warning" | "info" | "destructive";
  readonly title: string;
  readonly children?: ReactNode;
  readonly actions?: ReactNode;
}

const TONE_CLASSES: Readonly<Record<NoticeProps["tone"], string>> = {
  destructive: "bg-destructive-subtle text-destructive",
  info: "bg-info-subtle text-info",
  warning: "bg-warning-subtle text-warning",
};

/** A short explanation with an optional way forward. */
function Notice({
  tone,
  title,
  children,
  actions,
}: NoticeProps): React.ReactElement {
  const Icon = tone === "info" ? Info : AlertTriangle;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-xl px-4 py-3 text-sm",
        TONE_CLASSES[tone],
      )}
      role={tone === "info" ? "status" : "alert"}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        {children ? (
          <div className="mt-1 text-foreground">{children}</div>
        ) : null}
        {actions ? (
          <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

function SystemSettingsLink(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Link
      className={buttonVariants({ size: "sm", variant: "outline" })}
      to={SYSTEM_SETTINGS_PATH}
    >
      <Settings aria-hidden="true" className="size-4" />
      {t("storage.connection.openSettings")}
    </Link>
  );
}

/**
 * Explains a missing, expired or unconfirmed Drive connection and points to
 * the existing sign-in under Settings → System.
 */
export function StorageConnectionNotice({
  connection,
  onRetry,
}: {
  readonly connection: StorageConnectionUnavailable;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice
      actions={
        <>
          <SystemSettingsLink />
          {connection.state === "unavailable" ? (
            <Button onClick={onRetry} size="sm" type="button" variant="ghost">
              {t("storage.retry")}
            </Button>
          ) : null}
        </>
      }
      title={t(`storage.connection.${connection.state}`)}
      tone="warning"
    >
      {connection.problem === null ? null : (
        <p>{t(`settings.googleDrive.problem.${connection.problem}`)}</p>
      )}
      <p>{t("storage.connection.where")}</p>
    </Notice>
  );
}

/** Explains a refused or failed request of the Storage endpoint. */
export function StorageFailureNotice({
  failure,
  onRetry,
}: {
  readonly failure: StorageRequestFailure;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  if (failure === "forbidden") {
    return (
      <Notice title={t("storage.forbidden.title")} tone="warning">
        <p>{t("storage.forbidden.text")}</p>
      </Notice>
    );
  }

  return (
    <Notice
      actions={
        <Button onClick={onRetry} size="sm" type="button" variant="outline">
          {t("storage.retry")}
        </Button>
      }
      title={t("storage.failed")}
      tone="destructive"
    />
  );
}

/** Says that the granted scope shows only the files of Pages, and how to widen it. */
export function StorageReachNotice(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice
      actions={<SystemSettingsLink />}
      title={t("storage.reach.title")}
      tone="info"
    >
      <p>{t("storage.reach.text")}</p>
    </Notice>
  );
}

/** Explains why an explicitly asked folder is not shown; nothing else opens instead. */
export function StorageFolderProblemNotice({
  problem,
}: {
  readonly problem: StorageFolderProblem;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice
      actions={
        <Link
          className={buttonVariants({ size: "sm", variant: "outline" })}
          to={storageFolderHref(null)}
        >
          {t("storage.openStart")}
        </Link>
      }
      title={t("storage.folderProblem.title")}
      tone="warning"
    >
      <p>{t(`storage.folderProblem.${problem}`)}</p>
    </Notice>
  );
}

/**
 * Explains why the saved start folder was not opened and asks for a new
 * choice, instead of silently opening another folder.
 */
export function StorageStartFolderProblemNotice({
  problem,
  startFolderName,
  onChoose,
  onClear,
}: {
  readonly problem: StorageStartFolderProblem;
  readonly startFolderName: string | null;
  readonly onChoose: () => void;
  readonly onClear: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice
      actions={
        <>
          <Button onClick={onChoose} size="sm" type="button">
            {t("storage.startFolder.chooseNew")}
          </Button>
          <Button onClick={onClear} size="sm" type="button" variant="outline">
            {t("storage.startFolder.clear")}
          </Button>
        </>
      }
      title={t("storage.startFolder.problemTitle")}
      tone="warning"
    >
      {startFolderName === null ? null : (
        <p>{t("storage.startFolder.savedName", { name: startFolderName })}</p>
      )}
      <p>{t(`storage.startFolder.problem.${problem}`)}</p>
    </Notice>
  );
}

/** Reports that Drive names the start folder differently now; it stays the same folder. */
export function StorageRenamedNotice({
  from,
  to,
}: {
  readonly from: string;
  readonly to: string;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <Notice
      title={t("storage.startFolder.renamed", { from, to })}
      tone="info"
    />
  );
}
