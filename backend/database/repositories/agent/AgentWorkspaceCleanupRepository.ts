import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";

import type { DatabaseValue } from "@/backend/database/Database";
import type { Database } from "@/backend/database/Database";
import type { AgentWorkspaceCleanup } from "@/definition/AgentWorkspaceCleanup";

function readCleanup(row: readonly DatabaseValue[]): AgentWorkspaceCleanup {
  return {
    workspaceId: readTextColumn(row, 0, "workspace_id"),
    workspaceName: readTextColumn(row, 1, "workspace_name"),
    runId: readTextColumn(row, 2, "run_id"),
    ownerId: readTextColumn(row, 3, "owner_id"),
    blocker: readTextColumn(row, 4, "blocker"),
    updatedAt: readTextColumn(row, 5, "updated_at"),
    state: row[6] === "needs_decision" ? "needs_decision" : "pending",
    attempts: readCountColumn(row, 7, "attempts"),
    nextAttemptAt: readCountColumn(row, 8, "next_attempt_at"),
    retryStartedAt: readTextColumn(row, 9, "retry_started_at"),
    eventRevision: readCountColumn(row, 10, "event_revision"),
    stopRevision: Number(row[11]),
  };
}

/** Durable cleanup obligations survive logical registration removal and server restarts. */
export class AgentWorkspaceCleanupRepository {
  private readonly database: Pick<Database, "query" | "execute">;

  public constructor(database: Pick<Database, "query" | "execute">) {
    this.database = database;
  }

  /** Returns the oldest pending owners first; no job identity is reconstructed from a path. */
  public async pending(): Promise<readonly AgentWorkspaceCleanup[]> {
    const rows = await this.database.query(
      `
      SELECT
          workspace_id,
          workspace_name,
          run_id,
          owner_id,
          blocker,
          updated_at,
          state,
          attempts,
          next_attempt_at,
          COALESCE(retry_started_at, requested_at),
          event_revision,
          stop_revision
      FROM agent_workspace_cleanup
      WHERE state = 'pending'
          AND next_attempt_at <= $now
      ORDER BY updated_at, workspace_id, run_id
      LIMIT 100;
    `,
      { now: Date.now() },
    );
    return rows.map(readCleanup);
  }

  /** Records actual cleanup progress; completed requires independently proven process freedom. */
  public async record(
    entry: AgentWorkspaceCleanup,
    state: "pending" | "needs_decision" | "completed",
    blocker: string,
  ): Promise<void> {
    await this.database.execute(
      `
      UPDATE agent_workspace_cleanup
      SET state = $state, blocker = $blocker, updated_at = utc_now()
      WHERE workspace_id = $workspace_id
          AND run_id = $run_id
          AND owner_id = $owner_id
          AND state <> 'completed'
          AND event_revision = $revision
          AND (state IS DISTINCT FROM $state OR blocker IS DISTINCT FROM $blocker);
    `,
      {
        workspace_id: entry.workspaceId,
        run_id: entry.runId,
        owner_id: entry.ownerId,
        state,
        blocker,
        revision: entry.eventRevision ?? 0,
      },
    );
  }

  /** A server restart permits one fresh check, including old unresolved obligations. */
  public async resetAtStartup(): Promise<void> {
    await this.database.execute(`
      UPDATE agent_workspace_cleanup
      SET next_attempt_at = 0, attempts = 0
      WHERE state = 'pending' AND (next_attempt_at <> 0 OR attempts <> 0);
    `);
  }

  /** Claims stop delivery before external calls, once per genuine run/runner event. */
  public async claimStop(entry: AgentWorkspaceCleanup): Promise<boolean> {
    const rows = await this.database.query(
      `
      UPDATE agent_workspace_cleanup
      SET stop_revision = event_revision
      WHERE workspace_id = $workspace_id
          AND run_id = $run_id
          AND owner_id = $owner_id
          AND state = 'pending'
          AND event_revision = $revision
          AND stop_revision <> event_revision
      RETURNING run_id;
    `,
      {
        workspace_id: entry.workspaceId,
        run_id: entry.runId,
        owner_id: entry.ownerId,
        revision: entry.eventRevision ?? 0,
      },
    );
    return rows.length > 0;
  }

  /** Stores retry bookkeeping without changing the time of unchanged business state. */
  public async failedAttempt(
    entry: AgentWorkspaceCleanup,
    blocker: string,
  ): Promise<void> {
    const attempts = (entry.attempts ?? 0) + 1;
    const timestamp = entry.retryStartedAt ?? entry.updatedAt;
    const startedAt = timestamp.includes("T")
      ? timestamp
      : `${timestamp.replace(" ", "T")}Z`;
    const age = Date.now() - Date.parse(startedAt);
    const state =
      attempts >= 8 || age >= 86_400_000 ? "needs_decision" : "pending";
    const delays = [2000, 10_000, 60_000, 300_000, 900_000];
    const delay = delays[Math.min(attempts - 1, delays.length - 1)] ?? 900_000;
    await this.database.execute(
      `
      UPDATE agent_workspace_cleanup
      SET attempts = $attempts, next_attempt_at = $next,
          updated_at = CASE WHEN state <> $state OR blocker <> $blocker THEN utc_now() ELSE updated_at END,
          state = $state, blocker = $blocker
      WHERE workspace_id = $workspace_id
          AND run_id = $run_id
          AND owner_id = $owner_id
          AND state = 'pending'
          AND event_revision = $revision;
    `,
      {
        workspace_id: entry.workspaceId,
        run_id: entry.runId,
        owner_id: entry.ownerId,
        revision: entry.eventRevision ?? 0,
        attempts,
        next: Date.now() + delay,
        state,
        blocker,
      },
    );
  }

  /** Explicitly retries one owned obligation, or records a person's process-end attestation. */
  public async decide(
    entry: AgentWorkspaceCleanup,
    action: "retry" | "release",
  ): Promise<void> {
    if (action === "release") {
      await this.record(
        entry,
        "completed",
        "manual_release_host_reboot_verified",
      );
      return;
    }
    await this.database.execute(
      `
      UPDATE agent_workspace_cleanup
      SET state = 'pending', attempts = 0, next_attempt_at = 0,
          retry_started_at = utc_now(), event_revision = event_revision + 1,
          updated_at = CASE WHEN state <> 'pending' THEN utc_now() ELSE updated_at END
      WHERE workspace_id = $workspace_id
          AND run_id = $run_id
          AND owner_id = $owner_id
          AND state <> 'completed';
    `,
      {
        workspace_id: entry.workspaceId,
        run_id: entry.runId,
        owner_id: entry.ownerId,
      },
    );
  }

  /** Lists only the executor's own obligations for this visible plan. */
  public async forPlan(
    userId: string,
    planId: string,
  ): Promise<readonly AgentWorkspaceCleanup[]> {
    const rows = await this.database.query(
      `
      SELECT
          cleanup.workspace_id,
          cleanup.workspace_name,
          cleanup.run_id,
          cleanup.owner_id,
          cleanup.blocker,
          cleanup.updated_at,
          cleanup.state,
          cleanup.attempts,
          cleanup.next_attempt_at,
          COALESCE(cleanup.retry_started_at, cleanup.requested_at),
          cleanup.event_revision,
          cleanup.stop_revision
      FROM agent_workspace_cleanup AS cleanup
      INNER JOIN agent_plan_runs AS runs ON runs.id = cleanup.run_id
      WHERE cleanup.state <> 'completed'
          AND cleanup.owner_id = $user_id
          AND runs.plan_id = $plan_id
      ORDER BY cleanup.updated_at, cleanup.workspace_id, cleanup.run_id;
    `,
      { user_id: userId, plan_id: planId },
    );
    return rows.map(readCleanup);
  }
}
