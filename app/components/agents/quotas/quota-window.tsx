import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import { claudeQuotaTone, usedWholePercentage } from "@/definition/ClaudeQuota";
import { quotaForecast } from "@/definition/QuotaForecast";

import {
  QUOTA_COMPACT_WINDOW_SLOT_CLASS,
  QUOTA_FIGURES_RUN_MILLISECONDS,
  QUOTA_WINDOW_SLOT_CLASS,
} from "./quota-card-layout";
import {
  QuotaForecastLabel,
  QuotaProgress,
  QuotaTargetLegend,
} from "./quota-forecast-details";
import { formatQuotaReset, formatQuotaStand } from "./quota-time";
import { useAnimatedNumber } from "./use-animated-number";

import type {
  QuotaForecast,
  QuotaFrame,
  QuotaPace,
} from "@/definition/QuotaForecast";

interface QuotaWindowFigures extends QuotaFrame {
  readonly kind: string;
  readonly label: string;
  readonly usedPercentage: number;
  readonly usedLabel?: string;
  readonly pace?: QuotaPace;
}

interface QuotaWindowProps {
  readonly figures: QuotaWindowFigures;
  readonly now: Date;
  readonly isStale?: boolean;
  readonly staleSince?: string | null;
  readonly isCompact?: boolean;
}

interface WindowFooterProps {
  readonly reset: { readonly full: string; readonly short: string };
  readonly usedText: string;
  readonly target: number | null;
  readonly isCompact: boolean;
}

function QuotaWindowFooter({
  reset,
  usedText,
  target,
  isCompact,
}: WindowFooterProps): React.ReactElement {
  return (
    <div
      className={cn(
        "text-xs leading-4 text-muted-foreground",
        isCompact
          ? "flex h-4 items-center justify-between gap-2"
          : "grid h-[30px] grid-cols-[minmax(0,1fr)_auto] grid-rows-[16px_14px] items-center gap-x-2 md:flex md:h-4 md:justify-between",
      )}
    >
      <span className="min-w-0 truncate" title={reset.full}>
        <span className="@min-[440px]:hidden">{reset.short}</span>
        <span className="hidden @min-[440px]:inline">{reset.full}</span>
      </span>
      <span
        className={cn(
          "min-w-0 items-center justify-end gap-1",
          isCompact ? "flex" : "contents md:flex",
        )}
      >
        {target === null ? null : (
          <QuotaTargetLegend
            target={target}
            className={isCompact ? undefined : "col-start-1 row-start-2"}
            hasSeparator={isCompact ? "always" : "desktop"}
          />
        )}
        <span
          className="col-start-2 row-start-1 min-w-0 truncate"
          title={usedText}
        >
          {usedText}
        </span>
      </span>
    </div>
  );
}

function QuotaWindowHeading({
  label,
  remaining,
  shownRemaining,
  projection,
  canShowLabel,
  isCompact,
}: {
  readonly label: string;
  readonly remaining: number;
  readonly shownRemaining: number;
  readonly projection: QuotaForecast;
  readonly canShowLabel: boolean;
  readonly isCompact: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2",
        isCompact ? "h-[18px]" : "h-5",
      )}
    >
      <h4
        className="min-w-0 max-w-[58%] shrink-0 truncate text-[13px] font-semibold text-foreground"
        title={label}
      >
        {label}
      </h4>
      {canShowLabel ? (
        <QuotaForecastLabel
          forecast={projection.forecast}
          variant="window"
          isCompact={isCompact}
        />
      ) : null}
      <span
        data-quota-tone={claudeQuotaTone(remaining)}
        className={cn(
          "ml-auto shrink-0 whitespace-nowrap font-bold transition-colors duration-300 motion-reduce:transition-none",
          isCompact ? "text-sm" : "text-[15px]",
          projection.isStale && "text-muted-foreground",
          !projection.isStale && remaining < 10 && "text-destructive",
        )}
      >
        {t("agentsPage.quota.remaining", { percent: shownRemaining })}
      </span>
    </div>
  );
}

/** Shows one provider window on the common remaining-quota scale. */
export function QuotaWindow({
  figures,
  now,
  isStale = false,
  staleSince = null,
  isCompact = false,
}: QuotaWindowProps): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { label, usedPercentage, resetsAt, pace } = figures;
  const measuredRemaining = 100 - usedPercentage;
  const used = Math.min(
    usedPercentage < 100 ? 99 : 100,
    usedWholePercentage(usedPercentage),
  );
  const remaining = 100 - used;
  const shownUsed = useAnimatedNumber(used, QUOTA_FIGURES_RUN_MILLISECONDS);
  const projection = quotaForecast({
    ...figures,
    now: now.getTime(),
    remaining: measuredRemaining,
    isStale,
    isExhausted: remaining === 0,
  });
  const format = { t, language: i18n.language };
  const reset = formatQuotaReset(resetsAt, now, format);
  const usedText =
    figures.usedLabel ?? t("agentsPage.quota.used", { percent: shownUsed });
  const lastMeasurement = pace?.measuredAt ?? staleSince;
  const sideText =
    projection.isStale && lastMeasurement !== null
      ? t("agentsPage.quota.staleUsed", {
          time: formatQuotaStand(new Date(lastMeasurement), now, format),
          used: usedText,
        })
      : usedText;
  const canShowLabel =
    resetsAt !== null || projection.forecast.kind === "paused";

  return (
    <section
      className={cn(
        "@container",
        isCompact ? QUOTA_COMPACT_WINDOW_SLOT_CLASS : QUOTA_WINDOW_SLOT_CLASS,
        !isCompact && "gap-2 md:gap-2.5",
      )}
      data-quota-window={figures.kind}
      data-quota-stale={projection.isStale ? "true" : "false"}
      aria-label={label}
    >
      <QuotaWindowHeading
        label={label}
        remaining={remaining}
        shownRemaining={100 - shownUsed}
        projection={projection}
        canShowLabel={canShowLabel}
        isCompact={isCompact}
      />
      <QuotaProgress
        label={t("agentsPage.quota.remainingLabel", { window: label })}
        remaining={remaining}
        measuredRemaining={measuredRemaining}
        projection={projection}
      />
      <QuotaWindowFooter
        reset={reset}
        usedText={sideText}
        target={projection.target}
        isCompact={isCompact}
      />
    </section>
  );
}
