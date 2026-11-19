import { quotaSnapshotSchema } from "@/definition/AgentQuota";

import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { OpenRouterBalanceDisplay } from "@/definition/OpenRouterQuota";
import type { QuotaAction } from "./quota-state";

/** The cards of the person from the stored figures; no provider is asked. */
export const CLAUDE_QUOTA_ENDPOINT = "/agent-api/quotas";

/** One query of a single card, followed by the id of its connection. */
export const CLAUDE_QUOTA_CARD_ENDPOINT = "/agent-api/quotas/cards";

/** The stream through which the server pushes new figures once a minute. */
export const CLAUDE_QUOTA_EVENTS_ENDPOINT = "/agent-api/quotas/events";

/** How long the page waits before it opens a stream the server refused. */
const REOPEN_MILLISECONDS = 60_000;

type QuotaDispatch = (action: QuotaAction) => void;

/** Result of changing the balance display, for the editing dialog. */
export type OpenRouterBalanceSaveResult =
  "saved" | "baselineUnavailable" | "connectionChanged" | "failed";

/** Saves the balance display for one OpenRouter quota card. */
export type SaveOpenRouterBalance = (
  connectionId: string,
  display: OpenRouterBalanceDisplay,
) => Promise<OpenRouterBalanceSaveResult>;

function cardUrl(connectionId: string): string {
  return `${CLAUDE_QUOTA_CARD_ENDPOINT}/${encodeURIComponent(connectionId)}`;
}

function readSnapshot(body: unknown): QuotaSnapshot | null {
  const parsed = quotaSnapshotSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

async function fetchSnapshot(
  url: string,
  signal: AbortSignal,
): Promise<QuotaSnapshot> {
  const response = await fetch(url, { signal, cache: "no-store" });
  const snapshot = response.ok ? readSnapshot(await response.json()) : null;
  if (!snapshot) throw new Error("Quota query failed");
  return snapshot;
}

function dispatchPush(
  dispatch: QuotaDispatch,
  requestNumber: number,
  messageBody: unknown,
): void {
  let snapshot: QuotaSnapshot | null = null;
  try {
    snapshot = readSnapshot(JSON.parse(String(messageBody)));
  } catch {
    snapshot = null;
  }
  dispatch(
    snapshot
      ? { type: "pushed", snapshot, requestNumber }
      : { type: "pushFailed", requestNumber },
  );
}

/**
 * Follows the push stream of the open page until the page closes it.
 * @param dispatch - Receives what the stream brings.
 * @param nextRequestNumber - Numbers a push when it arrives.
 * @returns Closes the stream.
 * @remarks
 * The browser reconnects a lost stream after the minute the server names; a
 * stream the server refused is closed for good, so the page opens a new one
 * after a minute itself.
 */
export function followQuotaPushes(
  dispatch: QuotaDispatch,
  nextRequestNumber: () => number,
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
      dispatch({ type: "pushFailed", requestNumber: nextRequestNumber() });
      if (current.readyState !== EventSource.CLOSED || reopen !== null) return;
      current.close();
      reopen = setTimeout(open, REOPEN_MILLISECONDS);
    };
    current.addEventListener("quota-refreshing", () => {
      dispatch({ type: "pushStarted" });
    });
    current.addEventListener("quotas", (message) => {
      dispatchPush(dispatch, nextRequestNumber(), message.data);
    });
    current.addEventListener("quota-error", () => {
      dispatch({ type: "pushFailed", requestNumber: nextRequestNumber() });
    });
  }
  open();
  return () => {
    if (reopen !== null) clearTimeout(reopen);
    source?.close();
  };
}

/**
 * The requests of the quota page: the list of its cards and the query of
 * each card on its own.
 * @remarks
 * Opening the page lists the cards from the stored figures, which never wait
 * for Claude, and then queries every card side by side; each card changes
 * the moment its own answer arrives, so a slow connection holds back no
 * other card. Leaving the page aborts every running request.
 */
export class QuotaRequests {
  private readonly dispatch: QuotaDispatch;
  private readonly controllers = new Set<AbortController>();
  private lastRequestNumber = 0;

  public constructor(dispatch: QuotaDispatch) {
    this.dispatch = dispatch;
  }

  /**
   * Numbers the next request, so a late failure can tell it is older than an
   * answer that arrived meanwhile.
   * @returns A number higher than every number given before.
   */
  public nextRequestNumber(): number {
    this.lastRequestNumber += 1;
    return this.lastRequestNumber;
  }

  /**
   * Lists the cards from the stored figures, then queries each of them.
   * @remarks
   * A card the page already shows stays where it is while its query runs.
   */
  public load(): void {
    const controller = this.track();
    this.dispatch({ type: "listStarted" });
    void this.list(controller, this.nextRequestNumber());
  }

  /**
   * Asks Claude about one card and updates only that card.
   * @param connectionId - The connection of the card.
   */
  public query(connectionId: string): void {
    const controller = this.track();
    this.dispatch({ type: "queryStarted", connectionId });
    void this.queryCard(connectionId, controller, this.nextRequestNumber());
  }

  /** Saves one display and applies the returned card through the usual request ordering. */
  public async saveOpenRouterBalance(
    connectionId: string,
    display: OpenRouterBalanceDisplay,
  ): Promise<OpenRouterBalanceSaveResult> {
    const controller = this.track();
    const requestNumber = this.nextRequestNumber();
    this.dispatch({ type: "queryStarted", connectionId });
    let snapshot: QuotaSnapshot | null = null;
    try {
      const response = await fetch(cardUrl(connectionId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(display),
        signal: controller.signal,
      });
      if (response.status === 409) return "connectionChanged";
      if (!response.ok && response.status !== 422) return "failed";
      snapshot = readSnapshot(await response.json());
      if (!snapshot) return "failed";
      this.dispatch({
        type: "queryAnswered",
        connectionId,
        snapshot,
        requestNumber,
      });
      if (!response.ok) return "baselineUnavailable";
      if (display.mode === "account" && !controller.signal.aborted)
        this.query(connectionId);
      return "saved";
    } catch {
      return "failed";
    } finally {
      if (!snapshot) this.dispatch({ type: "querySettled", connectionId });
      this.controllers.delete(controller);
    }
  }

  /** Aborts every running request; nothing answers after the page closed. */
  public abort(): void {
    for (const controller of this.controllers) controller.abort();
    this.controllers.clear();
  }

  private track(): AbortController {
    const controller = new AbortController();
    this.controllers.add(controller);
    return controller;
  }

  private async list(
    controller: AbortController,
    requestNumber: number,
  ): Promise<void> {
    try {
      const snapshot = await fetchSnapshot(
        CLAUDE_QUOTA_ENDPOINT,
        controller.signal,
      );
      if (controller.signal.aborted) {
        this.dispatch({ type: "listSettled" });
        return;
      }
      this.dispatch({ type: "listed", snapshot, requestNumber });
      for (const account of snapshot.accounts) this.query(account.connectionId);
    } catch {
      this.dispatch(
        controller.signal.aborted
          ? { type: "listSettled" }
          : { type: "listFailed", requestNumber },
      );
    } finally {
      this.controllers.delete(controller);
    }
  }

  private async queryCard(
    connectionId: string,
    controller: AbortController,
    requestNumber: number,
  ): Promise<void> {
    try {
      const snapshot = await fetchSnapshot(
        cardUrl(connectionId),
        controller.signal,
      );
      this.dispatch({
        type: "queryAnswered",
        connectionId,
        snapshot,
        requestNumber,
      });
    } catch {
      this.dispatch(
        controller.signal.aborted
          ? { type: "querySettled", connectionId }
          : { type: "queryFailed", connectionId, requestNumber },
      );
    } finally {
      this.controllers.delete(controller);
    }
  }
}
