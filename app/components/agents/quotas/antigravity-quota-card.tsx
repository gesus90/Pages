import { useTranslation } from "react-i18next";

/*
 * Branding note: Antigravity's app icon names the tool of the connection
 * beside its written name; the file is kept unchanged in `assets/providers/`
 * and only scaled here.
 */
import antigravityUrl from "@/assets/providers/logo-antigravity.png?no-inline";

import { AntigravityGroupArea } from "./antigravity-group-area";
import { antigravityGroupLabel } from "./antigravity-group-label";
import { QUOTA_CARD_CLASS, VISIBLE_GROUPS } from "./quota-card-layout";
import { antigravityCardView } from "./quota-card-state";
import { QuotaGroupsPlaceholder } from "./quota-placeholders";
import { QuotaStatusLine } from "./quota-status-line";
import { useRefreshHint } from "./use-refresh-hint";

import type { AntigravityQuotaAccount } from "@/definition/AntigravityQuota";
import type { StatusLimit } from "./quota-status-presentation";

/**
 * The card of one Antigravity connection: its name, the model groups
 * Antigravity reported and what happened at the last query.
 * @remarks
 * It is the card of the Claude connections with another logo, another
 * subtitle and groups instead of windows, and the same size: the head is
 * 44 px, the status line 48 px, and the card keeps its height whatever it
 * holds. The answer names no subscription, so the head shows no plan badge;
 * with more than two groups it shows "n Gruppen" on the right. A group or
 * window Antigravity did not report is not shown, and one whose reset passed
 * leaves the card. A window without a rest keeps its mark at the window, and
 * the status line names it together with its group, also when the group is
 * out of sight in the scrolled list. A card without stored figures shows
 * placeholders and "Wird geladen …" until its query answers; a card with
 * stored figures keeps them in full colour while the query runs.
 */
export function AntigravityQuotaCard({
  account,
  pendingQueries,
  now,
  onRetry,
}: {
  readonly account: AntigravityQuotaAccount;
  /** Queries of exactly this card that have not answered yet. */
  readonly pendingQueries: number;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isQuerying = pendingQueries > 0;
  const view = antigravityCardView(account, now);
  const isLoading = view.status.kind === "stored" && view.status.at === null;
  const isHintShown = useRefreshHint(isQuerying && !isLoading);
  const groupCount = view.body.kind === "groups" ? view.body.groups.length : 0;
  const limit: StatusLimit | null = view.limit
    ? {
        group: antigravityGroupLabel(view.limit.groupName, t),
        window: view.limit.window.kind,
        resetsAt: view.limit.window.resetsAt,
      }
    : null;

  function handleRetry(): void {
    onRetry(account.connectionId);
  }

  return (
    <article
      data-quota-card={account.connectionId}
      data-quota-provider="antigravity"
      data-quota-loading={isLoading ? "true" : "false"}
      aria-busy={isQuerying}
      className={QUOTA_CARD_CLASS}
    >
      <header className="flex h-11 shrink-0 items-center gap-3">
        <img
          src={antigravityUrl}
          alt=""
          draggable={false}
          className="size-8 shrink-0 rounded-[9px]"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-foreground">
            {account.name}
          </h3>
          <p className="truncate text-xs text-muted-foreground">
            {t("agentsPage.card.antigravity")}
          </p>
        </div>
        {groupCount > VISIBLE_GROUPS ? (
          <p
            data-quota-group-count={groupCount}
            className="shrink-0 text-xs font-semibold text-muted-foreground"
          >
            {t("agentsPage.antigravity.groupCount", { count: groupCount })}
          </p>
        ) : null}
      </header>
      {isLoading ? (
        <QuotaGroupsPlaceholder />
      ) : (
        <AntigravityGroupArea body={view.body} now={now} />
      )}
      <QuotaStatusLine
        status={view.status}
        now={now}
        source={{ provider: "antigravity", limit }}
        progress={{ isQuerying, isHintShown }}
        onRetry={handleRetry}
      />
    </article>
  );
}
