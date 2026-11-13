import type { DatabaseTransaction } from "@/backend/database/Database";

/**
 * Creates the record of a new run inside a transaction that the caller opens.
 *
 * @remarks
 * The caller passes `create` the transaction in which it stores its own
 * changes; a failure of either rolls both back.
 */
export type AgentPlanRunRecording = (
  create: (transaction: DatabaseTransaction) => Promise<void>,
) => Promise<void>;
