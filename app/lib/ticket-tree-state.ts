import {
  isCurrentLocalStateAudience,
  isLocalStateAudience,
} from "@/app/lib/local-state/local-state-audience";
import { readRouteData } from "@/app/lib/local-state/route-data";

import type { LocalStateRouteKind } from "@/app/components/common/use-local-state-route";
import type { TicketLayoutData } from "@/app/routes/tasks-layout";

/** The rights-checked endpoint of the ticket tree; the key of its kept answers as well. */
export const TICKET_TREE_ENDPOINT = "/aufgaben-api/tree";

function isTicketLayoutData(value: unknown): value is TicketLayoutData {
  return (
    typeof value === "object" &&
    value !== null &&
    "entries" in value &&
    Array.isArray(value.entries) &&
    "expandedKeys" in value &&
    Array.isArray(value.expandedKeys) &&
    "audience" in value &&
    isLocalStateAudience(value.audience)
  );
}

/** The ticket tree of the sidebar, kept per account and rights. */
export const TICKET_TREE_STATE: LocalStateRouteKind<TicketLayoutData> = {
  schemaVersion: 1,
  isPayload: isTicketLayoutData,
  isCurrent: (layout) => isCurrentLocalStateAudience(layout.audience),
  ownerOf: (layout) => layout.audience.userId,
  isRefused: () => false,
};

/**
 * Reads the ticket tree of the signed-in account from its endpoint.
 *
 * @param signal - Ends the request when it is no longer needed.
 */
export function readTicketTree(signal: AbortSignal): Promise<TicketLayoutData> {
  return readRouteData({
    endpoint: TICKET_TREE_ENDPOINT,
    signal,
    isPayload: isTicketLayoutData,
  });
}
