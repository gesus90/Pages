import { ExecutionLocationBadge } from "@/app/components/agents/badges/execution-location-badge";

import { QUOTA_CARD_CLASS } from "./quota-card-layout";
import { QuotaLocationPlaceholder } from "./quota-placeholders";

import type { ReactNode } from "react";
import type { ExecutionLocation } from "@/definition/ExecutionLocation";
import type { QuotaAccount } from "@/definition/AgentQuota";

/** Common surface and alignment for a provider card in the quota grid. */
export function QuotaCardFrame({
  connectionId,
  provider,
  isLoading,
  isQuerying,
  children,
}: {
  readonly connectionId: string;
  readonly provider?: QuotaAccount["provider"];
  readonly isLoading: boolean;
  readonly isQuerying: boolean;
  readonly children: ReactNode;
}): React.ReactElement {
  return (
    <article
      data-quota-card={connectionId}
      data-quota-provider={provider}
      data-quota-loading={isLoading ? "true" : "false"}
      aria-busy={isLoading || isQuerying}
      className={QUOTA_CARD_CLASS}
    >
      {children}
    </article>
  );
}

/**
 * The right end of a card head: the plan or other badges, and in the corner
 * the execution location of the runner.
 * @remarks
 * The corner belongs to the location, so it stands in the same place on every
 * card, with or without a plan badge. The group is right-aligned with
 * `ml-auto`, centred in the 44 px head, never shrinks and keeps the full text
 * of its badges; the name and subtitle beside it truncate instead. The gap is
 * 6 px on a phone and 8 px from the tablet width on. A card whose data names
 * no location passes `null` and shows "Unbekannt". A card that still waits for
 * the figures that name it sets `isLocationPending` and holds the corner with
 * a placeholder of the badge's size, so it never reads "Unbekannt" for a
 * moment and nothing moves when the place arrives.
 */
export function QuotaHeaderBadges({
  location,
  isLocationPending = false,
  children,
}: {
  readonly location: ExecutionLocation | null;
  readonly isLocationPending?: boolean;
  readonly children?: ReactNode;
}): React.ReactElement {
  return (
    <div
      data-quota-head-badges=""
      className="ml-auto flex shrink-0 items-center gap-1.5 md:gap-2"
    >
      {children}
      {isLocationPending ? (
        <QuotaLocationPlaceholder />
      ) : (
        <ExecutionLocationBadge location={location} />
      )}
    </div>
  );
}
