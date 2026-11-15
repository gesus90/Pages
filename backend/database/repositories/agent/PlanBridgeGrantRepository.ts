import { readTextColumn } from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";

/** A stored grant of the plan bridge; it holds neither the bearer nor a usable credential. */
export interface StoredPlanBridgeGrant {
  /** SHA-256 of the bearer; it only finds the row. */
  readonly bearerHash: string;
  /** The stored hash of the step credential the grant stands for. */
  readonly credentialHash: string;
  readonly runId: string;
  readonly stepId: string;
  readonly instanceId: string;
  /** The step credential, sealed with a key only the bearer yields. */
  readonly sealedToken: string;
  /** Epoch milliseconds; zero means until revocation. */
  readonly expiresAt: number;
}

/** Stores the grants of the plan bridge so that they outlive the API process. */
export class PlanBridgeGrantRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Saves a new grant; neither the bearer nor the clear credential reaches SQL. */
  public async insert(
    grant: StoredPlanBridgeGrant,
    createdAt: number,
  ): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO agent_plan_bridge_grants (
          bearer_hash,
          credential_hash,
          run_id,
          step_id,
          instance_id,
          sealed_token,
          expires_at,
          created_at
      ) VALUES (
          $bearer_hash,
          $credential_hash,
          $run_id,
          $step_id,
          $instance_id,
          $sealed_token,
          $expires_at,
          $created_at
      );
    `,
      {
        bearer_hash: grant.bearerHash,
        credential_hash: grant.credentialHash,
        run_id: grant.runId,
        step_id: grant.stepId,
        instance_id: grant.instanceId,
        sealed_token: grant.sealedToken,
        expires_at: grant.expiresAt,
        created_at: createdAt,
      },
    );
  }

  /** Finds the grant of a bearer hash, whatever its state. */
  public async find(bearerHash: string): Promise<StoredPlanBridgeGrant | null> {
    const [row] = await this.database.query(
      `
      SELECT
          bearer_hash,
          credential_hash,
          run_id,
          step_id,
          instance_id,
          sealed_token,
          CAST(expires_at AS TEXT)
      FROM agent_plan_bridge_grants
      WHERE bearer_hash = $bearer_hash;
    `,
      { bearer_hash: bearerHash },
    );
    if (!row) return null;
    return {
      bearerHash: readTextColumn(row, 0, "bearer_hash"),
      credentialHash: readTextColumn(row, 1, "credential_hash"),
      runId: readTextColumn(row, 2, "run_id"),
      stepId: readTextColumn(row, 3, "step_id"),
      instanceId: readTextColumn(row, 4, "instance_id"),
      sealedToken: readTextColumn(row, 5, "sealed_token"),
      expiresAt: Number(readTextColumn(row, 6, "expires_at")),
    };
  }

  /** Removes the grant of one bearer hash. */
  public async delete(bearerHash: string): Promise<void> {
    await this.database.execute(
      `
      DELETE FROM agent_plan_bridge_grants
      WHERE bearer_hash = $bearer_hash;
    `,
      { bearer_hash: bearerHash },
    );
  }

  /** Removes the grants of one step, or of every step of a run. */
  public async revoke(runId: string, stepId: string | null): Promise<void> {
    const stepCondition = stepId === null ? "" : "AND step_id = $step_id";
    await this.database.execute(
      `
      DELETE FROM agent_plan_bridge_grants
      WHERE run_id = $run_id
          ${stepCondition};
    `,
      stepId === null ? { run_id: runId } : { run_id: runId, step_id: stepId },
    );
  }
}
