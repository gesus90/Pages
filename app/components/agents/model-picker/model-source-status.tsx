import { Info, RefreshCw, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { isWarningStatus } from "./model-catalog";

import type { TFunction } from "i18next";
import type { ConnectionCatalogStatus } from "@/definition/AgentModelCatalogStatus";
import type { ModelSource } from "./model-catalog";
import type { CatalogStatusState } from "./use-catalog-statuses";

// Status lines stand in the text column of the model rows: padding, icon and gap.
const TEXT_COLUMN = "pl-10";

// The time of the last listing: the clock time on the same day, otherwise date and time.
function formatAttempt(
  attemptedAt: string | null,
  language: string,
): string | null {
  if (attemptedAt === null) return null;
  const moment = new Date(attemptedAt);
  if (Number.isNaN(moment.getTime())) return null;
  const isToday = moment.toDateString() === new Date().toDateString();
  return new Intl.DateTimeFormat(
    language,
    isToday
      ? { hour: "2-digit", minute: "2-digit" }
      : { dateStyle: "short", timeStyle: "short" },
  ).format(moment);
}

function warningText(
  status: ConnectionCatalogStatus,
  language: string,
  t: TFunction,
): string {
  const time = formatAttempt(status.lastAttemptAt, language);
  if (status.state === "unverified")
    return t("plans.modelPicker.status.unverified");
  if (status.state === "failed")
    return time === null
      ? t("plans.modelPicker.status.failedNoTime")
      : t("plans.modelPicker.status.failed", { time });
  return time === null
    ? t("plans.modelPicker.status.emptyNoTime")
    : t("plans.modelPicker.status.empty", { time });
}

// The button is reachable by Tab, but not part of the arrow-key order of the tree.
function ReloadButton({
  connectionId,
  catalog,
}: {
  readonly connectionId: string;
  readonly catalog: CatalogStatusState;
}): React.ReactElement {
  const { t } = useTranslation();
  const isReloading = catalog.reloadingId === connectionId;
  return (
    <button
      type="button"
      disabled={catalog.reloadingId !== null}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg bg-surface px-2.5 text-xs leading-4 font-semibold text-foreground ring-1 ring-border-strong transition-colors outline-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-60"
      onClick={() => void catalog.reload(connectionId)}
    >
      <RefreshCw
        className={cn("size-[13px]", isReloading && "animate-spin")}
        aria-hidden="true"
      />
      {t("plans.modelPicker.status.reload")}
    </button>
  );
}

function WarningLine({
  status,
  catalog,
}: {
  readonly status: ConnectionCatalogStatus;
  readonly catalog: CatalogStatusState;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const canReload = catalog.statuses?.canReload === true;
  return (
    <li role="presentation" className={cn("pr-2.5", TEXT_COLUMN)}>
      <div
        role="status"
        className="flex min-h-9 items-center gap-2 py-1 text-xs leading-4 text-warning"
      >
        <TriangleAlert className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {warningText(status, i18n.language, t)}
        </span>
        {canReload ? (
          <ReloadButton connectionId={status.connectionId} catalog={catalog} />
        ) : null}
      </div>
      {catalog.failedId === status.connectionId ? (
        <p className="pb-1 pl-[22px] text-xs text-warning">
          {t("plans.modelPicker.status.reloadFailed")}
        </p>
      ) : null}
      {canReload ? null : (
        <p className="pb-1 pl-[22px] text-xs text-muted-foreground">
          {t("plans.modelPicker.status.administratorHint")}
        </p>
      )}
    </li>
  );
}

function NoFitLine({ total }: { readonly total: number }): React.ReactElement {
  const { t } = useTranslation();
  return (
    <li role="presentation" className={cn("pr-2.5", TEXT_COLUMN)}>
      <p className="flex min-h-9 items-center gap-2 py-1 text-xs leading-4 text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          {t("plans.modelPicker.status.noFit", { count: total })}
        </span>
      </p>
    </li>
  );
}

/**
 * The state line of one connection inside its tool.
 * @remarks
 * An empty, failed or unverified catalog gets a warning with the time of the
 * last listing and, for administrators only, a button that reloads exactly
 * this connection; every other account sees the same text and a note that an
 * administrator can reload. A catalog that offers models, none of which fits
 * the place, gets a neutral line without a button, because a new listing
 * would not change it. The search keeps the warnings and drops the neutral
 * line. The line shows no error detail and no key.
 */
export function ModelSourceStatus({
  source,
  catalog,
  isSearching,
}: {
  readonly source: ModelSource;
  readonly catalog: CatalogStatusState;
  readonly isSearching: boolean;
}): React.ReactElement | null {
  const { status } = source;
  if (isWarningStatus(status))
    return <WarningLine status={status} catalog={catalog} />;
  if (status === null || isSearching) return null;
  return status.modelCount > 0 && source.choices.length === 0 ? (
    <NoFitLine total={status.modelCount} />
  ) : null;
}
