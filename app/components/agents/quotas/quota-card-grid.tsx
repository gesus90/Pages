import { GripHorizontal } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { AntigravityQuotaCard } from "./antigravity-quota-card";
import { ClaudeQuotaCard } from "./claude-quota-card";
import { CodexQuotaCard } from "./codex-quota-card";
import { OpenRouterQuotaCard } from "./openrouter-quota-card";
import { QuotaPlaceholderCard } from "./quota-placeholders";
import { useQuotaCardSort } from "./use-quota-card-sort";
import { ZaiQuotaCard } from "./zai-quota-card";

import type { ReactNode } from "react";
import type { SaveOpenRouterBalance } from "./quota-requests";
import type { QuotaCard } from "./quota-state";
import type { QuotaCardSort } from "./use-quota-card-sort";

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
 * The grid of the quota cards of the provider connections: as many
 * columns as fit with at least 518 px per card, at a fixed gap of 20 px.
 * @remarks
 * The cards grow with the width of the section and never the gap. Up to the
 * width where two columns fit, the grid is at most 720 px wide and stands
 * left; from there it spans the section. The grid takes its width from the
 * container query of the section, which the page sets (`@container`), and
 * shares it with the header of the section.
 * While the connections are unknown (`cards` is `null`) three placeholder
 * cards of the full card size stand in the grid; the cards of the connections
 * replace them in place and surplus placeholders leave. All cards have the
 * same height, 340 px from the medium breakpoint and 344 px below it,
 * whatever the number of columns, also in a row with fewer cards. The cards
 * arrive in the order the person arranged; a handle at the top of each card
 * moves it by mouse, finger or keyboard, and `onMove` receives the place the
 * card is put down at.
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
        className="grid max-w-[720px] auto-rows-[344px] grid-cols-[repeat(auto-fill,minmax(min(100%,518px),1fr))] gap-5 @min-[1056px]:max-w-none md:auto-rows-[340px]"
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

function QuotaCardHandle({
  connectionId,
  name,
  sort,
  descriptionId,
}: {
  readonly connectionId: string;
  readonly name: string;
  readonly sort: QuotaCardSort;
  readonly descriptionId: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const { session } = sort;
  const isHeldByKeyboard =
    session?.source === "keyboard" && session.activeId === connectionId;
  const label = t("agentsPage.order.handle", { name });
  return (
    <button
      type="button"
      data-quota-handle={connectionId}
      aria-label={label}
      title={label}
      aria-pressed={isHeldByKeyboard}
      aria-describedby={descriptionId}
      onPointerDown={(event) => sort.startPointerDrag(event, connectionId)}
      onKeyDown={(event) => sort.handleKeyDown(event, connectionId)}
      onBlur={() => sort.handleBlur(connectionId)}
      className="absolute top-0.5 left-1/2 z-10 flex h-6 w-14 -translate-x-1/2 cursor-grab touch-none items-center justify-center rounded-lg text-muted-foreground outline-none select-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
    >
      <GripHorizontal className="size-4" aria-hidden="true" />
    </button>
  );
}

function SortableQuotaCard({
  card,
  index,
  sort,
  descriptionId,
  isSortable,
  children,
}: {
  readonly card: QuotaCard;
  readonly index: number;
  readonly sort: QuotaCardSort;
  readonly descriptionId: string;
  readonly isSortable: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  const { connectionId, name } = card.account;
  const { session } = sort;
  const isInHand = session?.activeId === connectionId;
  const isTarget =
    session !== null && !isInHand && session.targetIndex === index;
  return (
    <div
      data-sortable-card=""
      data-in-hand={isInHand ? "true" : undefined}
      className="relative h-full min-w-0 rounded-[20px] data-[in-hand=true]:z-20 data-[in-hand=true]:opacity-95 data-[in-hand=true]:shadow-floating data-[in-hand=true]:ring-2 data-[in-hand=true]:ring-primary md:rounded-3xl"
    >
      {children}
      {isSortable ? (
        <QuotaCardHandle
          connectionId={connectionId}
          name={name}
          sort={sort}
          descriptionId={descriptionId}
        />
      ) : null}
      {isTarget ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 rounded-[20px] border-2 border-dashed border-primary bg-primary-subtle/60 md:rounded-3xl"
        />
      ) : null}
    </div>
  );
}
