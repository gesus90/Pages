import type { DatabaseTransaction } from "@/backend/database/Database";

/** Session persistence can join an existing owner-import transaction without opening another writer. */
export interface AgentSessionDatabase extends DatabaseTransaction {
  transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result>;
}
