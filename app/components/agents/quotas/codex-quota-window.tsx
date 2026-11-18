import { useTranslation } from "react-i18next";

import { codexWindowLabel } from "./codex-window-label";
import { QuotaWindow } from "./quota-window";

import type { CodexQuotaWindow as ReportedWindow } from "@/definition/CodexQuota";

/**
 * One reported window of a Codex card, named by its reported length.
 * @remarks
 * 300 minutes read "5 Stunden" and 10080 minutes "7 Tage", as on the Claude
 * card; any other length reads in whole days, hours or minutes, and a window
 * without a length reads "Kontingentfenster". The rest is 100 minus the used
 * share, exactly as reported.
 */
export function CodexQuotaWindow({
  quotaWindow,
  now,
  isStale = false,
  staleSince = null,
}: {
  readonly quotaWindow: ReportedWindow;
  readonly now: Date;
  readonly isStale?: boolean;
  readonly staleSince?: string | null;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <QuotaWindow
      figures={{
        kind: quotaWindow.kind,
        label: codexWindowLabel(quotaWindow.durationMinutes, t),
        usedPercentage: quotaWindow.usedPercent,
        resetsAt: quotaWindow.resetsAt,
      }}
      now={now}
      isStale={isStale}
      staleSince={staleSince}
    />
  );
}
