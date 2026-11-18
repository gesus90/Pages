import { useTranslation } from "react-i18next";

/*
 * Branding note: the ChatGPT app icon names the vendor of the subscription
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import chatgptUrl from "@/assets/providers/logo-chatgpt.png?no-inline";

import { CodexPlanBadge } from "./codex-plan-badge";
import { CodexQuotaWindow } from "./codex-quota-window";
import {
  QUOTA_CARD_CLASS,
  QUOTA_WINDOWS_AREA_CLASS,
} from "./quota-card-layout";
import { codexCardView } from "./quota-card-state";
import { QuotaNotice } from "./quota-notice";
import {
  QuotaBadgePlaceholder,
  QuotaWindowsPlaceholder,
} from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { useRefreshHint } from "./use-refresh-hint";

import type { CodexQuotaAccount } from "@/definition/CodexQuota";
import type { CodexCardBody } from "./quota-card-state";

/**
 * The window area of a Codex card: the windows, or the notice in their place.
 * @remarks
 * It is the area of the Claude card: it takes the height between head and
 * status line, and one window or a notice stands centred in it, so nothing
 * greyed holds the place of a missing window. `primary` stands before
 * `secondary`.
 */
function CodexCardWindows({
  body,
  now,
  hasPlan,
}: {
  readonly body: CodexCardBody;
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
          <CodexQuotaWindow
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
          provider="codex_cli"
          hasPlan={hasPlan}
        />
      )}
    </div>
  );
}

/**
 * The card of one Codex connection: its name, the ChatGPT subscription, the
 * windows of the general Codex quota and what happened at the last query.
 * @remarks
 * It has the form of the Claude card: the 44 px head with a 32 px ChatGPT
 * logo, the connection name, "ChatGPT-Abo" and the plan badge, the window
 * area and the 48 px status line, in a card of the same size. A window the
 * app server did not report is not shown, and one whose reset passed leaves
 * the card. A card without stored figures shows placeholders and "Wird
 * geladen …" until its query answers; a card with stored figures keeps them
 * in full colour while the query runs, and after a failed query it greys
 * them and names the time of the last answer.
 */
export function CodexQuotaCard({
  account,
  pendingQueries,
  now,
  onRetry,
}: {
  readonly account: CodexQuotaAccount;
  /** Queries of exactly this card that have not answered yet. */
  readonly pendingQueries: number;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isQuerying = pendingQueries > 0;
  const view = codexCardView(account, now);
  const isLoading = view.status.kind === "stored" && view.status.at === null;
  const isHintShown = useRefreshHint(isQuerying && !isLoading);

  function handleRetry(): void {
    onRetry(account.connectionId);
  }

  return (
    <article
      data-quota-card={account.connectionId}
      data-quota-provider="codex_cli"
      data-quota-loading={isLoading ? "true" : "false"}
      aria-busy={isQuerying}
      className={QUOTA_CARD_CLASS}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <img
          src={chatgptUrl}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.card.codex")}
          </p>
        </div>
        {isLoading ? (
          <QuotaBadgePlaceholder isWide />
        ) : (
          <CodexPlanBadge plan={account.plan} />
        )}
      </header>
      {isLoading ? (
        <QuotaWindowsPlaceholder />
      ) : (
        <CodexCardWindows
          body={view.body}
          now={now}
          hasPlan={account.plan !== null}
        />
      )}
      <QuotaStatusLine
        status={view.status}
        now={now}
        source={{ provider: "codex_cli", generalLimit: view.limit }}
        progress={{ isQuerying, isHintShown }}
        onRetry={handleRetry}
      />
    </article>
  );
}
