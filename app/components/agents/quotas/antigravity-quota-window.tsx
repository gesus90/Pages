import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  isAntigravityWindowExhausted,
  remainingQuotaPercentage,
} from "@/definition/AntigravityQuota";
import { claudeQuotaTone } from "@/definition/ClaudeQuota";
import { FIXED_QUOTA_MINUTES, quotaForecast } from "@/definition/QuotaForecast";

import { QUOTA_FIGURES_RUN_MILLISECONDS } from "./quota-card-layout";
import {
  QuotaForecastLabel,
  QuotaProgress,
  QuotaTargetLegend,
} from "./quota-forecast-details";
import { formatQuotaReset } from "./quota-time";
import { useAnimatedNumber } from "./use-animated-number";

import type { AntigravityQuotaWindow as QuotaWindow } from "@/definition/AntigravityQuota";

interface AntigravityQuotaWindowProps {
  readonly quotaWindow: QuotaWindow;
  readonly groupLabel: string;
  readonly now: Date;
  readonly isStale: boolean;
}

/** Shows one window in a narrow Antigravity column. */
export function AntigravityQuotaWindow({
  quotaWindow,
  groupLabel,
  now,
  isStale,
}: AntigravityQuotaWindowProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const remaining = remainingQuotaPercentage(quotaWindow.remainingFraction);
  const shownRemaining = useAnimatedNumber(
    remaining,
    QUOTA_FIGURES_RUN_MILLISECONDS,
  );
  const isExhausted = isAntigravityWindowExhausted(quotaWindow);
  const label = t(`agentsPage.window.${quotaWindow.kind}`);
  const reset = formatQuotaReset(quotaWindow.resetsAt, now, {
    t,
    language: i18n.language,
  });
  const measuredRemaining = quotaWindow.remainingFraction * 100;
  const projection = quotaForecast({
    resetsAt: quotaWindow.resetsAt,
    durationMinutes: FIXED_QUOTA_MINUTES[quotaWindow.kind],
    pace: quotaWindow.pace,
    now: now.getTime(),
    remaining: measuredRemaining,
    isStale,
    isExhausted,
  });
  const canShowLabel =
    quotaWindow.resetsAt !== null || projection.forecast.kind === "paused";

  return (
    <div
      data-quota-window={quotaWindow.kind}
      data-quota-exhausted={isExhausted ? "true" : "false"}
      data-quota-stale={projection.isStale ? "true" : "false"}
      className="@container flex min-w-0 flex-col"
    >
      <div className="mb-1.5 flex h-4 shrink-0 items-center justify-between gap-2">
        <h5 className="truncate text-xs font-semibold text-muted-foreground">
          {label}
        </h5>
        <span
          data-quota-tone={claudeQuotaTone(remaining)}
          className={cn(
            "text-sm font-bold whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
            projection.isStale && "text-muted-foreground",
            !projection.isStale && isExhausted && "text-destructive",
          )}
        >
          <span className="@min-[210px]:hidden">
            {t("agentsPage.antigravity.remainingShort", {
              percent: shownRemaining,
            })}
          </span>
          <span className="hidden @min-[210px]:inline">
            {t("agentsPage.quota.remaining", { percent: shownRemaining })}
          </span>
        </span>
      </div>
      <QuotaProgress
        label={t("agentsPage.antigravity.remainingLabel", {
          group: groupLabel,
          window: label,
        })}
        remaining={remaining}
        measuredRemaining={measuredRemaining}
        projection={projection}
        isNarrow
      />
      <p
        className="mt-[5px] h-3.5 truncate text-[11.5px] leading-3.5 text-muted-foreground"
        title={reset.full}
      >
        <span className="@min-[210px]:hidden">{reset.short}</span>
        <span className="hidden @min-[210px]:inline">{reset.full}</span>
      </p>
      <div className="mt-[3px] flex h-3.5 items-center gap-1 text-[11px] leading-3.5 text-muted-foreground">
        {projection.target === null ? null : (
          <QuotaTargetLegend target={projection.target} isNarrow />
        )}
        {canShowLabel ? (
          <div
            className={cn(
              "flex min-w-0",
              projection.target !== null && "ml-auto",
            )}
          >
            <QuotaForecastLabel
              forecast={projection.forecast}
              variant="group"
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
