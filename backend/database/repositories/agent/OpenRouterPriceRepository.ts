import { openRouterPricesSchema } from "@/backend/service/agents/usage/OpenRouterPrices";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { OpenRouterPrices } from "@/backend/service/agents/usage/OpenRouterPrices";

/** The public price cache survives network outages and process restarts. */
export class OpenRouterPriceRepository {
  private readonly database: DatabaseTransaction;

  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the last validated price catalog; no credentials are involved. */
  public async read(): Promise<OpenRouterPrices | null> {
    const [row] = await this.database.query(
      "SELECT payload FROM openrouter_price_catalog WHERE id = 1;",
    );
    if (typeof row?.[0] !== "string") return null;
    return openRouterPricesSchema.parse(JSON.parse(row[0]));
  }

  /** Atomically replaces the last good catalog after a successful public fetch. */
  public async save(catalog: OpenRouterPrices): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO openrouter_price_catalog (id, payload)
      VALUES (1, $payload)
      ON CONFLICT (id) DO UPDATE SET payload = excluded.payload;
    `,
      { payload: JSON.stringify(catalog) },
    );
  }
}
