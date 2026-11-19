import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AntigravityQuotaCard } from "./antigravity-quota-card";
import { ClaudeQuotaCard } from "./claude-quota-card";
import { CodexQuotaCard } from "./codex-quota-card";
import { OpenRouterQuotaCard } from "./openrouter-quota-card";
import { QuotaPlaceholderCard } from "./quota-placeholders";
import { SortableQuotaCard } from "./sortable-quota-card";
import { useQuotaCardSort } from "./use-quota-card-sort";
import { ZaiQuotaCard } from "./zai-quota-card";

import type { SaveOpenRouterBalance } from "./quota-requests";
import type { QuotaCard } from "./quota-state";

/** How many placeholder cards stand while the connections are unknown. */
const PLACEHOLDER_CARDS = ["first", "second", "third"] as const;

/** The cards while the connections are unknown: nothing to sort yet. */
const NO_CARDS: readonly QuotaCard[] = [];

/** The card of one connection, by the provider that answers for it. */
function QuotaCardOfConnection({
  card,
  now,
  onRetry,
  onSaveOpenRouterBalance,
}: {
  readonly card: QuotaCard;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
  readonly onSaveOpenRouterBalance: SaveOpenRouterBalance;
}): React.ReactElement {
  const { account, pendingQueries } = card;
  if (account.provider === "antigravity")
    return (
      <AntigravityQuotaCard
        account={account}
        pendingQueries={pendingQueries}
        now={now}
        onRetry={onRetry}
      />
    );
  if (account.provider === "openrouter")
    return (
      <OpenRouterQuotaCard
        account={account}
        pendingQueries={pendingQueries}
        now={now}
        onRetry={onRetry}
        onSaveBalance={onSaveOpenRouterBalance}
      />
    );
  if (account.provider === "zai")
    return (
      <ZaiQuotaCard
        account={account}
        pendingQueries={pendingQueries}
        now={now}
        onRetry={onRetry}
      />
    );
  if (account.provider === "codex_cli")
    return (
      <CodexQuotaCard
        account={account}
        pendingQueries={pendingQueries}
        now={now}
        onRetry={onRetry}
      />
    );
  return (
    <ClaudeQuotaCard
      account={account}
      pendingQueries={pendingQueries}
      now={now}
      onRetry={onRetry}
    />
  );
}

/**
 * The grid of the quota cards of the provider connections: one
 * column on a phone, two on a tablet, three on a wide screen.
 * @remarks
 * While the connections are unknown (`cards` is `null`) three placeholder
 * cards of the full card size stand in the grid; the cards of the connections
 * replace them in place and surplus placeholders leave. All cards have the
 * same height, 308 px on a wide screen and 344 px in the single column of a
 * phone, also in a row with fewer cards. The cards arrive in the order the
 * person arranged; a handle at the top of each card moves it by mouse, finger
 * or keyboard, and `onMove` receives the place the card is put down at.
 * The keys are explained to a screen reader once, and a live region tells
 * what happens to the card in hand.
 */
export function QuotaCardGrid({
  cards,
  now,
  onRetry,
  onMove,
  onSaveOpenRouterBalance,
}: {
  readonly cards: readonly QuotaCard[] | null;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
  readonly onMove: (connectionId: string, toIndex: number) => void;
  readonly onSaveOpenRouterBalance: SaveOpenRouterBalance;
}): React.ReactElement {
  const { t } = useTranslation();
  const descriptionId = useId();
  const sort = useQuotaCardSort({ cards: cards ?? NO_CARDS, onMove });
  return (
    <>
      <div
        ref={sort.gridRef}
        aria-busy={cards === null}
        className="grid auto-rows-[344px] grid-cols-1 gap-5 md:auto-rows-[308px] md:grid-cols-2 xl:max-w-[1594px] xl:grid-cols-3"
      >
        {cards === null
          ? PLACEHOLDER_CARDS.map((position) => (
              <QuotaPlaceholderCard key={position} />
            ))
          : cards.map((card, index) => (
              <SortableQuotaCard
                key={card.account.connectionId}
                card={card}
                index={index}
                sort={sort}
                descriptionId={descriptionId}
                isSortable={cards.length > 1}
              >
                <QuotaCardOfConnection
                  card={card}
                  now={now}
                  onRetry={onRetry}
                  onSaveOpenRouterBalance={onSaveOpenRouterBalance}
                />
              </SortableQuotaCard>
            ))}
      </div>
      <p id={descriptionId} className="sr-only">
        {t("agentsPage.order.instructions")}
      </p>
      <p role="status" className="sr-only">
        {sort.announcement}
      </p>
    </>
  );
}
