import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import { readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";

import { AgentPlanContinuationRepository } from "./AgentPlanContinuationRepository";
import { AgentPlanProgressRepository } from "./AgentPlanProgressRepository";

import type { AgentPlanRunJournal } from "@/backend/service/agents/AgentPlanJournal";
import type { PlanContinuationWrite } from "./AgentPlanContinuationRepository";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";

/** A run by its start and status, without its private snapshot or its results. */
export interface AgentPlanRunEntry {
  readonly id: string;
  readonly startedAt: string;
  readonly status: AgentPlanRun["status"];
}

function readRunStatus(input: string): AgentPlanRun["status"] {
  if (
    input !== "running" &&
    input !== "pausing" &&
    input !== "stopping" &&
    input !== "succeeded" &&
    input !== "failed" &&
    input !== "cancelled" &&
    input !== "paused"
  )
    throw new AgentError("plan_invalid");
  return input;
}

/** Durable sanitized run views and transactional working-copy reservations. */
export class AgentPlanRunRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction"
  >;
  private readonly continuations: AgentPlanContinuationRepository;
  private readonly progress: AgentPlanProgressRepository;

  public constructor(
    database: Pick<Database, "query" | "execute" | "transaction">,
  ) {
    this.database = database;
    this.continuations = new AgentPlanContinuationRepository(database);
    this.progress = new AgentPlanProgressRepository(database);
  }

  /** Rejects stale Play requests and reserves all writing directories before any starts. */
  public async create(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    workspaceIds: readonly string[],
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await this.insert(transaction, run, snapshot, workspaceIds);
      await journal?.(transaction, run);
    });
  }

  /**
   * Creates a run like {@link create}, inside a transaction that also stores other changes.
   *
   * @remarks
   * The revision check reads the plan within the same transaction, so a plan
   * revision written before it in that transaction is the one the run must
   * name.
   */
  public async insert(
    transaction: DatabaseTransaction,
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    workspaceIds: readonly string[],
  ): Promise<void> {
    const [plan] = await transaction.query(
      "SELECT revision FROM agent_plans WHERE id = $id;",
      { id: run.planId },
    );
    if (!plan || Number(plan[0]) !== run.planRevision)
      throw new AgentError("plan_conflict");
    const [active] = await transaction.query(
      `
      SELECT id
      FROM agent_plan_runs
      WHERE plan_id = $plan_id
          AND (status IN ('running', 'pausing', 'paused', 'stopping')
              OR id IN (SELECT run_id FROM agent_plan_workspace_locks));
    `,
      { plan_id: run.planId },
    );
    if (active) throw new AgentError("plan_run_unavailable");
    for (const workspaceId of new Set(workspaceIds)) {
      const [lock] = await transaction.query(
        "SELECT run_id FROM agent_plan_workspace_locks WHERE workspace_id = $id;",
        { id: workspaceId },
      );
      if (lock) throw new AgentError("plan_workspace_conflict");
      await transaction.execute(
        `
        INSERT INTO agent_plan_workspace_locks (workspace_id, run_id)
        VALUES ($workspace_id, $run_id);
      `,
        { workspace_id: workspaceId, run_id: run.id },
      );
    }
    await transaction.execute(
      `
      INSERT INTO agent_plan_runs (
          id,
          plan_id,
          user_id,
          project_id,
          workspace_id,
          started_at,
          status,
          view_json,
          snapshot_json
      ) VALUES ($id, $plan_id, $user_id, $project_id, $workspace_id, $started_at, $status, $view_json, $snapshot_json);
    `,
      {
        id: run.id,
        plan_id: run.planId,
        user_id: run.userId,
        project_id: snapshot.plan.projectId,
        workspace_id: snapshot.plan.workspaceId,
        started_at: run.startedAt,
        status: run.status,
        view_json: JSON.stringify(run),
        snapshot_json: JSON.stringify(snapshot),
      },
    );
  }

  /** Latest state is summarized by the service before being exposed to other plan readers. */
  public async latest(planId: string): Promise<AgentPlanRun | null> {
    const [row] = await this.database.query(
      `
      SELECT view_json
      FROM agent_plan_runs
      WHERE plan_id = $plan_id
      ORDER BY started_at DESC, id DESC
      LIMIT 1;
    `,
      { plan_id: planId },
    );
    return row
      ? readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json")))
      : null;
  }

  /** Unconfirmed cleanup prevents another start even after a terminal error. */
  public async hasReservation(runId: string): Promise<boolean> {
    const [row] = await this.database.query(
      `
      SELECT workspace_id
      FROM agent_plan_workspace_locks
      WHERE run_id = $run_id
      LIMIT 1;
    `,
      { run_id: runId },
    );
    return Boolean(row);
  }

  /** Reads only the public record; service authorization still precedes delivery. */
  public async find(id: string): Promise<AgentPlanRun | null> {
    const [row] = await this.database.query(
      "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
      { id },
    );
    const input: unknown = row
      ? JSON.parse(readTextColumn(row, 0, "view_json"))
      : null;
    return input === null ? null : readPlanRun(input);
  }

  /** Keeps private snapshot content off the read API while exposing references for live authorization. */
  public async resources(id: string): Promise<AgentPlanRunResources> {
    const snapshots = await this.continuations.snapshots(id);
    const references = snapshots.map(readPlanRunResources);
    const first = references[0];
    if (!first) throw new AgentError("plan_access_denied");
    return {
      projectId: first.projectId,
      workspaceIds: [
        ...new Set(references.flatMap((entry) => entry.workspaceIds)),
      ],
      agentIds: [...new Set(references.flatMap((entry) => entry.agentIds))],
      connectionIds: [
        ...new Set(references.flatMap((entry) => entry.connectionIds ?? [])),
      ],
      taskIds: [...new Set(references.flatMap((entry) => entry.taskIds))],
      wikiIds: [...new Set(references.flatMap((entry) => entry.wikiIds))],
      ticketIds: [...new Set(references.flatMap((entry) => entry.ticketIds))],
      ticketAssets: references.flatMap((entry) => entry.ticketAssets ?? []),
    };
  }

  /** Names the agent of one node from the private snapshot, without disclosing anything else. */
  public async stepAgent(id: string, stepId: string): Promise<string | null> {
    const snapshots = await this.continuations.snapshots(id);
    const snapshot = readAgentObject(snapshots[0]);
    const steps: readonly unknown[] = Array.isArray(snapshot.steps)
      ? snapshot.steps
      : [];
    for (const entry of steps) {
      const step = readAgentObject(readAgentObject(entry).step);
      if (step.id === stepId && typeof step.agentId === "string")
        return step.agentId;
    }
    return null;
  }

  /** Returns unfinished public records for service-controlled recovery after restart. */
  public async unfinished(): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(
      "SELECT view_json FROM agent_plan_runs WHERE status IN ('running', 'pausing', 'paused', 'stopping');",
    );
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Persists interrupted progress while retaining reservations for unknown processes. */
  public async interrupt(run: AgentPlanRun): Promise<void> {
    await this.progress.interrupt(run);
  }

  /**
   * Lists ended runs that still reserve a working copy.
   *
   * @remarks
   * Only an interrupted run keeps its reservations after it ended, because
   * processes of its sessions might still have been writing.
   */
  public async reserving(): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(`
      SELECT view_json
      FROM agent_plan_runs
      WHERE status NOT IN ('running', 'pausing', 'paused', 'stopping')
          AND id IN (
              SELECT run_id
              FROM agent_plan_workspace_locks
          );
    `);
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Releases the working copies an ended run still reserves. */
  public async release(id: string): Promise<void> {
    await this.database.execute(
      `
        DELETE FROM agent_plan_workspace_locks
        WHERE run_id = $id
            AND run_id IN (
                SELECT id
                FROM agent_plan_runs
                WHERE status NOT IN ('running', 'pausing', 'paused', 'stopping')
            );
      `,
      { id },
    );
  }

  /** History is restricted to the executor and the latest twenty runs of the selected plan. */
  public async list(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(
      `
      SELECT view_json
      FROM agent_plan_runs
      WHERE user_id = $user_id
          AND plan_id = $plan_id
      ORDER BY started_at DESC, id DESC
      LIMIT 20;
    `,
      { user_id: userId, plan_id: planId },
    );
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /**
   * Lists every run one person started of a plan, ordered by start.
   *
   * @param userId - The executor; runs of others are never part of it.
   * @param planId - The plan.
   * @param order - `newest` first or `oldest` first; the identifier breaks ties.
   */
  public async entries(
    userId: string,
    planId: string,
    order: "newest" | "oldest",
  ): Promise<readonly AgentPlanRunEntry[]> {
    const direction = order === "newest" ? "DESC" : "ASC";
    const rows = await this.database.query(
      `
      SELECT
          id,
          started_at,
          status
      FROM agent_plan_runs
      WHERE user_id = $user_id
          AND plan_id = $plan_id
      ORDER BY started_at ${direction}, id ${direction};
    `,
      { user_id: userId, plan_id: planId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      startedAt: readTextColumn(row, 1, "started_at"),
      status: readRunStatus(readTextColumn(row, 2, "status")),
    }));
  }

  /** Releases workspace reservations only after every recorded session confirms cleanup. */
  public async update(
    run: AgentPlanRun,
    checkpoint?: AgentPlanCheckpointInput,
    continuation?: Omit<PlanContinuationWrite, "run">,
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    if (continuation)
      await this.continuations.adopt({ ...continuation, run }, journal);
    else await this.progress.update(run, checkpoint, journal);
  }
}
