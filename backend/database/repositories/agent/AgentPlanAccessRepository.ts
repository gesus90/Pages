import { isUniqueViolationOn } from "@/backend/database/Database";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { agentPlanNameKey } from "@/definition/AgentPlanName";
import { planNameDepartment } from "@/definition/AgentPlanTeam";

import { AgentPlanAuditRepository } from "./AgentPlanAuditRepository";
import { AgentPlanScriptApprovalRepository } from "./AgentPlanScriptApprovalRepository";
import { AgentPlanTeamRepository } from "./AgentPlanTeamRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanTeam } from "@/definition/AgentPlanTeam";
import type { AgentPlanAuditRecord } from "./AgentPlanAuditRepository";

/** A change of the owner or the teams of a plan at the revision the person saw. */
export interface AgentPlanAccessChange {
  readonly planId: string;
  readonly revision: number;
  readonly actorId: string;
  /** The new owner; absent keeps the owner. */
  readonly ownerId?: string;
  /** The new, normalized teams; absent keeps the teams. */
  readonly teams?: readonly AgentPlanTeam[];
  /** Records the operation result in the same commit. */
  readonly journal?: (transaction: DatabaseTransaction) => Promise<void>;
}

/** One approved script step with its hash. */
export interface AgentPlanScriptApprovalChange {
  readonly planId: string;
  readonly revision: number;
  readonly actorId: string;
  readonly approvals: readonly {
    readonly stepId: string;
    readonly contentHash: string;
  }[];
}

/** Whether a write failed because another plan of the team already has the name. */
function isNameViolation(error: unknown): boolean {
  return (
    isUniqueViolationOn(error, "project_id") ||
    (error instanceof Error &&
      error.message.includes("UNIQUE constraint violation"))
  );
}

/**
 * Changes who a plan belongs to and records its history (PAGE-329).
 *
 * @remarks
 * Every change of owner or teams is a revision of its own: it is refused for a
 * stale revision, raises the revision by one and is written to the history of
 * the plan in the same commit. The first department of the teams is the name
 * space of the plan, so a new team whose plans already use the name is
 * refused with `plan_name_taken` and nothing changes.
 */
export class AgentPlanAccessRepository {
  private readonly database: Pick<Database, "transaction">;

  public constructor(database: Pick<Database, "transaction">) {
    this.database = database;
  }

  /**
   * Stores a new owner and/or new teams.
   *
   * @returns The new revision of the plan.
   * @throws {AgentError} `plan_conflict` for a stale revision or a missing
   * plan, `plan_name_taken` for a name the new team already uses.
   */
  public async change(change: AgentPlanAccessChange): Promise<number> {
    try {
      return await this.database.transaction((transaction) =>
        writeAccess(transaction, change),
      );
    } catch (error: unknown) {
      if (isNameViolation(error)) throw new AgentError("plan_name_taken");
      throw error;
    }
  }

  /**
   * Stores the approval of script steps; the revision of the plan stays.
   *
   * @throws {AgentError} `plan_conflict` when the plan changed since that revision.
   */
  public async approveScripts(
    change: AgentPlanScriptApprovalChange,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await lockRevision(transaction, change.planId, change.revision);
      const approvals = new AgentPlanScriptApprovalRepository(transaction);
      const audit = new AgentPlanAuditRepository(transaction);
      for (const approval of change.approvals) {
        await approvals.approve(change.planId, {
          ...approval,
          approvedBy: change.actorId,
        });
        await audit.append({
          planId: change.planId,
          actorId: change.actorId,
          action: "script_approved",
          revision: change.revision,
          details: approval,
        });
      }
    });
  }

  /** Records one entry of the history in a transaction of its own. */
  public async record(entry: AgentPlanAuditRecord): Promise<void> {
    await this.database.transaction((transaction) =>
      new AgentPlanAuditRepository(transaction).append(entry),
    );
  }
}

/** Locks the plan row and returns its owner and name, refusing another revision. */
async function lockRevision(
  transaction: DatabaseTransaction,
  planId: string,
  revision: number,
): Promise<{ readonly ownerId: string; readonly name: string }> {
  const [row] = await transaction.query(
    `
    SELECT
        revision,
        owner_id,
        name
    FROM agent_plans
    WHERE id = $id
    FOR UPDATE;
  `,
    { id: planId },
  );
  if (!row || readCountColumn(row, 0, "revision") !== revision)
    throw new AgentError("plan_conflict");
  return {
    ownerId: readTextColumn(row, 1, "owner_id"),
    name: readTextColumn(row, 2, "name"),
  };
}

async function writeAccess(
  transaction: DatabaseTransaction,
  change: AgentPlanAccessChange,
): Promise<number> {
  const stored = await lockRevision(
    transaction,
    change.planId,
    change.revision,
  );
  const audit = new AgentPlanAuditRepository(transaction);
  const next = change.revision + 1;
  if (change.teams) {
    await transaction.execute(
      `
      UPDATE agent_plans
      SET department_id = $department_id,
          name_key = $name_key
      WHERE id = $id;
    `,
      {
        id: change.planId,
        department_id: planNameDepartment(change.teams),
        name_key: agentPlanNameKey(stored.name),
      },
    );
    await new AgentPlanTeamRepository(transaction).replace(
      change.planId,
      change.teams,
    );
    await audit.append({
      planId: change.planId,
      actorId: change.actorId,
      action: "teams_changed",
      revision: next,
      details: { teams: change.teams },
    });
  }
  if (change.ownerId !== undefined && change.ownerId !== stored.ownerId) {
    await transaction.execute(
      `
      UPDATE agent_plans
      SET owner_id = $owner_id
      WHERE id = $id;
    `,
      { id: change.planId, owner_id: change.ownerId },
    );
    await audit.append({
      planId: change.planId,
      actorId: change.actorId,
      action: "owner_changed",
      revision: next,
      details: { from: stored.ownerId, to: change.ownerId },
    });
  }
  await transaction.execute(
    `
    UPDATE agent_plans
    SET revision = revision + 1,
        updated_by = $updated_by,
        updated_at = utc_now()
    WHERE id = $id;
  `,
    { id: change.planId, updated_by: change.actorId },
  );
  await change.journal?.(transaction);
  return next;
}
