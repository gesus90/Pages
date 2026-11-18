import { RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";

import { formatQuotaAge, formatQuotaClock } from "./quota-time";

import type { TFunction } from "i18next";
import type { ClaudeQuotaState } from "./use-claude-quotas";

interface QuotaStatus {
  readonly text: string;
  readonly isWarning: boolean;
}

/** What the header says about the figures: refreshing, failed or their age. */
function quotaStatus(
  state: ClaudeQuotaState,
  now: Date,
  context: { readonly t: TFunction; readonly language: string },
): QuotaStatus | null {
  const { t, language } = context;
  if (state.pendingQueries > 0)
    return { text: t("agentsPage.status.refreshing"), isWarning: false };
  if (state.failedAt !== null && state.receivedAt !== null)
    return {
      text: t("agentsPage.status.failedSince", {
        time: formatQuotaClock(new Date(state.receivedAt), language),
      }),
      isWarning: true,
    };
  if (state.failedAt !== null)
    return { text: t("agentsPage.status.failed"), isWarning: true };
  if (state.receivedAt === null) return null;
  return {
    text: formatQuotaAge(now.getTime() - state.receivedAt, t),
    isWarning: false,
  };
}

/**
 * The head of the section "Kontingente und Guthaben": the heading, the age of
 * the figures, the live badge and the refresh button.
 * @remarks
 * On a narrow screen the status moves under the heading. The live badge
 * shows while the server's push stream is open. The button queries once
 * without moving the minute beat; its icon turns while a query runs.
 */
export function QuotaSectionHeader({
  state,
  now,
  onRefresh,
}: {
  readonly state: ClaudeQuotaState;
  readonly now: Date;
  readonly onRefresh: () => void;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const status = quotaStatus(state, now, { t, language: i18n.language });
  const isRefreshing = state.pendingQueries > 0;
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
      <h2 className="mr-auto text-lg font-bold text-foreground">
        <span className="md:hidden">{t("agentsPage.quotas.shortTitle")}</span>
        <span className="hidden md:inline">{t("agentsPage.quotas.title")}</span>
      </h2>
      <p
        data-quota-status={status?.isWarning ? "warning" : "normal"}
        className={cn(
          "order-last w-full text-xs md:order-none md:w-auto",
          status?.isWarning ? "text-warning" : "text-muted-foreground",
        )}
      >
        {status?.text}
      </p>
      {state.isLive ? (
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
          className={cn("size-4", isRefreshing && "animate-spin")}
          aria-hidden="true"
        />
      </button>
    </div>
  );
}
