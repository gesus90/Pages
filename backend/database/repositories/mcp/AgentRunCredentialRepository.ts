import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type {
  AgentRunScope,
  AgentRunTicket,
} from "@/definition/McpAuthorization";

/** A stored credential of an agent plan session, without its hash. */
export interface StoredRunCredential {
  readonly id: string;
  readonly userId: string;
  readonly scope: AgentRunScope;
  readonly expiresAt: number;
}

/** What a new credential is stored with. */
export interface RunCredentialRecord extends StoredRunCredential {
  readonly tokenHash: string;
  readonly createdAt: number;
}

function readStrings(text: string): readonly string[] {
  const parsed: unknown = JSON.parse(text);
  return Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readTickets(text: string): readonly AgentRunTicket[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return [];
    const id: unknown = Reflect.get(entry, "id");
    const key: unknown = Reflect.get(entry, "key");
    return typeof id === "string" && typeof key === "string"
      ? [{ id, key }]
      : [];
  });
}

/** Stores the hashed credentials of agent plan sessions and ends them. */
export class AgentRunCredentialRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Saves a new credential; the clear text never reaches SQL. */
  public async insert(record: RunCredentialRecord): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_run_credentials (
          id,
          user_id,
          run_id,
          step_id,
          token_hash,
          operations_json,
          ticket_ids_json,
          created_at,
          expires_at,
          revoked_at
      ) VALUES (
          $id,
          $user_id,
          $run_id,
          $step_id,
          $token_hash,
          $operations_json,
          $ticket_ids_json,
          $created_at,
          $expires_at,
          NULL
      );
    `,
      {
        id: record.id,
        user_id: record.userId,
        run_id: record.scope.runId,
        step_id: record.scope.stepId,
        token_hash: record.tokenHash,
        operations_json: JSON.stringify(record.scope.operations),
        ticket_ids_json: JSON.stringify(record.scope.tickets),
        created_at: record.createdAt,
        expires_at: record.expiresAt,
      },
    );
  }

  /** Finds a credential that is neither revoked nor expired. */
  public async findValid(
    tokenHash: string,
    now: number,
  ): Promise<StoredRunCredential | null> {
    const [row] = await this.database.query(
      `
      SELECT
          id,
          user_id,
          run_id,
          step_id,
          operations_json,
          ticket_ids_json,
          CAST(expires_at AS TEXT)
      FROM agent_run_credentials
      WHERE token_hash = $token_hash
          AND revoked_at IS NULL
          AND expires_at > $now;
    `,
      { token_hash: tokenHash, now },
    );
    if (!row) return null;
    return {
      id: readTextColumn(row, 0, "id"),
      userId: readTextColumn(row, 1, "user_id"),
      scope: {
        runId: readTextColumn(row, 2, "run_id"),
        stepId: readTextColumn(row, 3, "step_id"),
        operations: readStrings(readTextColumn(row, 4, "operations_json")),
        tickets: readTickets(readTextColumn(row, 5, "ticket_ids_json")),
      },
      expiresAt: Number(readTextColumn(row, 6, "expires_at")),
    };
  }

  /**
   * Ends every credential of one node, or of every node of a run.
   *
   * @returns The number of credentials that were still valid.
   */
  public async revoke(
    runId: string,
    stepId: string | null,
    now: number,
  ): Promise<number> {
    const stepCondition = stepId === null ? "" : "AND step_id = $step_id";
    const rows = await this.database.query(
      `
      UPDATE agent_run_credentials
      SET revoked_at = $now
      WHERE run_id = $run_id
          ${stepCondition}
          AND revoked_at IS NULL
      RETURNING CAST(expires_at AS TEXT);
    `,
      stepId === null
        ? { run_id: runId, now }
        : { run_id: runId, step_id: stepId, now },
    );
    return rows.filter(
      (row) => Number(readTextColumn(row, 0, "expires_at")) > now,
    ).length;
  }
}
