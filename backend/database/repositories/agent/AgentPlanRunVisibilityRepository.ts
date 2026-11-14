import { readStoredAgentPayload } from "@/backend/storage/AgentPayloadFileStore";
import {
  readPlanRunResources,
  readStoredTicketAsset,
} from "@/backend/agents/AgentPlanRunResources";
import { readCountColumn, readTextColumn } from "@/backend/database/RowValue";
import { AgentError } from "@/backend/error/AgentErrors";
import { logCaughtError } from "@/backend/logging/Logger";

import type { Database, DatabaseValue } from "@/backend/database/Database";
import type { AgentPlanRunResources } from "@/backend/agents/AgentPlanRunResources";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentTicketAsset } from "@/definition/AgentTicketParameter";

/** Runs whose references one statement reads at most. */
const CHUNK_SIZE = 100;
/** Runs whose references stay remembered; a finished run's references never change. */
const MAX_REMEMBERED = 20_000;
/** Where a run view names the files and ticket assets its steps used. */
const VIEW_ASSET_PATH = "$.steps[*].resourceAccess.files[*].asset";

/** One run of the history with what reading its content needs, without the content itself. */
export interface AgentPlanRunVisibilityBasis {
  readonly id: string;
  readonly startedAt: string;
  readonly status: AgentPlanRun["status"];
  /**
   * The resources of every execution basis and the file assets the view names;
   * `null` for a damaged record, which only its owner may learn about.
   */
  readonly used: {
    readonly resources: AgentPlanRunResources;
    readonly viewAssets: readonly AgentTicketAsset[];
  } | null;
}

interface RunVersion {
  readonly id: string;
  readonly startedAt: string;
  readonly status: AgentPlanRun["status"];
  /** Changes with every committed write and every new execution basis. */
  readonly version: string;
}

type UsedResources = AgentPlanRunVisibilityBasis["used"];

/**
 * Reads a stored run status.
 *
 * @throws {AgentError} `plan_invalid` for a status no run has.
 */
export function readRunStatus(input: string): AgentPlanRun["status"] {
  if (
    input !== "running" &&
    input !== "pausing" &&
    input !== "stopping" &&
    input !== "succeeded" &&
    input !== "failed" &&
    input !== "cancelled" &&
    input !== "paused" &&
    input !== "work_done_closeout_open"
  )
    throw new AgentError("plan_invalid");
  return input;
}

/**
 * Combines the resources of a run's execution bases, newest first.
 *
 * @param texts - The stored snapshots, the newest continuation first.
 * @throws {AgentError} `plan_access_denied` when the run has no basis.
 */
export function planRunResourcesOf(
  texts: readonly string[],
): AgentPlanRunResources {
  const references = texts.map((text) => {
    const snapshot: unknown = JSON.parse(text);
    return readPlanRunResources(snapshot);
  });
  const first = references[0];
  if (!first) throw new AgentError("plan_access_denied");
  const remoteWorkspaceIds = [
    ...new Set(references.flatMap((entry) => entry.remoteWorkspaceIds ?? [])),
  ];
  return {
    ...(first.executionTarget?.kind === "remote"
      ? { executionTarget: first.executionTarget }
      : {}),
    ...(remoteWorkspaceIds.length ? { remoteWorkspaceIds } : {}),
    projectId: first.projectId,
    stepTickets: Object.fromEntries(
      [...references]
        .reverse()
        .flatMap((entry) => Object.entries(entry.stepTickets ?? {})),
    ),
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

function placeholders(ids: readonly string[]): {
  readonly list: string;
  readonly parameters: Record<string, string>;
} {
  const parameters: Record<string, string> = {};
  ids.forEach((id, index) => {
    parameters[`run_${String(index)}`] = id;
  });
  return {
    list: ids.map((_, index) => `$run_${String(index)}`).join(", "),
    parameters,
  };
}

function readViewAssets(value: DatabaseValue): readonly AgentTicketAsset[] {
  if (typeof value !== "string") throw new Error("Damaged run view");
  const assets: unknown = JSON.parse(value);
  if (!Array.isArray(assets)) throw new Error("Damaged run view");
  return assets.map((asset) => readStoredTicketAsset(asset));
}

/**
 * Reads what deciding the visibility of a person's runs needs, run by run, in few statements.
 *
 * @remarks
 * Only identifiers leave the database: the resources the snapshots name and
 * the file assets the views name, never a snapshot, a view or a result. The
 * references of a run are remembered by its write revision and its number of
 * execution bases, so a repeated listing reads only runs that changed.
 */
export class AgentPlanRunVisibilityRepository {
  private readonly database: Pick<Database, "query" | "agentFiles">;
  private readonly remembered = new Map<
    string,
    { readonly version: string; readonly used: UsedResources }
  >();

  public constructor(database: Pick<Database, "query" | "agentFiles">) {
    this.database = database;
  }

  /**
   * Lists every run one person started of a plan, newest first, with the references reading it needs.
   *
   * @param userId - The executor; runs of others are never part of it.
   * @param planId - The plan.
   */
  public async bases(
    userId: string | null,
    planId: string,
  ): Promise<readonly AgentPlanRunVisibilityBasis[]> {
    const versions = await this.versions(userId, planId);
    const missing = versions.filter(
      (run) => this.remembered.get(run.id)?.version !== run.version,
    );
    for (let start = 0; start < missing.length; start += CHUNK_SIZE)
      await this.remember(missing.slice(start, start + CHUNK_SIZE));
    return versions.map((run) => ({
      id: run.id,
      startedAt: run.startedAt,
      status: run.status,
      used: this.remembered.get(run.id)?.used ?? null,
    }));
  }

  private async versions(
    userId: string | null,
    planId: string,
  ): Promise<readonly RunVersion[]> {
    const rows = await this.database.query(
      `
      SELECT
          runs.id,
          runs.started_at,
          runs.status,
          runs.recovery_revision,
          (
              SELECT COUNT(*)
              FROM agent_plan_continuations AS continuations
              WHERE continuations.run_id = runs.id
          ) AS basis_count
      FROM agent_plan_runs AS runs
      WHERE (CAST($user_id AS TEXT) IS NULL OR runs.user_id = $user_id)
          AND runs.plan_id = $plan_id
      ORDER BY runs.started_at DESC, runs.id DESC;
    `,
      { user_id: userId, plan_id: planId },
    );
    return rows.map((row) => ({
      id: readTextColumn(row, 0, "id"),
      startedAt: readTextColumn(row, 1, "started_at"),
      status: readRunStatus(readTextColumn(row, 2, "status")),
      version: `${String(readCountColumn(row, 3, "recovery_revision"))}:${String(readCountColumn(row, 4, "basis_count"))}`,
    }));
  }

  private async remember(runs: readonly RunVersion[]): Promise<void> {
    const { list, parameters } = placeholders(runs.map((run) => run.id));
    const views = await this.database.query(
      `
      SELECT
          id,
          CASE
              WHEN pg_input_is_valid(view_json, 'jsonb')
                  AND view_json::jsonb ->> 'userId' = user_id
              THEN jsonb_path_query_array(view_json::jsonb, $asset_path::jsonpath)::text
          END AS view_assets
      FROM agent_plan_runs
      WHERE id IN (${list});
    `,
      { ...parameters, asset_path: VIEW_ASSET_PATH },
    );
    const snapshots = await this.snapshotTexts(list, parameters);
    for (const row of views) {
      const id = readTextColumn(row, 0, "id");
      const run = runs.find((entry) => entry.id === id);
      if (!run) continue;
      if (this.remembered.size >= MAX_REMEMBERED) this.remembered.clear();
      this.remembered.set(id, {
        version: run.version,
        used: this.readUsed(row[1] ?? null, snapshots.get(id) ?? []),
      });
    }
  }

  /** The stored snapshots of each run, the newest continuation first, as `resources` reads them. */
  private async snapshotTexts(
    list: string,
    parameters: Record<string, string>,
  ): Promise<ReadonlyMap<string, readonly string[]>> {
    const rows = await this.database.query(
      `
      SELECT
          run_id,
          snapshot_json
      FROM (
          SELECT
              run_id,
              COALESCE(snapshot_file, snapshot_json) AS snapshot_json,
              version
          FROM agent_plan_continuations
          WHERE run_id IN (${list})
          UNION ALL
          SELECT
              id AS run_id,
              COALESCE(snapshot_file, snapshot_json) AS snapshot_json,
              0 AS version
          FROM agent_plan_runs
          WHERE id IN (${list})
      ) AS bases
      ORDER BY run_id, version DESC;
    `,
      parameters,
    );
    const texts = new Map<string, string[]>();
    for (const row of rows) {
      const id = readTextColumn(row, 0, "run_id");
      const text = await readStoredAgentPayload(
        this.database,
        readTextColumn(row, 1, "snapshot_json"),
      );
      texts.set(id, [...(texts.get(id) ?? []), text]);
    }
    return texts;
  }

  private readUsed(
    viewAssets: DatabaseValue,
    snapshots: readonly string[],
  ): UsedResources {
    try {
      return {
        resources: planRunResourcesOf(snapshots),
        viewAssets: readViewAssets(viewAssets),
      };
    } catch (error: unknown) {
      logCaughtError("AgentPlanRunVisibilityRepository", error);

      return null;
    }
  }
}
