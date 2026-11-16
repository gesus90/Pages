import { LIVE_CHANGE_CHANNEL } from "../LiveChangeNotificationRepository";
import { PagesEventOutboxRepository } from "../events/PagesEventOutboxRepository";

import type { DatabaseTransaction } from "@/backend/database/Database";

/**
 * Invalidates plan catalogs after commit, including readers who just lost access.
 *
 * @remarks
 * The durable outbox serves pages-core; PostgreSQL delivers the same notice
 * to the API's existing live hub. Neither path carries a private plan identity.
 * Both writes belong to the business transaction and disappear on rollback.
 */
export async function recordPlanChange(
  transaction: Pick<DatabaseTransaction, "execute">,
): Promise<void> {
  const event = { type: "plan.catalog.changed", id: "catalog" } as const;
  await new PagesEventOutboxRepository(transaction).append(event);
  await transaction.execute(
    `
    SELECT pg_notify($channel, $payload);
  `,
    { channel: LIVE_CHANGE_CHANNEL, payload: JSON.stringify(event) },
  );
}
