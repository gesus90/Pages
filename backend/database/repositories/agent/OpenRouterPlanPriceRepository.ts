import type { Database } from "@/backend/database/Database";
import type {
  CatalogSnapshot,
  OpenRouterPriceStore,
} from "@/backend/service/agents/sessions/OpenRouterPricing";

/** Persists one public OpenRouter catalog stand for offline plan accounting. */
export class OpenRouterPlanPriceRepository implements OpenRouterPriceStore {
  private readonly database: Database;

  public constructor(database: Database) {
    this.database = database;
  }

  /** Reads the last successfully fetched catalog. */
  public async load(): Promise<{
    readonly fetchedAt: string;
    readonly prices: unknown;
  } | null> {
    const rows = await this.database.query(
      "SELECT fetched_at, prices::TEXT FROM openrouter_plan_price_catalog WHERE id = 1;",
    );
    const row = rows[0];
    if (!row || typeof row[0] !== "string" || typeof row[1] !== "string")
      return null;
    return { fetchedAt: row[0], prices: JSON.parse(row[1]) };
  }

  /** Replaces the saved catalog after a successful public fetch. */
  public async save(snapshot: CatalogSnapshot): Promise<void> {
    await this.database.execute(
      `INSERT INTO openrouter_plan_price_catalog (id, fetched_at, prices)
       VALUES (1, $fetched_at, $prices)
       ON CONFLICT (id) DO UPDATE SET
           fetched_at = excluded.fetched_at,
           prices = excluded.prices;`,
      {
        fetched_at: snapshot.fetchedAt,
        prices: JSON.stringify(snapshot.prices),
      },
    );
  }
}
