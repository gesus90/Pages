import {
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";

import type { Database } from "@/backend/database/Database";
import type { AcpResourceStore } from "@/backend/service/agents/resources/AcpResourceStore";
import type {
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";

function state(input: string): AcpResourceState {
  if (
    input === "starting" ||
    input === "running" ||
    input === "idle" ||
    input === "closing" ||
    input === "cleanup_failed"
  )
    return input;
  throw new Error("Invalid ACP lease state");
}

/** Durable capacity journal independent of whether a run managed to record its process start. */
export class AcpResourceRepository implements AcpResourceStore {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Lists unreleased leases, including failed cleanup from previous server lifetimes. */
  public async list(): Promise<readonly AcpResourceRecord[]> {
    const rows = await this.database.query(`
      SELECT
          instance_id,
          user_id,
          provider,
          run_id,
          step_id,
          state,
          since
      FROM acp_resource_leases
      ORDER BY since, instance_id;
    `);
    return rows.map((row) => {
      const provider = readTextColumn(row, 2, "provider");
      if (provider !== "codex_cli" && provider !== "claude_code")
        throw new Error("Invalid ACP lease provider");
      return {
        instanceId: readTextColumn(row, 0, "instance_id"),
        userId: readTextColumn(row, 1, "user_id"),
        provider,
        runId: readNullableTextColumn(row, 3, "run_id"),
        stepId: readNullableTextColumn(row, 4, "step_id"),
        state: state(readTextColumn(row, 5, "state")),
        since: readTextColumn(row, 6, "since"),
      };
    });
  }

  /** Upserts before spawn and on lifecycle transitions; contains no prompts or credentials. */
  public async save(record: AcpResourceRecord): Promise<void> {
    await this.database.execute(
      `
      INSERT INTO acp_resource_leases (
          instance_id,
          user_id,
          provider,
          run_id,
          step_id,
          state,
          since
      )
      VALUES ($instance_id, $user_id, $provider, $run_id, $step_id, $state, $since)
      ON CONFLICT (instance_id) DO UPDATE SET
          state = excluded.state,
          step_id = excluded.step_id;
    `,
      {
        instance_id: record.instanceId,
        user_id: record.userId,
        provider: record.provider,
        run_id: record.runId,
        step_id: record.stepId,
        state: record.state,
        since: record.since,
      },
    );
  }

  /** Deletes only after the scheduler has proved that no process remains. */
  public async remove(instanceId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM acp_resource_leases WHERE instance_id = $instance_id;",
      { instance_id: instanceId },
    );
  }
}
