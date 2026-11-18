import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { useRefreshHint } from "./use-refresh-hint";

/**
 * The head of the section "Kontingente und Guthaben": the heading, the live
 * badge and the refresh button.
 * @remarks
 * The head names no time of its own: each card's status line says when
 * Claude last answered, so a reload of the page never looks like a query.
 * While a query runs the head says so, on a narrow screen under the heading
 * in a line that stands there empty otherwise, so the cards below never move;
 * it says so only once the query has run 400 ms, so a quick one shows no
 * change.
 * The live badge shows while the server's push stream is open. The button
 * queries once without moving the minute beat; it is off and its icon turns
 * while a query runs.
 */
export function QuotaSectionHeader({
  isRefreshing,
  isLive,
  onRefresh,
}: {
  readonly isRefreshing: boolean;
  readonly isLive: boolean;
  readonly onRefresh: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isHintShown = useRefreshHint(isRefreshing);
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="mr-auto text-lg font-bold text-foreground">
        <span className="md:hidden">{t("agentsPage.quotas.shortTitle")}</span>
        <span className="hidden md:inline">{t("agentsPage.quotas.title")}</span>
      </h2>
      <p
        role="status"
        className="order-last h-4 w-full text-xs text-muted-foreground md:order-none md:h-auto md:w-auto"
      >
        {isHintShown ? t("agentsPage.status.refreshing") : null}
      </p>
      {isLive ? (
        <span className="inline-flex h-6 items-center gap-1.5 rounded-[7px] border border-border bg-surface px-2 text-[11px] font-semibold text-foreground">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-success"
          />
          {t("agentsPage.status.live")}
        </span>
      ) : null}
      <button
        type="button"
        onClick={onRefresh}
        disabled={isRefreshing}
        aria-label={t("agentsPage.status.refresh")}
        title={t("agentsPage.status.refresh")}
        className="inline-flex size-8 items-center justify-center rounded-[10px] border border-border bg-surface text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground disabled:cursor-default"
      >
        <RefreshCw
          className={cn(
            "size-4",
            isHintShown && "animate-spin motion-reduce:animate-none",
          )}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
