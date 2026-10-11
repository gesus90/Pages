import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";

/** Adapts an already locked connection so nested repositories share its commit. */
export function agentTransactionScope(
  transaction: DatabaseTransaction,
): Pick<Database, "execute" | "query" | "transaction"> {
  return {
    execute: transaction.execute.bind(transaction),
    query: transaction.query.bind(transaction),
    transaction: async <Result>(
      work: (connection: DatabaseTransaction) => Promise<Result>,
    ): Promise<Result> => work(transaction),
  };
}
