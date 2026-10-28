import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanStartRejection } from "@/definition/AgentPlanStartRejection";

/** Records an explicit run command in the transaction of its durable state change or refusal. */
export type AgentPlanRunJournal = ((
  transaction: DatabaseTransaction,
  run: AgentPlanRun,
) => Promise<void>) & {
  readonly recordStartRejection?: (
    transaction: DatabaseTransaction,
    rejection: AgentPlanStartRejection,
  ) => Promise<void>;
};
