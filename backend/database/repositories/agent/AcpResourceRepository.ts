import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { readOwnedNamespace } from "@/definition/AcpNamespace";

import type { Database } from "@/backend/database/Database";
import type { AcpResourceStore } from "@/backend/service/agents/resources/AcpResourceStore";
import type {
  AcpNamespaceOwner,
  AcpResourceRecord,
  AcpResourceState,
} from "@/definition/AcpResource";

function namespaceIdentity(value: string | null): AcpNamespaceOwner | null {
  if (value === null) return null;
  return readOwnedNamespace(JSON.parse(value));
}

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
  private readonly database: Pick<Database, "query" | "execute"> &
    Partial<Pick<Database, "transaction">>;

  public constructor(
    database: Pick<Database, "query" | "execute"> &
      Partial<Pick<Database, "transaction">>,
  ) {
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
          since,
          namespace_identity
      FROM acp_resource_leases
      ORDER BY since, instance_id;
    `);
    return rows.map((row) => {
      const provider = readTextColumn(row, 2, "provider");
      if (
        provider !== "codex_cli" &&
        provider !== "claude_code" &&
        provider !== "opencode" &&
        provider !== "antigravity"
      )
        throw new Error("Invalid ACP lease provider");
      return {
        instanceId: readTextColumn(row, 0, "instance_id"),
        userId: readTextColumn(row, 1, "user_id"),
        provider,
        runId: readNullableTextColumn(row, 3, "run_id"),
        stepId: readNullableTextColumn(row, 4, "step_id"),
        state: state(readTextColumn(row, 5, "state")),
        since: readTextColumn(row, 6, "since"),
        namespace: namespaceIdentity(
          readNullableTextColumn(row, 7, "namespace_identity"),
        ),
      };
    });
  }

  /** Upserts before spawn and on lifecycle transitions; contains no prompts or credentials. */
  public async save(record: AcpResourceRecord): Promise<void> {
    await this.writeRecord(this.database, record);
  }

  /** Counts all service leases and reserves the next slot inside the shared writer transaction. */
  public async tryReserve(
    record: AcpResourceRecord,
    limit: number,
  ): Promise<boolean> {
    if (!this.database.transaction)
      throw new Error("Shared ACP admission requires database transactions");
    return this.database.transaction(async (transaction) => {
      const [count] = await transaction.query(
        "SELECT COUNT(*) AS occupied FROM acp_resource_leases;",
      );
      if (!count || readCountColumn(count, 0, "occupied") >= limit)
        return false;
      const [existing] = await transaction.query(
        "SELECT instance_id FROM acp_resource_leases WHERE instance_id = $id;",
        { id: record.instanceId },
      );
      if (existing) return false;
      await this.writeRecord(transaction, record);
      return true;
    });
  }

  /** Deletes only after the scheduler has proved that no process remains. */
  public async remove(instanceId: string): Promise<void> {
    await this.database.execute(
      "DELETE FROM acp_resource_leases WHERE instance_id = $instance_id;",
      { instance_id: instanceId },
    );
  }
  private async writeRecord(
    executor: Pick<Database, "execute">,
    record: AcpResourceRecord,
  ): Promise<void> {
    await executor.execute(
      `
      INSERT INTO acp_resource_leases (
          instance_id,
          user_id,
          provider,
          run_id,
          step_id,
          state,
          since,
          namespace_identity
      )
      VALUES ($instance_id, $user_id, $provider, $run_id, $step_id, $state, $since, $namespace_identity)
      ON CONFLICT (instance_id) DO UPDATE SET
          state = excluded.state,
          step_id = excluded.step_id,
          namespace_identity = excluded.namespace_identity;
    `,
      {
        instance_id: record.instanceId,
        user_id: record.userId,
        provider: record.provider,
        run_id: record.runId,
        step_id: record.stepId,
        state: record.state,
        since: record.since,
        namespace_identity: record.namespace
          ? JSON.stringify(record.namespace)
          : null,
      },
    );
  }
}
