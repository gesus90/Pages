import { AntigravityQuotaCard } from "./antigravity-quota-card";
import { ClaudeQuotaCard } from "./claude-quota-card";
import { QuotaPlaceholderCard } from "./quota-placeholders";

import type { QuotaCard } from "./quota-state";

/** How many placeholder cards stand while the connections are unknown. */
const PLACEHOLDER_CARDS = ["first", "second", "third"] as const;

/** The card of one connection, by the provider that answers for it. */
function QuotaCardOfConnection({
  card,
  now,
  onRetry,
}: {
  readonly card: QuotaCard;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
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
 * The grid of the quota cards of the Claude and Antigravity connections: one
 * column on a phone, two on a tablet, three on a wide screen.
 * @remarks
 * While the connections are unknown (`cards` is `null`) three placeholder
 * cards of the full card size stand in the grid; the cards of the connections
 * replace them in place and surplus placeholders leave. All cards have the
 * same height, 308 px on a wide screen and 344 px in the single column of a
 * phone, also in a row with fewer cards.
 */
export function QuotaCardGrid({
  cards,
  now,
  onRetry,
}: {
  readonly cards: readonly QuotaCard[] | null;
  readonly now: Date;
  readonly onRetry: (connectionId: string) => void;
}): React.ReactElement {
  return (
    <div
      aria-busy={cards === null}
      className="grid auto-rows-[344px] grid-cols-1 gap-5 md:auto-rows-[308px] md:grid-cols-2 xl:grid-cols-3"
    >
      {cards === null
        ? PLACEHOLDER_CARDS.map((position) => (
            <QuotaPlaceholderCard key={position} />
          ))
        : cards.map((card) => (
            <QuotaCardOfConnection
              key={card.account.connectionId}
              card={card}
              now={now}
              onRetry={onRetry}
            />
          ))}
    </div>
  );
}
