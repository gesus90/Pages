import { readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseTransaction } from "@/backend/database/Database";

/** Persisted public catalog; no API credentials are read or stored. */
export class OpenRouterPriceRepository {
  private readonly database: DatabaseTransaction;
  public constructor(database: DatabaseTransaction) {
    this.database = database;
  }

  /** Returns the most recent successful catalog even after a network outage. */
  public async read(): Promise<{
    readonly fetchedAt: string;
    readonly catalog: string;
  } | null> {
    const [row] = await this.database.query(
      "SELECT fetched_at, catalog FROM openrouter_price_catalog WHERE id = 1;",
    );
    return row
      ? {
          fetchedAt: readTextColumn(row, 0, "fetched_at"),
          catalog: readTextColumn(row, 1, "catalog"),
        }
      : null;
  }

  /** Replaces the cache only after the complete response was validated. */
  public async save(fetchedAt: string, catalog: string): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO openrouter_price_catalog (id, fetched_at, catalog)
      VALUES (1, $fetched_at, $catalog)
      ON CONFLICT (id) DO UPDATE SET
          fetched_at = excluded.fetched_at,
          catalog = excluded.catalog;
    `,
      { fetched_at: fetchedAt, catalog },
    );
  }
}
