import { quotaCardOrderSchema } from "@/definition/AgentQuotaCardOrder";

import type { AgentQuotaCardOrderRepository } from "@/backend/database/repositories/agent/AgentQuotaCardOrderRepository";
import type { QuotaCardOrder } from "@/definition/AgentQuotaCardOrder";
import type { User } from "@/definition/User";

/**
 * The order in which a person arranged the cards of the Agents page, kept per
 * account so it holds after a reload and on every device.
 * @remarks
 * The service stores the order as the person sent it, without asking which
 * connections the person may use: the page shows only the cards the person
 * may use and ignores every other ID, so a stored ID reveals nothing and a
 * connection that comes back takes its place again.
 */
export class AgentQuotaCardOrderService {
  private readonly orders: AgentQuotaCardOrderRepository;
  private readonly now: () => Date;

  /**
   * Creates the service.
   * @param orders - The stored orders.
   * @param now - The clock; the system clock by default.
   */
  public constructor(
    orders: AgentQuotaCardOrderRepository,
    now: () => Date = () => new Date(),
  ) {
    this.orders = orders;
    this.now = now;
  }

  /**
   * Reads the order of the person.
   * @param person - The signed-in person.
   * @returns The connection IDs, first card first; empty for a person who
   * never sorted their cards, so the default order applies.
   */
  public async read(person: User): Promise<QuotaCardOrder> {
    const json = await this.orders.readJson(person.id);
    if (json === null) return { order: [] };
    return this.parseStored(json);
  }

  /**
   * Stores the order of the person and replaces the earlier one.
   * @param person - The signed-in person.
   * @param order - The connection IDs, first card first.
   */
  public async save(person: User, order: QuotaCardOrder): Promise<void> {
    await this.orders.writeJson(person.id, {
      connectionIdsJson: JSON.stringify(order.order),
      updatedAt: this.now().toISOString(),
    });
  }

  private parseStored(json: string): QuotaCardOrder {
    let stored: unknown;
    try {
      stored = JSON.parse(json);
    } catch (error: unknown) {
      if (error instanceof SyntaxError) return { order: [] };
      throw error;
    }
    const parsed = quotaCardOrderSchema.safeParse({ order: stored });
    return parsed.success ? parsed.data : { order: [] };
  }
}
