import { readPlanCheckpoint } from "@/backend/agents/AgentPlanRecoveryInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentPlanRecoveryError } from "@/backend/error/AgentPlanRecoveryError";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type {
  AgentPlanCheckpoint,
  AgentPlanCheckpointInput,
} from "@/definition/AgentPlanRecovery";

/** The serialized UTF-8 bound includes result text and business assessments. */
export const MAXIMUM_PLAN_CHECKPOINT_BYTES = 2_097_152;

/** Immutable completions share the transaction of their run view. */
export class AgentPlanCheckpointRepository {
  private readonly database: Pick<Database, "query">;

  public constructor(database: Pick<Database, "query">) {
    this.database = database;
  }

  /** Appends once per run/node; a repeated completion must be byte-equivalent after validation. */
  public async append(
    transaction: DatabaseTransaction,
    input: AgentPlanCheckpointInput,
    runRevision: number,
  ): Promise<void> {
    if (
      Buffer.byteLength(JSON.stringify(input), "utf8") >
      MAXIMUM_PLAN_CHECKPOINT_BYTES
    )
      throw new AgentPlanRecoveryError("checkpoint_too_large");
    const [existing] = await transaction.query(
      `
        SELECT checkpoint_json
        FROM agent_plan_checkpoints
        WHERE run_id = $run_id
            AND step_id = $step_id;
      `,
      { run_id: input.runId, step_id: input.stepId },
    );
    if (existing) {
      const saved = readPlanCheckpoint(
        JSON.parse(readTextColumn(existing, 0, "checkpoint_json")),
      );
      const repeated = readPlanCheckpoint({
        ...input,
        version: saved.version,
        runRevision: saved.runRevision,
      });
      if (JSON.stringify(saved) !== JSON.stringify(repeated))
        throw new AgentPlanRecoveryError("checkpoint_invalid");
      return;
    }
    const [latest] = await transaction.query(
      `
        SELECT COALESCE(MAX(version), 0)
        FROM agent_plan_checkpoints
        WHERE run_id = $run_id;
      `,
      { run_id: input.runId },
    );
    const version = Number(latest?.[0] ?? 0) + 1;
    const checkpoint = readPlanCheckpoint({ ...input, version, runRevision });
    const serialized = JSON.stringify(checkpoint);
    if (Buffer.byteLength(serialized, "utf8") > MAXIMUM_PLAN_CHECKPOINT_BYTES)
      throw new AgentPlanRecoveryError("checkpoint_too_large");
    await transaction.execute(
      `
        INSERT INTO agent_plan_checkpoints (
            run_id,
            version,
            step_id,
            run_revision,
            checkpoint_json
        )
        VALUES ($run_id, $version, $step_id, $run_revision, $checkpoint_json);
      `,
      {
        run_id: input.runId,
        version,
        step_id: input.stepId,
        run_revision: runRevision,
        checkpoint_json: serialized,
      },
    );
  }

  /** Reads one version, or the latest; the caller must authorize the owning run first. */
  public async find(
    runId: string,
    version?: number,
  ): Promise<AgentPlanCheckpoint | null> {
    const [row] = await this.database.query(
      `
        SELECT checkpoint_json
        FROM agent_plan_checkpoints
        WHERE run_id = $run_id
            AND ($version IS NULL OR version = $version)
        ORDER BY version DESC
        LIMIT 1;
      `,
      { run_id: runId, version: version ?? null },
    );
    return row
      ? readPlanCheckpoint(
          JSON.parse(readTextColumn(row, 0, "checkpoint_json")),
        )
      : null;
  }

  /** Every completion of a run, by version; at most one per node. */
  public async list(runId: string): Promise<readonly AgentPlanCheckpoint[]> {
    const rows = await this.database.query(
      `
        SELECT checkpoint_json
        FROM agent_plan_checkpoints
        WHERE run_id = $run_id
        ORDER BY version;
      `,
      { run_id: runId },
    );
    return rows.map((row) =>
      readPlanCheckpoint(JSON.parse(readTextColumn(row, 0, "checkpoint_json"))),
    );
  }
}
