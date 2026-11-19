import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  claudeQuotaTone,
  remainingWholePercentage,
  usedWholePercentage,
} from "@/definition/ClaudeQuota";

import {
  QUOTA_BAR_CLASSES,
  QUOTA_COMPACT_WINDOW_SLOT_CLASS,
  QUOTA_FIGURES_RUN_MILLISECONDS,
  QUOTA_WINDOW_SLOT_CLASS,
} from "./quota-card-layout";
import {
  formatQuotaCountdown,
  formatQuotaMoment,
  formatQuotaStand,
} from "./quota-time";
import { useAnimatedNumber } from "./use-animated-number";

import type { ClaudeQuotaTone } from "@/definition/ClaudeQuota";

/** The colour of "x % übrig": greyed after a failed query, red below 10 %. */
function remainingClass(tone: ClaudeQuotaTone, isStale: boolean): string {
  if (isStale) return "text-muted-foreground";
  return tone === "destructive" ? "text-destructive" : "text-foreground";
}

/**
 * One reported window of a card: what is left, the bar, the reset and what
 * is used.
 * @remarks
 * The window fills a slot of the card, 62 px on a wide card and 76 px on a
 * phone, and is the same for every provider. The bar fills with the
 * remaining share on a muted track, so a used-up window shows an empty bar
 * and "0 % übrig". Only a remaining share below 10 % colours the figure. New
 * figures run in within 300 ms, the bar by its width and the numbers by
 * counting, and stand still at once where the reader asks for less motion.
 * After a failed query the figures stay, greyed, and `staleSince` names the
 * time of the last answer beside the used share. A window without a reset
 * shows no reset line. A compact window is 48 px high, for a card that lists
 * three windows; `usedLabel` replaces "x % genutzt" where the provider
 * reports its own counts.
 */
export function QuotaWindow({
  figures,
  now,
  isStale = false,
  staleSince = null,
  isCompact = false,
}: {
  readonly figures: {
    /** Names the window in the markup, such as `five_hour` or `primary`. */
    readonly kind: string;
    readonly label: string;
    /** Used share, 0 to 100. */
    readonly usedPercentage: number;
    /** ISO time at which the window resets, `null` when none was named. */
    readonly resetsAt: string | null;
    /** Names the used amount in the provider's own counts instead of the share. */
    readonly usedLabel?: string;
  };
  readonly now: Date;
  readonly isStale?: boolean;
  readonly staleSince?: string | null;
  readonly isCompact?: boolean;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const { label } = figures;
  const used = usedWholePercentage(figures.usedPercentage);
  const remaining = remainingWholePercentage(figures.usedPercentage);
  const shownUsed = useAnimatedNumber(used, QUOTA_FIGURES_RUN_MILLISECONDS);
  const tone = claudeQuotaTone(remaining);
  const format = { t, language: i18n.language };
  const reset =
    figures.resetsAt === null
      ? ""
      : t("agentsPage.quota.resets", {
          moment: formatQuotaMoment(new Date(figures.resetsAt), now, format),
          countdown: formatQuotaCountdown(
            new Date(figures.resetsAt).getTime() - now.getTime(),
            t,
          ),
        });
  const usedText =
    figures.usedLabel ?? t("agentsPage.quota.used", { percent: shownUsed });
  const sideText =
    isStale && staleSince !== null
      ? t("agentsPage.quota.staleUsed", {
          time: formatQuotaStand(new Date(staleSince), now, format),
          used: usedText,
        })
      : usedText;

  return (
    <section
      className={
        isCompact ? QUOTA_COMPACT_WINDOW_SLOT_CLASS : QUOTA_WINDOW_SLOT_CLASS
      }
      data-quota-window={figures.kind}
      data-quota-stale={isStale ? "true" : "false"}
      aria-label={label}
    >
      <div className="flex h-5 items-center justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-foreground">{label}</h4>
        <span
          data-quota-tone={tone}
          className={cn(
            "text-[15px] font-bold whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
            remainingClass(tone, isStale),
          )}
        >
          {t("agentsPage.quota.remaining", { percent: 100 - shownUsed })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("agentsPage.quota.remainingLabel", { window: label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining}
        className="h-2.5 shrink-0 overflow-hidden rounded-[5px] bg-muted"
      >
        <div
          data-quota-bar={isStale ? "stale" : tone}
          className={cn(
            "h-full rounded-[5px] transition-[width,background-color,opacity] duration-300 ease-out motion-reduce:transition-none",
            isStale
              ? "bg-muted-foreground opacity-55"
              : QUOTA_BAR_CLASSES[tone],
          )}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <div className="flex h-4 items-center justify-between gap-3 text-xs leading-4 text-muted-foreground">
        <span className="min-w-0 truncate" title={reset}>
          {reset}
        </span>
        <span className="shrink-0 whitespace-nowrap">{sideText}</span>
      </div>
    </section>
  );
}
