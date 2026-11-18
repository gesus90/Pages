import { useTranslation } from "react-i18next";

import { visibleClaudeQuotaWindows } from "@/definition/ClaudeQuota";

/*
 * Branding note: Claude's app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in
 * `assets/providers/` and only scaled here.
 */
import claudeUrl from "@/assets/providers/logo-claude.png?no-inline";

import { ClaudePlanBadge } from "./claude-plan-badge";
import { ClaudeQuotaWindow } from "./claude-quota-window";

import type { ClaudeQuotaAccount } from "@/definition/ClaudeQuota";

/**
 * The card of one Claude connection: its name, the subscription and every
 * window Claude reported, five hours before seven days.
 * @remarks
 * A window Claude did not report is not shown at all, and one whose reset
 * passed leaves the card. Without any window the card says when values
 * appear instead of showing a bar.
 */
export function ClaudeQuotaCard({
  account,
  now,
}: {
  readonly account: ClaudeQuotaAccount;
  readonly now: Date;
}): React.ReactElement {
  const { t } = useTranslation();
  const windows = visibleClaudeQuotaWindows(account.windows, now);
  return (
    <article
      data-quota-card={account.connectionId}
      className="min-w-0 rounded-[20px] border border-border bg-surface p-4 md:rounded-3xl md:px-6 md:py-[22px]"
    >
      <header className="flex h-11 items-center gap-3">
        <img
          src={claudeUrl}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.card.subscription")}
          </p>
        </div>
        <ClaudePlanBadge plan={account.plan} />
      </header>
      {windows.length > 0 ? (
        windows.map((quotaWindow) => (
          <ClaudeQuotaWindow
            key={quotaWindow.kind}
            quotaWindow={quotaWindow}
            now={now}
          />
        ))
      ) : (
        <p className="mt-5 text-[13px] text-muted-foreground">
          {t("agentsPage.card.noValues")}
        </p>
      )}
    </article>
  );
}
