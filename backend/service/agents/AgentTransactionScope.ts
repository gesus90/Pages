import type { TaskDatabase } from "@/backend/database/repositories/task/TaskDatabase";
import type { DatabaseTransaction } from "@/backend/database/Database";

/** Adapts an already locked connection so nested repositories share its commit. */
export function agentTransactionScope(
  transaction: DatabaseTransaction,
): TaskDatabase {
  const reuse = async <Result>(
    work: (connection: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> => work(transaction);
  return {
    onCommit: transaction.onCommit,
    onRollback: transaction.onRollback,
    execute: transaction.execute.bind(transaction),
    query: transaction.query.bind(transaction),
    transaction: reuse,
    // Reads inside the locked transaction must see its own uncommitted writes.
    readTransaction: reuse,
  };
}
