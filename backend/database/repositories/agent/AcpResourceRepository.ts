import {
  readCountColumn,
  readNullableTextColumn,
  readTextColumn,
} from "@/backend/database/RowValue";
import { readOwnedNamespace } from "@/definition/AcpNamespace";
import {
  ACP_RELEASE_REASONS,
  ACP_RETAIN_REASONS,
} from "@/definition/AcpResource";

import type { Database } from "@/backend/database/Database";
import type { AcpResourceStore } from "@/backend/service/agents/resources/AcpResourceStore";
import type {
  AcpLeaseCheck,
  AcpLeaseCheckReason,
  AcpLeaseLifecycle,
  AcpNamespaceOwner,
  AcpResourceRecord,
  AcpResourceRunReference,
  AcpResourceState,
} from "@/definition/AcpResource";
import type { AcpLeaseRelease } from "@/backend/service/agents/resources/AcpResourceStore";

const LIFECYCLES: readonly AcpLeaseLifecycle[] = [
  "reserved",
  "spawning",
  "not_spawned",
  "process",
];
const CHECK_REASONS: readonly AcpLeaseCheckReason[] = [
  ...ACP_RELEASE_REASONS,
  ...ACP_RETAIN_REASONS,
];

function namespaceIdentity(value: string | null): AcpNamespaceOwner | null {
  if (value === null) return null;
  return readOwnedNamespace(JSON.parse(value));
}

function lifecycle(input: string | null): AcpLeaseLifecycle | null {
  if (input === null) return null;
  const known = LIFECYCLES.find((entry) => entry === input);
  if (!known) throw new Error("Invalid ACP lease lifecycle");
  return known;
}

/** An unknown stored reason is shown as a failed check instead of hiding the lease. */
function check(reason: string | null, at: string | null): AcpLeaseCheck | null {
  if (reason === null || at === null) return null;
  return {
    reason: CHECK_REASONS.find((entry) => entry === reason) ?? "check_failed",
    at,
  };
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
          namespace_identity,
          lifecycle,
          check_reason,
          checked_at,
          worker_unit
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
        lifecycle: lifecycle(readNullableTextColumn(row, 8, "lifecycle")),
        check: check(
          readNullableTextColumn(row, 9, "check_reason"),
          readNullableTextColumn(row, 10, "checked_at"),
        ),
        workerUnit: readNullableTextColumn(row, 11, "worker_unit"),
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

  /**
   * Releases an unconfirmed lease only while it is still unconfirmed.
   *
   * @returns `released`, `absent` when it was already gone, or `changed` when
   * its state changed meanwhile and the lease stays.
   */
  public async releaseUncertain(instanceId: string): Promise<AcpLeaseRelease> {
    const deleted = await this.database.query(
      `
      DELETE FROM acp_resource_leases
      WHERE instance_id = $instance_id
        AND state = 'cleanup_failed'
      RETURNING instance_id;
    `,
      { instance_id: instanceId },
    );
    if (deleted.length > 0) return "released";
    const [remaining] = await this.database.query(
      "SELECT instance_id FROM acp_resource_leases WHERE instance_id = $instance_id;",
      { instance_id: instanceId },
    );
    return remaining ? "changed" : "absent";
  }

  /** Stores the result of a periodic check on a lease that is still unconfirmed. */
  public async recordCheck(
    instanceId: string,
    result: AcpLeaseCheck,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE acp_resource_leases
      SET
          check_reason = $check_reason,
          checked_at = $checked_at
      WHERE instance_id = $instance_id
        AND state = 'cleanup_failed';
    `,
      {
        instance_id: instanceId,
        check_reason: result.reason,
        checked_at: result.at,
      },
    );
  }

  /** Plan names of the runs that hold leases, for the administrative resource view. */
  public async runReferences(
    runIds: readonly string[],
  ): Promise<readonly AcpResourceRunReference[]> {
    if (runIds.length === 0) return [];
    const placeholders = runIds.map((_, index) => `$run_id_${index}`);
    const rows = await this.database.query(
      `
      SELECT
          plan_run.id,
          plan_run.plan_id,
          plan.name,
          plan_run.started_at,
          plan_run.status
      FROM agent_plan_runs AS plan_run
      JOIN agent_plans AS plan
          ON plan.id = plan_run.plan_id
      WHERE plan_run.id IN (${placeholders.join(", ")});
    `,
      Object.fromEntries(
        runIds.map((runId, index) => [`run_id_${index}`, runId]),
      ),
    );
    return rows.map((row) => ({
      runId: readTextColumn(row, 0, "id"),
      planId: readTextColumn(row, 1, "plan_id"),
      planName: readTextColumn(row, 2, "name"),
      startedAt: readTextColumn(row, 3, "started_at"),
      status: readTextColumn(row, 4, "status"),
    }));
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
          namespace_identity,
          lifecycle,
          worker_unit
      )
      VALUES ($instance_id, $user_id, $provider, $run_id, $step_id, $state, $since, $namespace_identity, $lifecycle, $worker_unit)
      ON CONFLICT (instance_id) DO UPDATE SET
          state = excluded.state,
          step_id = excluded.step_id,
          namespace_identity = excluded.namespace_identity,
          lifecycle = COALESCE(excluded.lifecycle, acp_resource_leases.lifecycle),
          worker_unit = COALESCE(excluded.worker_unit, acp_resource_leases.worker_unit);
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
        lifecycle: record.lifecycle ?? null,
        worker_unit: record.workerUnit ?? null,
      },
    );
  }
}
