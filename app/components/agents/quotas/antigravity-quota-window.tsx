import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  isAntigravityWindowExhausted,
  remainingQuotaPercentage,
} from "@/definition/AntigravityQuota";
import { claudeQuotaTone } from "@/definition/ClaudeQuota";

import {
  QUOTA_BAR_CLASSES,
  QUOTA_FIGURES_RUN_MILLISECONDS,
} from "./quota-card-layout";
import { formatQuotaCountdown, formatQuotaMoment } from "./quota-time";
import { useAnimatedNumber } from "./use-animated-number";

import type { TFunction } from "i18next";
import type { AntigravityQuotaWindow as QuotaWindow } from "@/definition/AntigravityQuota";

/**
 * The reset of a window in its two lengths: with the countdown on a wide
 * card, without it on a phone.
 * @returns `null` when Antigravity named no reset.
 */
function resetTexts(
  resetsAt: string | null,
  now: Date,
  context: { readonly t: TFunction; readonly language: string },
): { readonly full: string; readonly short: string } | null {
  if (resetsAt === null) return null;
  const { t } = context;
  const moment = formatQuotaMoment(new Date(resetsAt), now, context);
  const countdown = formatQuotaCountdown(
    Date.parse(resetsAt) - now.getTime(),
    t,
  );
  return {
    full: t("agentsPage.quota.resets", { moment, countdown }),
    short: t("agentsPage.antigravity.resetsShort", { moment }),
  };
}

/** The colour of the figure: greyed after a failed query, red only without a rest. */
function figureClass(isStale: boolean, isExhausted: boolean): string {
  if (isStale) return "text-muted-foreground";
  return isExhausted ? "text-destructive" : "text-foreground";
}

/**
 * One reported window of a group: its name, what is left, the bar and the
 * reset.
 * @remarks
 * The figure is the rest as Antigravity reported it. Only a window with
 * nothing left reads "0 % übrig" in the destructive colour, and its bar
 * stands empty; the other windows keep their figures. On a phone the figure
 * is "x %" and the reset "zurück 18:57" without the countdown. New figures
 * run in within 300 ms, the bar by its width and the number by counting, and
 * stand still at once where the reader asks for less motion. After a failed
 * query the figures stay, greyed.
 */
export function AntigravityQuotaWindow({
  quotaWindow,
  groupLabel,
  now,
  isStale,
}: {
  readonly quotaWindow: QuotaWindow;
  /** The name of the group, which the progress bar names for assistive tools. */
  readonly groupLabel: string;
  readonly now: Date;
  readonly isStale: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const remaining = remainingQuotaPercentage(quotaWindow.remainingFraction);
  const shownRemaining = useAnimatedNumber(
    remaining,
    QUOTA_FIGURES_RUN_MILLISECONDS,
  );
  const isExhausted = isAntigravityWindowExhausted(quotaWindow);
  const tone = claudeQuotaTone(remaining);
  const label = t(`agentsPage.window.${quotaWindow.kind}`);
  const reset = resetTexts(quotaWindow.resetsAt, now, {
    t,
    language: i18n.language,
  });

  return (
    <div
      data-quota-window={quotaWindow.kind}
      data-quota-exhausted={isExhausted ? "true" : "false"}
      data-quota-stale={isStale ? "true" : "false"}
      className="flex min-w-0 flex-col gap-1.5 md:gap-1"
    >
      <div className="flex h-[18px] items-center justify-between gap-2 md:h-4">
        <h5 className="truncate text-xs font-semibold text-muted-foreground">
          {label}
        </h5>
        <span
          data-quota-tone={isExhausted ? "destructive" : tone}
          className={cn(
            "text-sm font-bold whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
            figureClass(isStale, isExhausted),
          )}
        >
          <span className="md:hidden">
            {t("agentsPage.antigravity.remainingShort", {
              percent: shownRemaining,
            })}
          </span>
          <span className="hidden md:inline">
            {t("agentsPage.quota.remaining", { percent: shownRemaining })}
          </span>
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("agentsPage.antigravity.remainingLabel", {
          group: groupLabel,
          window: label,
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining}
        className="h-2 shrink-0 overflow-hidden rounded-[4px] bg-muted"
      >
        <div
          data-quota-bar={isStale ? "stale" : tone}
          className={cn(
            "h-full rounded-[4px] transition-[width,background-color,opacity] duration-300 ease-out motion-reduce:transition-none",
            isStale
              ? "bg-muted-foreground opacity-55"
              : QUOTA_BAR_CLASSES[tone],
          )}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <p className="h-3.5 truncate text-[11.5px] leading-3.5 text-muted-foreground">
        <span className="md:hidden">{reset?.short}</span>
        <span className="hidden md:inline" title={reset?.full}>
          {reset?.full}
        </span>
      </p>
    </div>
  );
}
