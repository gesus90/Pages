import type { Database } from "@/backend/database/Database";

/**
 * What the ticket repositories use of the database.
 *
 * @remarks
 * The central database and the scope of an open transaction both offer it,
 * so ticket writes can share the commit of the caller that opened it.
 */
export type TaskDatabase = Pick<Database, "execute" | "query" | "transaction">;
