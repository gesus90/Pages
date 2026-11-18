import { useTranslation } from "react-i18next";

/*
 * Branding note: Claude's app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in
 * `assets/providers/` and only scaled here.
 */
import claudeUrl from "@/assets/providers/logo-claude.png?no-inline";

import { ClaudePlanBadge } from "./claude-plan-badge";
import { ClaudeQuotaWindow } from "./claude-quota-window";
import {
  QUOTA_CARD_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import { quotaCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import {
  QuotaBadgePlaceholder,
  QuotaWindowsPlaceholder,
} from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { useRefreshHint } from "./use-refresh-hint";

import type { ClaudeQuotaAccount } from "@/definition/ClaudeQuota";
import type { QuotaCardBody } from "./quota-card-state";

/**
 * The window area of a card: the windows, or the notice in their place.
 * @remarks
 * The area takes the height the card leaves between head and status line,
 * 172 px on a wide card, with 15 px above and below. Two windows fill both
 * 62 px slots with an 18 px gap, five hours first; on a phone the slots are
 * 76 px with 24 px above and below and 20 px between. A single window and a
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
      className={QUOTA_WINDOWS_AREA_CLASS}
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
        <QuotaNotice
          notice={body.notice}
          provider="claude_code"
          hasPlan={hasPlan}
        />
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
 * Logo, name and subtitle come from the connection, so they stand from the
 * first moment. A card without stored figures shows placeholders for plan
 * and windows and "Wird geladen …" until its query answers; a card with
 * stored figures keeps them in full colour while the query runs and only
 * its status line changes, after 400 ms and for at least 600 ms, so a quick
 * answer shows no change. Every card follows its own query.
 */
export function ClaudeQuotaCard({
  account,
  pendingQueries,
  now,
  onRetry,
}: {
  readonly account: ClaudeQuotaAccount;
  /** Queries of exactly this card that have not answered yet. */
  readonly pendingQueries: number;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isQuerying = pendingQueries > 0;
  const view = quotaCardView(account, now);
  const isLoading = view.status.kind === "stored" && view.status.at === null;
  const isHintShown = useRefreshHint(isQuerying && !isLoading);

  function handleRetry(): void {
    onRetry(account.connectionId);
  }

  return (
    <article
      data-quota-card={account.connectionId}
      data-quota-loading={isLoading ? "true" : "false"}
      aria-busy={isQuerying}
      className={QUOTA_CARD_CLASS}
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
        {isLoading ? (
          <QuotaBadgePlaceholder />
        ) : (
          <ClaudePlanBadge plan={account.plan} />
        )}
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <QuotaCardWindows
          body={view.body}
          now={now}
          hasPlan={account.plan !== null}
        />
      )}
      <QuotaStatusLine
        status={view.status}
        now={now}
        source={{ provider: "claude_code" }}
        progress={{ isQuerying, isHintShown }}
        onRetry={handleRetry}
      />
    </article>
  );
}
