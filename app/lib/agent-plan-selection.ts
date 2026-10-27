import { createCookie } from "react-router";

import type { Cookie } from "react-router";

/** Browser preference scope; ports distinguish instances on the same host. */
export interface PlanSelectionScope {
  readonly userId: string;
  readonly origin: string;
}

/** A successful opening to remember, or a stale selection to discard after navigation commits. */
export interface PlanSelectionPreference extends PlanSelectionScope {
  readonly planId: string | null;
  readonly discardedPlanId: string | null;
}

/**
 * Keeps the existing cookie preference accessible to both SSR and router data requests.
 *
 * @remarks
 * Only the committed page writes this non-secret identifier. Loader responses
 * never write it, so a cancelled, late response cannot replace a newer choice.
 * Account-specific names preserve each account's choice across account changes.
 */
export function planSelectionCookie(scope: PlanSelectionScope): Cookie {
  return createCookie(
    `pages_plan_selection_${encodeURIComponent(scope.origin)}_${encodeURIComponent(scope.userId)}`,
    { sameSite: "lax", path: "/agents", maxAge: 31_536_000 },
  );
}
