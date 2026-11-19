import { backendRequestHeaders } from "@/app/lib/backend-request";
import { quotaCardOrderSchema } from "@/definition/AgentQuotaCardOrder";

import type { QuotaOrderAction } from "./quota-order-state";

/** The order the person arranged the cards in; read with GET, stored with PUT. */
export const QUOTA_ORDER_ENDPOINT = "/agent-api/quotas/order";

type OrderDispatch = (action: QuotaOrderAction) => void;

async function fetchOrder(signal: AbortSignal): Promise<readonly string[]> {
  const response = await fetch(QUOTA_ORDER_ENDPOINT, {
    signal,
    cache: "no-store",
  });
  const parsed = response.ok
    ? quotaCardOrderSchema.safeParse(await response.json())
    : null;
  if (parsed === null || !parsed.success)
    throw new Error("Quota order query failed");
  return parsed.data.order;
}

/** Sends with `keepalive`, so an order still arrives when the person leaves the page. */
async function putOrder(order: readonly string[]): Promise<void> {
  const response = await fetch(QUOTA_ORDER_ENDPOINT, {
    method: "PUT",
    headers: backendRequestHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ order }),
    keepalive: true,
  });
  if (!response.ok) throw new Error("Quota order could not be stored");
}

/**
 * The requests for the order of the quota cards: reading the stored order and
 * storing a new one.
 * @remarks
 * Orders are stored one after the other: while one is on its way, newer ones
 * replace each other, and only the newest follows. So a request that
 * arrives late can never overwrite a newer order, and a run of keyboard
 * moves costs few requests.
 */
export class QuotaOrderRequests {
  private readonly dispatch: OrderDispatch;
  private controller: AbortController | null = null;
  private waitingOrder: readonly string[] | null = null;
  private isStoring = false;

  public constructor(dispatch: OrderDispatch) {
    this.dispatch = dispatch;
  }

  /** Reads the stored order; a failed read leaves the default order. */
  public load(): void {
    const controller = new AbortController();
    this.controller = controller;
    void this.read(controller);
  }

  /** Aborts the reading of the order; a running store goes on. */
  public abort(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /**
   * Stores an order, or lets it wait for the store that is running.
   * @param order - The connection IDs, first card first.
   */
  public save(order: readonly string[]): void {
    this.waitingOrder = order;
    if (this.isStoring) return;
    void this.storeWaitingOrders();
  }

  private async read(controller: AbortController): Promise<void> {
    try {
      const order = await fetchOrder(controller.signal);
      if (!controller.signal.aborted) this.dispatch({ type: "loaded", order });
    } catch {
      if (!controller.signal.aborted) this.dispatch({ type: "loadFailed" });
    }
  }

  private async storeWaitingOrders(): Promise<void> {
    this.isStoring = true;
    let order = this.takeWaitingOrder();
    while (order !== null) {
      await this.store(order);
      order = this.takeWaitingOrder();
    }
    this.isStoring = false;
  }

  private async store(order: readonly string[]): Promise<void> {
    try {
      await putOrder(order);
      this.dispatch({ type: "saved", order });
    } catch {
      // A newer order is on its way and decides how the storing ends.
      if (this.waitingOrder === null) this.dispatch({ type: "saveFailed" });
    }
  }

  private takeWaitingOrder(): readonly string[] | null {
    const order = this.waitingOrder;
    this.waitingOrder = null;
    return order;
  }
}
