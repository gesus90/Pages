import { useTranslation } from "react-i18next";

/*
 * Branding note: Claude's app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in
 * `assets/providers/` and only scaled here.
 */
import claudeUrl from "@/assets/providers/logo-claude.png?no-inline";

import { ClaudePlanBadge } from "./claude-plan-badge";
import { ClaudeQuotaWindow } from "./claude-quota-window";
import { quotaCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import { QuotaStatusLine } from "./quota-status-line";

import type { ClaudeQuotaAccount } from "@/definition/ClaudeQuota";
import type { QuotaCardBody } from "./quota-card-state";

/**
 * The window area of a card: the windows, or the notice in their place.
 * @remarks
 * The area takes the height the card leaves between head and status line,
 * 172 px on a wide card, with 15 px above and below. Two windows fill both
 * 62 px slots with an 18 px gap, five hours first; a single window and a
 * notice stand centred, so nothing greyed holds the place of a missing
 * window.
 */
function QuotaCardWindows({
  body,
  now,
  hasPlan,
}: {
  readonly body: QuotaCardBody;
  readonly now: Date;
  readonly hasPlan: boolean;
}): React.ReactElement {
  return (
    <div
      data-quota-windows={
        body.kind === "windows" ? body.windows.length : "notice"
      }
      className="flex min-h-0 flex-1 flex-col justify-center gap-[18px] overflow-hidden py-[15px]"
    >
      {body.kind === "windows" ? (
        body.windows.map((quotaWindow) => (
          <ClaudeQuotaWindow
            key={quotaWindow.kind}
            quotaWindow={quotaWindow}
            now={now}
            isStale={body.isStale}
            staleSince={body.staleSince}
          />
        ))
      ) : (
        <QuotaNotice notice={body.notice} hasPlan={hasPlan} />
      )}
    </div>
  );
}

/**
 * The card of one Claude connection: its name, the subscription, every
 * window Claude reported and what happened at the last query.
 * @remarks
 * Every card has the same size whatever it holds, so the status lines of a
 * row stand on one line; the grid sets the height. The outline is drawn
 * inside the card and takes no room, so head, window area and status line
 * add up to the card's height exactly. A window Claude did not
 * report is not shown at all, and one whose reset passed leaves the card.
 */
export function ClaudeQuotaCard({
  account,
  now,
  isRefreshing,
  onRetry,
}: {
  readonly account: ClaudeQuotaAccount;
  readonly now: Date;
  readonly isRefreshing: boolean;
  readonly onRetry: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const view = quotaCardView(account, now);
  return (
    <article
      data-quota-card={account.connectionId}
      className="flex h-full min-w-0 flex-col overflow-hidden rounded-[20px] bg-surface px-4 py-4 ring-1 ring-border ring-inset md:rounded-3xl md:px-6 md:py-[22px]"
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
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
      <QuotaCardWindows
        body={view.body}
        now={now}
        hasPlan={account.plan !== null}
      />
      <QuotaStatusLine
        status={view.status}
        now={now}
        isRefreshing={isRefreshing}
        onRetry={onRetry}
      />
    </article>
  );
}
