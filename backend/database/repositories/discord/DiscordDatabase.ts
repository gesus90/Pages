import type { Database } from "@/backend/database/Database";

/** What the Discord repositories use of the database. */
export type DiscordDatabase = Pick<
  Database,
  "execute" | "query" | "transaction"
>;
