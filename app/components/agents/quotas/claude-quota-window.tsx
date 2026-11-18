import { useTranslation } from "react-i18next";

import { cn } from "@/app/lib/cn";
import {
  claudeQuotaTone,
  remainingWholePercentage,
  usedWholePercentage,
} from "@/definition/ClaudeQuota";

import { formatQuotaCountdown, formatQuotaResetMoment } from "./quota-time";

import type {
  ClaudeQuotaTone,
  ClaudeQuotaWindow as QuotaWindow,
} from "@/definition/ClaudeQuota";

/** The fill of the bar for each tone; static, so Tailwind finds the classes. */
const BAR_CLASSES: Readonly<Record<ClaudeQuotaTone, string>> = {
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
};

/**
 * One reported window of a Claude card: what is left, the bar, the reset
 * and what is used.
 * @remarks
 * The bar fills with the remaining share on a muted track, so a used-up
 * window shows an empty bar and "0 % übrig". Only a remaining share below
 * 10 % colours the figure.
 */
export function ClaudeQuotaWindow({
  quotaWindow,
  now,
}: {
  readonly quotaWindow: QuotaWindow;
  readonly now: Date;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const used = usedWholePercentage(quotaWindow.usedPercentage);
  const remaining = remainingWholePercentage(quotaWindow.usedPercentage);
  const tone = claudeQuotaTone(remaining);
  const label = t(`agentsPage.window.${quotaWindow.kind}`);
  const resetsAt = new Date(quotaWindow.resetsAt);
  const reset = t("agentsPage.quota.resets", {
    moment: formatQuotaResetMoment(resetsAt, now, {
      t,
      language: i18n.language,
    }),
    countdown: formatQuotaCountdown(resetsAt.getTime() - now.getTime(), t),
  });

  return (
    <section
      className="mt-5"
      data-quota-window={quotaWindow.kind}
      aria-label={label}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-[13px] font-semibold text-foreground">{label}</h4>
        <span
          data-quota-tone={tone}
          className={cn(
            "text-[15px] font-bold whitespace-nowrap",
            tone === "destructive" ? "text-destructive" : "text-foreground",
          )}
        >
          {t("agentsPage.quota.remaining", { percent: remaining })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t("agentsPage.quota.remainingLabel", { window: label })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining}
        className="mt-2 h-2.5 overflow-hidden rounded-[5px] bg-muted"
      >
        <div
          className={cn("h-full rounded-[5px]", BAR_CLASSES[tone])}
          style={{ width: `${remaining}%` }}
        />
      </div>
      <div className="mt-2 flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0">{reset}</span>
        <span className="shrink-0 whitespace-nowrap">
          {t("agentsPage.quota.used", { percent: used })}
        </span>
      </div>
    </section>
  );
}
