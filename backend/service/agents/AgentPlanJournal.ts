import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";

/** Records an explicit run command in the transaction of its durable state change. */
export type AgentPlanRunJournal = (
  transaction: DatabaseTransaction,
  run: AgentPlanRun,
) => Promise<void>;
