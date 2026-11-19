import { useTranslation } from "react-i18next";

import { QuotaWindow } from "./quota-window";
import { zaiWindowLabel } from "./zai-window-label";

import type { ZaiQuotaWindow as ReportedWindow } from "@/definition/ZaiQuota";

/**
 * One reported entry of a Z.AI card, named by its type and reported length.
 * @remarks
 * The rest is 100 minus the used share, exactly as reported. An MCP entry
 * that reports its used and total numbers names them beside the share; an
 * entry without a reset shows no reset line, and an entry whose length Z.AI
 * does not name carries only its type.
 */
export function ZaiQuotaWindow({
  quotaWindow,
  now,
  state,
}: {
  readonly quotaWindow: ReportedWindow;
  readonly now: Date;
  readonly state: {
    /** After a failed query the figures stay, greyed. */
    readonly isStale: boolean;
    readonly staleSince: string | null;
    /** Whether the card lists three windows and uses the compact slot. */
    readonly isCompact: boolean;
  };
}): React.ReactElement {
  const { t } = useTranslation();
  const { counts } = quotaWindow;
  return (
    <QuotaWindow
      figures={{
        kind: quotaWindow.kind,
        label: zaiWindowLabel(quotaWindow, t),
        usedPercentage: quotaWindow.usedPercent,
        resetsAt: quotaWindow.resetsAt,
        usedLabel: counts
          ? t("agentsPage.zai.counts", {
              used: counts.used,
              total: counts.total,
            })
          : undefined,
      }}
      now={now}
      isStale={state.isStale}
      staleSince={state.staleSince}
      isCompact={state.isCompact}
    />
  );
}
