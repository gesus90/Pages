import { readTextColumn } from "@/backend/database/RowValue";
import { logCaughtError } from "@/backend/logging/Logger";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import {
  processedTicketEntries,
  withoutProcessedTicketEntries,
} from "@/backend/service/agents/stack/AgentPlanStackCleanup";

import { recordPlanChange } from "./AgentPlanChangeNotification";

import type { DatabaseTransaction } from "@/backend/database/Database";
import type { AgentPlan, AgentPlanRun } from "@/definition/AgentPlan";

/** The plan frozen for a run, or `null` when its stored basis cannot be read. */
function frozenPlan(snapshot: unknown): AgentPlan | null {
  try {
    return readPlanSnapshot(snapshot).plan;
  } catch (error: unknown) {
    // A damaged basis must not keep the run from ending; its stacks stay as they are.
    logCaughtError("AgentPlanProcessedTickets", error);
    return null;
  }
}

/**
 * Removes the ticket entries a succeeded run processed from the stacks of its stored plan.
 * @param transaction - The transaction that stores the final state of the run.
 * @param input - The run in its final state and the basis frozen for it.
 * @remarks
 * Runs in the transaction of the write that ends the run as `succeeded`, so
 * the run never ends without its cleanup and the cleanup never happens without
 * the end. That write happens once, because a succeeded run is final; a
 * repeated report of the end writes nothing again. The plan is read inside the
 * transaction and only the matching entries leave it, so a change saved
 * before is kept and the plan is never replaced by the version the run saw.
 * Owner, sharing, tickets, the snapshot and the recorded handovers of the run
 * are not touched. Open plan pages learn about the new revision through the
 * plan change notice.
 */
export async function clearProcessedTicketEntries(
  transaction: DatabaseTransaction,
  input: { readonly run: AgentPlanRun; readonly snapshot: unknown },
): Promise<void> {
  const plan = frozenPlan(input.snapshot);
  if (!plan || plan.id !== input.run.planId) return;
  const processed = processedTicketEntries(plan, input.run);
  if (processed.length === 0) return;
  const [row] = await transaction.query(
    `
    SELECT plan_json
    FROM agent_plans
    WHERE id = $plan_id
    FOR UPDATE;
  `,
    { plan_id: plan.id },
  );
  if (!row) return;
  const cleaned = withoutProcessedTicketEntries(
    readTextColumn(row, 0, "plan_json"),
    processed,
  );
  if (cleaned === null) return;
  // A write of the system keeps the recorded editor and time, like other system writes of a plan.
  await transaction.execute(
    `
    UPDATE agent_plans
    SET plan_json = $plan_json,
        revision = revision + 1
    WHERE id = $plan_id;
  `,
    { plan_id: plan.id, plan_json: cleaned },
  );
  await recordPlanChange(transaction);
}
