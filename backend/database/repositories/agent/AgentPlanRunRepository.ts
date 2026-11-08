import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";
import { workspaceReferenceIds } from "@/backend/agents/AgentWorkspaceReferences";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { readPlanBranchState } from "@/backend/service/agents/branching/AgentPlanBranchPersistence";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import { AgentWorkspaceReferencesRepository } from "./AgentWorkspaceReferencesRepository";
import {
  reservePlanResources,
  retireRestartSource,
  findPlanResourceBlocker,
} from "./AgentPlanResourceReservation";
import { AgentPlanContinuationRepository } from "./AgentPlanContinuationRepository";
import { AgentPlanProgressRepository } from "./AgentPlanProgressRepository";
import { queueEarlierRunPurge } from "./AgentPlanRunPurge";
import {
  AgentPlanRunVisibilityRepository,
  planRunResourcesOf,
  readRunStatus,
} from "./AgentPlanRunVisibilityRepository";

import type { AgentPlanWriterWait } from "@/definition/AgentPlanExecution";
import type { PlanBranchingState } from "@/backend/service/agents/branching/AgentPlanBranchState";
import type { AgentPlanRunJournal } from "@/backend/service/agents/AgentPlanJournal";
import type { PlanContinuationWrite } from "./AgentPlanContinuationRepository";
import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSessionRecord } from "@/definition/AgentPlanSession";
import type { AgentPlanCheckpointInput } from "@/definition/AgentPlanRecovery";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { AgentPlanRunVisibilityBasis } from "./AgentPlanRunVisibilityRepository";

/** A run by its start and status, without its private snapshot or its results. */
export interface AgentPlanRunEntry {
  readonly id: string;
  readonly startedAt: string;
  readonly status: AgentPlanRun["status"];
}

/** The latest run one person started of a plan, without its view, snapshot or results. */
export interface AgentPlanLatestRunEntry extends AgentPlanRunEntry {
  readonly planId: string;
  /** Rises with every committed write of the run. */
  readonly revision: number;
}

/** Who started a run and of which plan, without its view or snapshot. */
export interface AgentPlanRunOwnership {
  readonly userId: string;
  readonly planId: string;
}

/**
 * Parses a stored record; whatever fails while parsing means the record is damaged.
 *
 * @remarks
 * The query runs before this, so a database failure stays what it is.
 *
 * @throws {AgentError} `plan_run_unreadable` for damaged JSON or an unknown structure.
 */
function readStoredRecord<Result>(read: () => Result): Result {
  try {
    return read();
  } catch (error: unknown) {
    logCaughtError("AgentPlanRunRepository", error);

    throw new AgentError("plan_run_unreadable");
  }
}

/** Durable sanitized run views and transactional working-copy reservations. */
export class AgentPlanRunRepository {
  private readonly database: Pick<
    Database,
    "query" | "execute" | "transaction" | "agentFiles"
  >;
  private readonly continuations: AgentPlanContinuationRepository;
  private readonly progress: AgentPlanProgressRepository;
  private readonly visibility: AgentPlanRunVisibilityRepository;
  private readonly prepared = new WeakMap<
    AgentPlanSnapshot,
    Map<string, string>
  >();

  public constructor(
    database: Pick<
      Database,
      "query" | "execute" | "transaction" | "agentFiles"
    >,
  ) {
    this.database = database;
    this.continuations = new AgentPlanContinuationRepository(database);
    this.progress = new AgentPlanProgressRepository(database);
    this.visibility = new AgentPlanRunVisibilityRepository(database);
  }

  /** Synchronizes the immutable basis before a caller opens its recording transaction. */
  public async prepareSnapshot(
    runId: string,
    snapshot: AgentPlanSnapshot,
  ): Promise<void> {
    const references = this.prepared.get(snapshot) ?? new Map<string, string>();
    if (references.has(runId)) return;
    const reference: unknown = JSON.parse(
      await requireAgentFiles(this.database).write(
        snapshot.plan.id,
        JSON.stringify(snapshot),
      ),
    );
    if (typeof reference !== "object" || reference === null)
      throw new Error("Invalid prepared snapshot.");
    references.set(
      runId,
      JSON.stringify({
        ...reference,
        workspaceReferences: [...workspaceReferenceIds(snapshot)].map(
          (workspaceId) => ({ workspaceId }),
        ),
      }),
    );
    this.prepared.set(snapshot, references);
  }

  /** Rejects stale Play requests and reserves all writing directories before any starts. */
  public async create(
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    workspaceIds: readonly string[],
    journal?: AgentPlanRunJournal,
  ): Promise<void> {
    await this.prepareSnapshot(run.id, snapshot);
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
   * name. A genuinely new run, one without an origin, also records that the
   * earlier runs of its plan go; a recovery keeps them.
   */
  public async insert(
    transaction: DatabaseTransaction,
    run: AgentPlanRun,
    snapshot: AgentPlanSnapshot,
    workspaceIds: readonly string[],
  ): Promise<void> {
    const reference = this.prepared.get(snapshot)?.get(run.id);
    if (!reference)
      throw new Error("Snapshot must be synchronized before its transaction.");
    const [plan] = await transaction.query(
      "SELECT revision FROM agent_plans WHERE id = $id;",
      { id: run.planId },
    );
    if (!plan || Number(plan[0]) !== run.planRevision)
      throw new AgentError("plan_conflict");
    await new AgentWorkspaceReferencesRepository(transaction).requireReferences(
      snapshot,
    );
    await retireRestartSource(transaction, run);
    const [active] = await transaction.query(
      `
      SELECT id
      FROM agent_plan_runs
      WHERE plan_id = $plan_id
          AND status IN ('running', 'pausing', 'paused', 'stopping');
    `,
      { plan_id: run.planId },
    );
    if (active) throw new AgentError("plan_run_unavailable");
    await reservePlanResources(transaction, run.id, workspaceIds);
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
          snapshot_json,
          snapshot_file
      ) VALUES ($id, $plan_id, $user_id, $project_id, $workspace_id, $started_at, $status, $view_json, $snapshot_json, $snapshot_file);
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
        snapshot_json: "{}",
        snapshot_file: reference,
      },
    );
    if (!run.origin) await queueEarlierRunPurge(transaction, run.id);
  }

  /** Acquires actual writer resources together, or leaves this run visibly queued. */
  public async reserve(
    runId: string,
    resourceKeys: readonly string[],
  ): Promise<boolean> {
    return this.database.transaction((transaction) =>
      reservePlanResources(transaction, runId, resourceKeys),
    );
  }

  /** Describes the exact held writing resource without exposing another executor's private run. */
  public async resourceBlocker(
    run: AgentPlanRun,
    keys: readonly string[],
  ): Promise<AgentPlanWriterWait | null> {
    return this.database.transaction((transaction) =>
      findPlanResourceBlocker(transaction, run, keys),
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

  /** Checks current workspace locks without disclosing their owners or run identifiers. */
  public async findWorkspaceReservation(
    workspaceIds: readonly string[],
    exceptRunId?: string,
  ): Promise<string | null> {
    for (const workspaceId of new Set(workspaceIds)) {
      const [row] = await this.database.query(
        "SELECT run_id FROM agent_plan_workspace_locks WHERE workspace_id = $id;",
        { id: workspaceId },
      );
      if (row && readTextColumn(row, 0, "run_id") !== exceptRunId)
        return workspaceId;
    }
    return null;
  }

  /** Reads only the public record; service authorization still precedes delivery. */
  public async find(id: string): Promise<AgentPlanRun | null> {
    const [row] = await this.database.query(
      "SELECT view_json FROM agent_plan_runs WHERE id = $id;",
      { id },
    );
    if (!row) return null;
    return readStoredRecord(() => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Names owner and plan from the columns, which stay readable when the record is damaged. */
  public async ownership(id: string): Promise<AgentPlanRunOwnership | null> {
    const [row] = await this.database.query(
      `
      SELECT
          user_id,
          plan_id
      FROM agent_plan_runs
      WHERE id = $id;
    `,
      { id },
    );
    return row
      ? {
          userId: readTextColumn(row, 0, "user_id"),
          planId: readTextColumn(row, 1, "plan_id"),
        }
      : null;
  }

  /** Keeps private snapshot content off the read API while exposing references for live authorization. */
  public async resources(id: string): Promise<AgentPlanRunResources> {
    const texts = await this.continuations.snapshotTexts(id);
    if (texts.length === 0) throw new AgentError("plan_access_denied");
    return readStoredRecord(() => planRunResourcesOf(texts));
  }

  /** Server-only current execution basis, used to restore an exact in-flight capability after restart. */
  public async snapshot(id: string): Promise<unknown> {
    return (await this.continuations.snapshots(id))[0] ?? null;
  }

  /** Reads only private engine bookkeeping; it is never part of a public run response. */
  public async engineState(
    id: string,
  ): Promise<PlanBranchingState | undefined> {
    const [row] = await this.database.query(
      "SELECT engine_file FROM agent_plan_runs WHERE id = $id;",
      { id },
    );
    if (!row || row[0] === null) return undefined;
    return readPlanBranchState(
      JSON.parse(
        await requireAgentFiles(this.database).read(
          readTextColumn(row, 0, "engine_file"),
        ),
      ),
    );
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
      `
      SELECT view_json
      FROM agent_plan_runs
      WHERE status IN ('running', 'pausing', 'paused', 'stopping')
      ORDER BY creation_order;
    `,
    );
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Lists runs a restart interrupted that have not decided yet whether they continue on their own. */
  public async pendingAutomaticResumes(): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(`
      SELECT view_json
      FROM agent_plan_runs
      WHERE status = 'failed'
          AND json_extract_string(view_json, '$.recovery.automaticResume.state') = 'pending'
      ORDER BY creation_order;
    `);
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
          )
      ORDER BY creation_order;
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
    // One damaged record must not take the history of the plan page with it.
    return rows.flatMap((row) => {
      try {
        const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
        return [readPlanRun(input)];
      } catch (error: unknown) {
        logCaughtError("AgentPlanRunRepository", error);
        return [];
      }
    });
  }

  /**
   * Lists every run one person started of a plan, newest first, with the references reading it needs.
   *
   * @param userId - The executor; runs of others are never part of it.
   * @param planId - The plan.
   * @returns No snapshot, view or result; the service decides visibility from the references.
   */
  public async visibilityBases(
    userId: string,
    planId: string,
  ): Promise<readonly AgentPlanRunVisibilityBasis[]> {
    return this.visibility.bases(userId, planId);
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

  /**
   * Lists the latest run one person started of every plan.
   *
   * @param userId - The executor; runs of others are never part of it.
   * @returns One entry per plan with a run of the person, by plan; reading the
   * run itself still needs the service checks.
   */
  public async latestOwn(
    userId: string,
  ): Promise<readonly AgentPlanLatestRunEntry[]> {
    const rows = await this.database.query(
      `
      SELECT
          plan_id,
          id,
          status,
          started_at,
          recovery_revision
      FROM (
          SELECT
              plan_id,
              id,
              status,
              started_at,
              recovery_revision,
              ROW_NUMBER() OVER (
                  PARTITION BY plan_id
                  ORDER BY started_at DESC, id DESC
              ) AS run_position
          FROM agent_plan_runs
          WHERE user_id = $user_id
      ) AS runs
      WHERE run_position = 1
      ORDER BY plan_id;
    `,
      { user_id: userId },
    );
    return rows.map((row) => ({
      planId: readTextColumn(row, 0, "plan_id"),
      id: readTextColumn(row, 1, "id"),
      status: readRunStatus(readTextColumn(row, 2, "status")),
      startedAt: readTextColumn(row, 3, "started_at"),
      revision: readCountColumn(row, 4, "recovery_revision"),
    }));
  }

  /**
   * Lists the runs one person started that have not ended, newest first.
   *
   * @param userId - The executor; runs of others are never part of it.
   * @returns The public records; reading them still needs the service checks.
   */
  public async active(userId: string): Promise<readonly AgentPlanRun[]> {
    const rows = await this.database.query(
      `
      SELECT view_json
      FROM agent_plan_runs
      WHERE user_id = $user_id
          AND status IN ('running', 'pausing', 'paused', 'stopping')
      ORDER BY started_at DESC, id DESC;
    `,
      { user_id: userId },
    );
    return rows.map((row) => {
      const input: unknown = JSON.parse(readTextColumn(row, 0, "view_json"));
      return readPlanRun(input);
    });
  }

  /** Prepares one remote step for a verified read-only retry without touching any other step. */
  public async resetRemoteRetry(
    runId: string,
    stepId: string,
    session: AgentPlanSessionRecord,
  ): Promise<AgentPlanRun> {
    return this.progress.resetRemoteRetry(runId, stepId, session);
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
