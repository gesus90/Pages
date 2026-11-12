import { randomUUID } from "node:crypto";

import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type {
  DatabaseTransaction,
  DatabaseValue,
} from "@/backend/database/Database";
import type {
  AgentPlanAuditAction,
  AgentPlanAuditEntry,
} from "@/definition/AgentPlanTeam";

/** One entry to record, before it has an identifier and a time. */
export interface AgentPlanAuditRecord {
  readonly planId: string;
  readonly actorId: string;
  readonly action: AgentPlanAuditAction;
  readonly revision: number;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** A stored entry without the display name of its actor. */
export type StoredAgentPlanAuditEntry = Omit<AgentPlanAuditEntry, "actorName">;

const ACTIONS: readonly AgentPlanAuditAction[] = [
  "teams_changed",
  "owner_changed",
  "script_approved",
  "admin_saved",
  "admin_started",
  "admin_run_controlled",
  "admin_deleted",
];

function readAction(value: string): AgentPlanAuditAction {
  const action = ACTIONS.find((entry) => entry === value);
  if (!action) throw new Error(`Unknown plan history action "${value}".`);
  return action;
}

function readDetails(json: string): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(json);
  return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
    ? Object.fromEntries(Object.entries(parsed))
    : {};
}

function readEntry(row: readonly DatabaseValue[]): StoredAgentPlanAuditEntry {
  return {
    id: readTextColumn(row, 0, "id"),
    planId: readTextColumn(row, 1, "plan_id"),
    actorId: readTextColumn(row, 2, "actor_id"),
    action: readAction(readTextColumn(row, 3, "action")),
    revision: readCountColumn(row, 4, "revision"),
    details: readDetails(readTextColumn(row, 5, "details_json")),
    createdAt: readTextColumn(row, 6, "created_at"),
  };
}

/**
 * Records the history of a plan (PAGE-329): who changed teams or owner, who
 * approved which script hash, and every action of an administrator on a plan
 * of somebody else.
 */
export class AgentPlanAuditRepository {
  private readonly database: Pick<DatabaseTransaction, "query" | "execute">;

  public constructor(database: Pick<DatabaseTransaction, "query" | "execute">) {
    this.database = database;
  }

  /** Appends one entry, in the transaction of the change it records. */
  public async append(record: AgentPlanAuditRecord): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_audit (
          id,
          plan_id,
          actor_id,
          action,
          revision,
          details_json,
          created_at
      )
      VALUES (
          $id,
          $plan_id,
          $actor_id,
          $action,
          $revision,
          $details_json,
          $created_at
      );
    `,
      {
        id: randomUUID(),
        plan_id: record.planId,
        actor_id: record.actorId,
        action: record.action,
        revision: record.revision,
        details_json: JSON.stringify(record.details ?? {}),
        created_at: new Date().toISOString(),
      },
    );
  }

  /** Lists the newest entries of a plan first, at most `limit` of them. */
  public async list(
    planId: string,
    limit: number,
  ): Promise<readonly StoredAgentPlanAuditEntry[]> {
    const rows = await this.database.query(
      `
      SELECT
          id,
          plan_id,
          actor_id,
          action,
          revision,
          details_json,
          created_at
      FROM agent_plan_audit
      WHERE plan_id = $plan_id
      ORDER BY created_at DESC, id DESC
      LIMIT $limit;
    `,
      { plan_id: planId, limit },
    );
    return rows.map(readEntry);
  }
}
