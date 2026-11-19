import { QuotaCardHandle } from "./quota-card-handle";

import type { ReactNode } from "react";
import type { QuotaCardSort } from "./use-quota-card-sort";
import type { QuotaCard } from "./quota-state";

/**
 * One cell of the quota grid: the card with its handle and the marks of the
 * sorting.
 * @remarks
 * The card in hand is lifted: a ring and a shadow, above the other cards,
 * and while a pointer drags it, it follows the pointer. The place it would
 * take is marked by a dashed outline over the card that stands there, so the
 * person sees where it lands before letting go. A single card has no handle,
 * because it has nowhere to go. The cell keeps the radius of the card so
 * the ring and the shadow follow its corners.
 */
export function SortableQuotaCard({
  card,
  index,
  sort,
  descriptionId,
  isSortable,
  children,
}: {
  readonly card: QuotaCard;
  /** The zero-based position of the card in the grid. */
  readonly index: number;
  readonly sort: QuotaCardSort;
  readonly descriptionId: string;
  /** Whether the grid holds more than one card. */
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
