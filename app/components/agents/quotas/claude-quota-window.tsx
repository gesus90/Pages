import { useTranslation } from "react-i18next";

import { QuotaWindow } from "./quota-window";

import type { ClaudeQuotaWindow as ReportedWindow } from "@/definition/ClaudeQuota";

/**
 * One reported window of a Claude card, five hours or seven days.
 * @remarks
 * The window is the shared {@link QuotaWindow}; Claude names its two windows
 * by their kind.
 */
export function ClaudeQuotaWindow({
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
        label: t(`agentsPage.window.${quotaWindow.kind}`),
        usedPercentage: quotaWindow.usedPercentage,
        resetsAt: quotaWindow.resetsAt,
      }}
      now={now}
      isStale={isStale}
      staleSince={staleSince}
    />
  );
}
