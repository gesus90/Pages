import { useEffect, useReducer, useState } from "react";

import { followQuotaPushes, QuotaRequests } from "./quota-requests";
import {
  INITIAL_QUOTA_STATE,
  isQuotaRefreshing,
  reduceQuotas,
} from "./quota-state";

import type { SaveOpenRouterBalance } from "./quota-requests";
import type { ClaudeQuotaState } from "./quota-state";

/** What the quota page shows and how it asks for more. */
export interface ClaudeQuotas {
  readonly state: ClaudeQuotaState;
  /** Whether a list or a query of any card has not answered yet. */
  readonly isRefreshing: boolean;
  /** Lists the cards again and queries each of them. */
  readonly refresh: () => void;
  /** Queries one card without touching the others. */
  readonly retryCard: (connectionId: string) => void;
  readonly saveOpenRouterBalance: SaveOpenRouterBalance;
}

/**
 * The cards of the quota page and their refresh.
 * @returns The state, whether anything is refreshing, `refresh` for all
 * cards and `retryCard` for one.
 * @remarks
 * Opening the page lists the cards from the stored figures at once, queries
 * every card in the background and opens the push stream, through which the
 * server sends new figures once a minute while the page is open; leaving the
 * page closes the stream and aborts running requests. `refresh` and
 * `retryCard` leave the stream alone, so the minute beat stays where it is.
 */
export function useClaudeQuotas(): ClaudeQuotas {
  const [state, dispatch] = useReducer(reduceQuotas, INITIAL_QUOTA_STATE);
  const [requests] = useState(() => new QuotaRequests(dispatch));

  useEffect(() => {
    requests.load();
    const stopPushes = followQuotaPushes(dispatch, () =>
      requests.nextRequestNumber(),
    );
    return () => {
      stopPushes();
      requests.abort();
    };
  }, [requests]);

  return {
    state,
    isRefreshing: isQuotaRefreshing(state),
    refresh: () => requests.load(),
    retryCard: (connectionId) => requests.query(connectionId),
    saveOpenRouterBalance: (connectionId, display) =>
      requests.saveOpenRouterBalance(connectionId, display),
  };
}
