import { useEffect, useReducer, useRef } from "react";

import { claudeQuotaSnapshotSchema } from "@/definition/ClaudeQuota";

import type { ClaudeQuotaSnapshot } from "@/definition/ClaudeQuota";

/** One query of the quota page. */
export const CLAUDE_QUOTA_ENDPOINT = "/agent-api/quotas";

/** The stream through which the server pushes new figures once a minute. */
export const CLAUDE_QUOTA_EVENTS_ENDPOINT = "/agent-api/quotas/events";

/** How long the page waits before it opens a stream the server refused. */
const REOPEN_MILLISECONDS = 60_000;

/** What the quota page knows about its figures. */
export interface ClaudeQuotaState {
  /** The last figures that arrived; they stay while a query runs or fails. */
  readonly snapshot: ClaudeQuotaSnapshot | null;
  /** Browser time at which the last figures arrived. */
  readonly receivedAt: number | null;
  /** Browser time of the failed attempt since the last figures, if any. */
  readonly failedAt: number | null;
  /** Queries of the page that have not answered yet. */
  readonly pendingQueries: number;
  /** Whether the push stream of the server is open. */
  readonly isLive: boolean;
}

type QuotaAction =
  | { readonly type: "query" }
  | {
      readonly type: "received";
      readonly snapshot: ClaudeQuotaSnapshot;
      readonly at: number;
      readonly isQuery: boolean;
    }
  | { readonly type: "failed"; readonly at: number; readonly isQuery: boolean }
  | { readonly type: "live"; readonly isLive: boolean };

const INITIAL_STATE: ClaudeQuotaState = {
  snapshot: null,
  receivedAt: null,
  failedAt: null,
  pendingQueries: 0,
  isLive: false,
};

function settle(state: ClaudeQuotaState, isQuery: boolean): number {
  return isQuery ? Math.max(0, state.pendingQueries - 1) : state.pendingQueries;
}

/** Keeps the newest figures: a slow query never replaces a later push. */
function receive(
  state: ClaudeQuotaState,
  action: Extract<QuotaAction, { type: "received" }>,
): ClaudeQuotaState {
  const pendingQueries = settle(state, action.isQuery);
  const isOlder =
    state.snapshot !== null &&
    Date.parse(action.snapshot.readAt) < Date.parse(state.snapshot.readAt);
  if (isOlder) return { ...state, pendingQueries };
  return {
    ...state,
    snapshot: action.snapshot,
    receivedAt: action.at,
    failedAt: null,
    pendingQueries,
  };
}

function reduceQuotas(
  state: ClaudeQuotaState,
  action: QuotaAction,
): ClaudeQuotaState {
  switch (action.type) {
    case "query":
      return { ...state, pendingQueries: state.pendingQueries + 1 };
    case "received":
      return receive(state, action);
    case "failed":
      return {
        ...state,
        failedAt: action.at,
        pendingQueries: settle(state, action.isQuery),
      };
    case "live":
      return { ...state, isLive: action.isLive };
  }
}

function readSnapshot(body: unknown): ClaudeQuotaSnapshot | null {
  const parsed = claudeQuotaSnapshotSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

async function fetchSnapshot(
  signal: AbortSignal,
): Promise<ClaudeQuotaSnapshot> {
  const response = await fetch(CLAUDE_QUOTA_ENDPOINT, {
    signal,
    cache: "no-store",
  });
  const snapshot = response.ok ? readSnapshot(await response.json()) : null;
  if (!snapshot) throw new Error("Quota query failed");
  return snapshot;
}

function dispatchPush(
  dispatch: (action: QuotaAction) => void,
  messageBody: unknown,
): void {
  let snapshot: ClaudeQuotaSnapshot | null = null;
  try {
    snapshot = readSnapshot(JSON.parse(String(messageBody)));
  } catch {
    snapshot = null;
  }
  dispatch(
    snapshot
      ? { type: "received", snapshot, at: Date.now(), isQuery: false }
      : { type: "failed", at: Date.now(), isQuery: false },
  );
}

/**
 * Follows the push stream of the open page until the page closes it.
 * @remarks
 * The browser reconnects a lost stream after the minute the server names; a
 * stream the server refused is closed for good, so the page opens a new one
 * after a minute itself.
 */
function followQuotaPushes(
  dispatch: (action: QuotaAction) => void,
): () => void {
  let source: EventSource | null = null;
  let reopen: ReturnType<typeof setTimeout> | null = null;
  function open(): void {
    reopen = null;
    const current = new EventSource(CLAUDE_QUOTA_EVENTS_ENDPOINT);
    source = current;
    current.onopen = () => dispatch({ type: "live", isLive: true });
    current.onerror = () => {
      dispatch({ type: "live", isLive: false });
      dispatch({ type: "failed", at: Date.now(), isQuery: false });
      if (current.readyState !== EventSource.CLOSED || reopen !== null) return;
      current.close();
      reopen = setTimeout(open, REOPEN_MILLISECONDS);
    };
    current.addEventListener("quotas", (message) => {
      dispatchPush(dispatch, message.data);
    });
    current.addEventListener("quota-error", () => {
      dispatch({ type: "failed", at: Date.now(), isQuery: false });
    });
  }
  open();
  return () => {
    if (reopen !== null) clearTimeout(reopen);
    source?.close();
  };
}

/** Queries once; leaving the page aborts it through its controller. */
function startQuery(
  dispatch: (action: QuotaAction) => void,
  controllers: Set<AbortController>,
): void {
  const controller = new AbortController();
  controllers.add(controller);
  dispatch({ type: "query" });
  void fetchSnapshot(controller.signal)
    .then((snapshot) => {
      dispatch({ type: "received", snapshot, at: Date.now(), isQuery: true });
    })
    .catch(() => {
      if (controller.signal.aborted) return;
      dispatch({ type: "failed", at: Date.now(), isQuery: true });
    })
    .finally(() => controllers.delete(controller));
}

/**
 * The figures of the quota page and its refresh.
 * @returns The state and `refresh`, which queries once more.
 * @remarks
 * Opening the page queries at once and opens the push stream, through which
 * the server sends new figures once a minute while the page is open; leaving
 * the page closes the stream and cancels running queries. `refresh` queries
 * without touching the stream, so the minute beat stays where it is.
 */
export function useClaudeQuotas(): ClaudeQuotaState & {
  readonly refresh: () => void;
} {
  const [state, dispatch] = useReducer(reduceQuotas, INITIAL_STATE);
  const controllers = useRef(new Set<AbortController>());

  useEffect(() => {
    const running = controllers.current;
    startQuery(dispatch, running);
    const stopPushes = followQuotaPushes(dispatch);
    return () => {
      stopPushes();
      for (const controller of running) controller.abort();
      running.clear();
    };
  }, []);

  function refresh(): void {
    startQuery(dispatch, controllers.current);
  }

  return { ...state, refresh };
}
