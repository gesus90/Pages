import { useTranslation } from "react-i18next";

import { QuotaCardGrid } from "./quota-card-grid";
import { QuotaOrderNotice } from "./quota-order-notice";
import { QuotaSectionHeader } from "./quota-section-header";
import { useClaudeQuotas } from "./use-claude-quotas";
import { useQuotaCardOrder } from "./use-quota-card-order";
import { useQuotaClock } from "./use-quota-clock";

/**
 * The page "Agents": what is left of the AI accounts a person may use.
 * Agent Plan, runs and the working directory stand below "Agents" in the
 * main navigation.
 * @remarks
 * It shows one card per supported connection the person may use. The page
 * stands with its cards at once: three placeholder cards while the connections are
 * unknown, then a card per connection with its last stored figures, which
 * the current figures replace card by card as each query answers. The
 * figures stay while a query runs or fails, so the page never falls back to
 * an empty state once it has cards; the empty state appears only when it is
 * certain that no card is available. All cards have the same height, 308 px
 * on a wide screen and 344 px in the single column of a phone, also in a row
 * with fewer cards. A person arranges the cards by drag and drop or by
 * keyboard; Pages stores that order per account, so it holds after a reload
 * and on every device, and a list, a query or the push of the minute never
 * changes it. Until the person sorts, the cards stand in the default order,
 * and a card the order does not know yet stands at the end.
 */
export function AgentsPage(): React.ReactElement {
  const { t } = useTranslation();
  const quotas = useClaudeQuotas();
  const now = useQuotaClock();
  const { cards, hasListFailed, isLive } = quotas.state;
  const order = useQuotaCardOrder(cards);
  const hasNoCards = cards !== null && cards.length === 0;
  return (
    <div className="flex w-full flex-col">
      <header>
        <h1 className="text-[28px] leading-[34px] font-bold tracking-tight text-foreground xl:text-4xl">
          {t("agentsPage.title")}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">
          {t("agentsPage.subtitle")}
        </p>
      </header>
      <section
        aria-label={t("agentsPage.quotas.title")}
        className="mt-8 flex flex-col gap-4"
      >
        <QuotaSectionHeader
          isRefreshing={quotas.isRefreshing}
          isLive={isLive}
          onRefresh={quotas.refresh}
        />
        {hasNoCards ? (
          <p className="text-[13px] text-muted-foreground">
            {t("agentsPage.quotas.noConnections")}
          </p>
        ) : null}
        {hasListFailed ? (
          <p role="alert" className="text-[13px] text-warning">
            {t("agentsPage.quotas.loadFailed")}
          </p>
        ) : null}
        {hasNoCards || hasListFailed ? null : (
          <>
            <QuotaOrderNotice order={order} />
            <QuotaCardGrid
              cards={order.cards}
              now={now}
              onRetry={quotas.retryCard}
              onMove={order.move}
              onSaveOpenRouterBalance={quotas.saveOpenRouterBalance}
            />
          </>
        )}
      </section>
    </div>
  );
}
