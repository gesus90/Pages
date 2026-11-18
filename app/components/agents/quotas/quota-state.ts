import { lastClaudeAnswerAt } from "./quota-card-state";

import type { QuotaAccount, QuotaSnapshot } from "@/definition/AgentQuota";

/** One card of the quota page and what the page knows about it. */
export interface QuotaCard {
  readonly account: QuotaAccount;
  /**
   * Server time in milliseconds of the answer that set the card; an answer
   * with an earlier time never replaces it.
   */
  readonly readAt: number;
  /**
   * Number of the newest request whose answer reached the card; the failure
   * of an earlier request never replaces it.
   */
  readonly answeredRequest: number;
  /** Queries of exactly this card that have not answered yet. */
  readonly pendingQueries: number;
}

/** What the quota page knows about its cards. */
export interface ClaudeQuotaState {
  /** The cards in display order; `null` while the connections are unknown. */
  readonly cards: readonly QuotaCard[] | null;
  /** Server time in milliseconds of the newest answer that listed the cards. */
  readonly listReadAt: number;
  /** Lists of the cards that have not answered yet. */
  readonly pendingLists: number;
  /** Whether the list failed while the connections are still unknown. */
  readonly hasListFailed: boolean;
  /** Whether the push stream of the server is open. */
  readonly isLive: boolean;
}

/**
 * Everything that changes the state. Every request carries the number it got
 * when it started, a rising number that tells a later failure from an
 * earlier one.
 */
export type QuotaAction =
  | { readonly type: "listStarted" }
  | { readonly type: "listSettled" }
  | {
      readonly type: "listed";
      readonly snapshot: QuotaSnapshot;
      readonly requestNumber: number;
    }
  | { readonly type: "listFailed"; readonly requestNumber: number }
  | { readonly type: "queryStarted"; readonly connectionId: string }
  | { readonly type: "querySettled"; readonly connectionId: string }
  | {
      readonly type: "queryAnswered";
      readonly connectionId: string;
      readonly snapshot: QuotaSnapshot;
      readonly requestNumber: number;
    }
  | {
      readonly type: "queryFailed";
      readonly connectionId: string;
      readonly requestNumber: number;
    }
  | {
      readonly type: "pushed";
      readonly snapshot: QuotaSnapshot;
      readonly requestNumber: number;
    }
  | { readonly type: "pushFailed"; readonly requestNumber: number }
  | { readonly type: "live"; readonly isLive: boolean };

/** The state of a page that has asked for nothing yet. */
export const INITIAL_QUOTA_STATE: ClaudeQuotaState = {
  cards: null,
  listReadAt: 0,
  pendingLists: 0,
  hasListFailed: false,
  isLive: false,
};

/**
 * Whether any list or query of the page has not answered yet.
 * @param state - The state of the page.
 */
export function isQuotaRefreshing(state: ClaudeQuotaState): boolean {
  return (
    state.pendingLists > 0 ||
    (state.cards ?? []).some((card) => card.pendingQueries > 0)
  );
}

function newCard(
  account: QuotaAccount,
  readAt: number,
  requestNumber: number,
): QuotaCard {
  return { account, readAt, answeredRequest: requestNumber, pendingQueries: 0 };
}

function settledCard(card: QuotaCard): QuotaCard {
  return { ...card, pendingQueries: Math.max(0, card.pendingQueries - 1) };
}

/**
 * The card after a query or push brought nothing.
 * @remarks
 * Pages got no answer for the card, so it keeps its figures and reads
 * "Abfrage fehlgeschlagen" with the time of Claude's last answer. A request
 * older than the newest answer of the card changes nothing.
 */
function failedCard(card: QuotaCard, requestNumber: number): QuotaCard {
  if (requestNumber < card.answeredRequest) return card;
  return {
    ...card,
    account: {
      ...card.account,
      status: {
        kind: "failed",
        lastSuccessAt: lastClaudeAnswerAt(card.account.status),
      },
    },
    answeredRequest: requestNumber,
  };
}

/** Changes one card, or removes it when `update` returns `null`. */
function updateCard(
  state: ClaudeQuotaState,
  connectionId: string,
  update: (card: QuotaCard) => QuotaCard | null,
): ClaudeQuotaState {
  if (state.cards === null) return state;
  const cards: QuotaCard[] = [];
  for (const card of state.cards) {
    if (card.account.connectionId !== connectionId) {
      cards.push(card);
      continue;
    }
    const next = update(card);
    if (next !== null) cards.push(next);
  }
  return { ...state, cards };
}

function cardsById(
  cards: readonly QuotaCard[] | null,
): ReadonlyMap<string, QuotaCard> {
  return new Map(
    (cards ?? []).map((card): [string, QuotaCard] => [
      card.account.connectionId,
      card,
    ]),
  );
}

/**
 * The cards a newer list does not name but whose own answer is even newer.
 * @remarks
 * The list is older than the card's answer, so it cannot tell that the card
 * is gone.
 */
function cardsNewerThanList(
  state: ClaudeQuotaState,
  snapshot: QuotaSnapshot,
  readAt: number,
): QuotaCard[] {
  const listed = new Set(
    snapshot.accounts.map((account) => account.connectionId),
  );
  return (state.cards ?? []).filter(
    (card) => !listed.has(card.account.connectionId) && card.readAt > readAt,
  );
}

/**
 * The cards after the list of the stored figures.
 * @remarks
 * The list decides which cards exist and brings the figures of a new card.
 * A card the page already shows keeps its status, because a query of it
 * follows and its figures must not flip to "stored" and back; only its name
 * follows the list. An answer older than one the page applied already
 * changes nothing.
 */
function applyList(
  state: ClaudeQuotaState,
  snapshot: QuotaSnapshot,
  requestNumber: number,
): ClaudeQuotaState {
  const pendingLists = Math.max(0, state.pendingLists - 1);
  const readAt = Date.parse(snapshot.readAt);
  if (readAt < state.listReadAt) return { ...state, pendingLists };
  const known = cardsById(state.cards);
  const listed = snapshot.accounts.map((account): QuotaCard => {
    const card = known.get(account.connectionId);
    if (!card) return newCard(account, readAt, requestNumber);
    return { ...card, account: { ...card.account, name: account.name } };
  });
  return {
    ...state,
    pendingLists,
    hasListFailed: false,
    listReadAt: readAt,
    cards: [...listed, ...cardsNewerThanList(state, snapshot, readAt)],
  };
}

/**
 * The cards after a push of the server.
 * @remarks
 * The push carries the cards of a person's current rights with fresh
 * figures, so a card it does not name leaves the page, and a card it names
 * takes its figures unless the card already holds a newer answer. A query of
 * a card that is still running keeps running.
 */
function applyPush(
  state: ClaudeQuotaState,
  snapshot: QuotaSnapshot,
  requestNumber: number,
): ClaudeQuotaState {
  const readAt = Date.parse(snapshot.readAt);
  if (readAt < state.listReadAt) return state;
  const known = cardsById(state.cards);
  const pushed = snapshot.accounts.map((account): QuotaCard => {
    const card = known.get(account.connectionId);
    if (!card) return newCard(account, readAt, requestNumber);
    if (readAt < card.readAt) return card;
    return {
      ...card,
      account,
      readAt,
      answeredRequest: Math.max(card.answeredRequest, requestNumber),
    };
  });
  return {
    ...state,
    hasListFailed: false,
    listReadAt: readAt,
    cards: [...pushed, ...cardsNewerThanList(state, snapshot, readAt)],
  };
}

/**
 * The card after the answer of its own query.
 * @remarks
 * An answer without the card means the person may not use the connection
 * (any more), so the card leaves the page; an answer older than the card's
 * figures changes nothing.
 */
function applyQueryAnswer(
  state: ClaudeQuotaState,
  action: Extract<QuotaAction, { type: "queryAnswered" }>,
): ClaudeQuotaState {
  const { connectionId, snapshot, requestNumber } = action;
  const readAt = Date.parse(snapshot.readAt);
  const account = snapshot.accounts.find(
    (entry) => entry.connectionId === connectionId,
  );
  return updateCard(state, connectionId, (card) => {
    const settled = settledCard(card);
    if (readAt < card.readAt) return settled;
    if (!account) return null;
    return {
      ...settled,
      account,
      readAt,
      answeredRequest: Math.max(card.answeredRequest, requestNumber),
    };
  });
}

/** Fails every card that waits for no query of its own. */
function failIdleCards(
  state: ClaudeQuotaState,
  requestNumber: number,
): ClaudeQuotaState {
  if (state.cards === null) return state;
  return {
    ...state,
    cards: state.cards.map((card) =>
      card.pendingQueries > 0 ? card : failedCard(card, requestNumber),
    ),
  };
}

/**
 * The state after a list that failed: without cards the connections stay
 * unknown, with cards every card that waits for no query of its own fails.
 */
function applyListFailure(
  state: ClaudeQuotaState,
  requestNumber: number,
): ClaudeQuotaState {
  const settled = {
    ...state,
    pendingLists: Math.max(0, state.pendingLists - 1),
  };
  if (settled.cards === null) return { ...settled, hasListFailed: true };
  return failIdleCards(settled, requestNumber);
}

/**
 * The state after an action.
 * @param state - The state before.
 * @param action - What happened.
 * @returns The new state; the figures of a card only ever move to an answer
 * that is not older than the figures it holds.
 */
export function reduceQuotas(
  state: ClaudeQuotaState,
  action: QuotaAction,
): ClaudeQuotaState {
  switch (action.type) {
    case "listStarted":
      return {
        ...state,
        pendingLists: state.pendingLists + 1,
        hasListFailed: false,
      };
    case "listSettled":
      return { ...state, pendingLists: Math.max(0, state.pendingLists - 1) };
    case "listed":
      return applyList(state, action.snapshot, action.requestNumber);
    case "listFailed":
      return applyListFailure(state, action.requestNumber);
    case "queryStarted":
      return updateCard(state, action.connectionId, (card) => ({
        ...card,
        pendingQueries: card.pendingQueries + 1,
      }));
    case "querySettled":
      return updateCard(state, action.connectionId, settledCard);
    case "queryAnswered":
      return applyQueryAnswer(state, action);
    case "queryFailed":
      return updateCard(state, action.connectionId, (card) =>
        failedCard(settledCard(card), action.requestNumber),
      );
    case "pushed":
      return applyPush(state, action.snapshot, action.requestNumber);
    case "pushFailed":
      return failIdleCards(state, action.requestNumber);
    case "live":
      return { ...state, isLive: action.isLive };
  }
}
