import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { readTextColumn } from "@/backend/database/RowValue";
import { readStoredAgentPayload } from "@/backend/storage/AgentPayloadFileStore";
import { readPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import { planWritingWorkspaces } from "@/backend/service/agents/AgentPlanContinuation";
import {
  expandedPlanWriteResources,
  isConcretePlanWriterResource,
  planWriterResourcesCollide,
} from "@/backend/service/agents/AgentPlanWriterResources";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";
import { sharedAgentPlanRunObservers } from "@/backend/service/agents/AgentPlanRunObservers";

import { CURRENT_PLAN_SNAPSHOT } from "./AgentPlanContinuationRepository";

import type {
  Database,
  DatabaseTransaction,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanResourceRelease } from "@/definition/AgentPlanResourceRelease";

/** Server-only owner facts; the confirmation exposes only a name, run id and start time. */
export interface PlanStartResourceOwner {
  readonly run: AgentPlanRun;
  readonly resources: readonly string[];
}

interface StoredOwner {
  readonly run: AgentPlanRun;
  readonly snapshot: unknown;
  readonly resources: string[];
}

interface ReleaseWriteOptions {
  /** A restart's own journal advances the source revision with the creation of the new run. */
  readonly preserveRevision: boolean;
}

/** Finds and forcibly retires owners of the validated start's concrete write resources. */
export class AgentPlanStartResourceRepository {
  private readonly database: Pick<
    Database,
    "query" | "transaction" | "agentFiles"
  >;

  public constructor(
    database: Pick<Database, "query" | "transaction" | "agentFiles">,
  ) {
    this.database = database;
  }

  /** Includes old native owners without a lock and an open run of the same plan without write nodes. */
  public async conflicts(
    planId: string,
    resourceKeys: readonly string[],
    sourceRunId?: string,
  ): Promise<readonly PlanStartResourceOwner[]> {
    const keys = await expandedPlanWriteResources(resourceKeys);
    const rows = await this.database.query(
      `
      SELECT
          agent_plan_runs.view_json,
          ${CURRENT_PLAN_SNAPSHOT} AS snapshot_json,
          locks.workspace_id
      FROM agent_plan_runs
      LEFT JOIN agent_plan_workspace_locks AS locks ON locks.run_id = agent_plan_runs.id
      WHERE locks.run_id IS NOT NULL
          OR agent_plan_runs.id = $source_run_id
          OR (agent_plan_runs.plan_id = $plan_id AND agent_plan_runs.status IN ('running', 'pausing', 'paused', 'stopping'))
          OR EXISTS (
              SELECT 1 FROM agent_local_session_owners AS owners
              WHERE owners.run_id = agent_plan_runs.id AND owners.released_at IS NULL
          )
      ORDER BY agent_plan_runs.creation_order, locks.creation_order;
    `,
      { plan_id: planId, source_run_id: sourceRunId ?? null },
    );
    const owners = new Map<string, StoredOwner>();
    for (const row of rows) {
      const run = readPlanRun(JSON.parse(readTextColumn(row, 0, "view_json")));
      const owner: StoredOwner = owners.get(run.id) ?? {
        run,
        snapshot: row[1],
        resources: [],
      };
      if (typeof row[2] === "string") owner.resources.push(row[2]);
      owners.set(run.id, owner);
    }
    const conflicts: PlanStartResourceOwner[] = [];
    for (const owner of owners.values()) {
      const resources = await this.resources(owner);
      if (
        owner.run.id === sourceRunId ||
        (owner.run.planId === planId && isActivePlanRun(owner.run.status)) ||
        resources.some((held) =>
          keys.some((key) => planWriterResourcesCollide(held, key)),
        )
      )
        conflicts.push({ run: owner.run, resources });
    }
    return conflicts;
  }

  /** Reads every unreleased native owner, including owners missing from a historical step view. */
  public async localOwners(runId: string): Promise<readonly string[]> {
    const rows = await this.database.query(
      `
      SELECT instance_id
      FROM agent_local_session_owners
      WHERE run_id = $run_id AND released_at IS NULL;
    `,
      { run_id: runId },
    );
    return rows.map((row) => readTextColumn(row, 0, "instance_id"));
  }

  /** Fences late execution writes before signalling processes; terminal results stay unchanged. */
  public async retire(
    runId: string,
    release: AgentPlanResourceRelease,
    options: ReleaseWriteOptions,
  ): Promise<AgentPlanRun> {
    return this.database.transaction(async (transaction) => {
      const run = await this.read(transaction, runId);
      const retired: AgentPlanRun = {
        ...run,
        stopRequested: true,
        isWaitingForWorkspace: undefined,
        workspaceWait: undefined,
        resourceReleases: [...(run.resourceReleases ?? []), release],
        ...(isActivePlanRun(run.status)
          ? {
              status: "cancelled",
              endedAt: release.createdAt,
              steps: run.steps.map(cancelUnfinishedStep),
            }
          : {}),
      };
      await this.save(transaction, retired, options);
      transaction.onCommit?.(() => {
        sharedAgentPlanRunObservers().notify(run, retired);
        return Promise.resolve();
      });
      return retired;
    });
  }

  /** Commits the evidence and frees native ownership and every lock even when cleanup is unconfirmed. */
  public async complete(
    runId: string,
    release: AgentPlanResourceRelease,
    options: ReleaseWriteOptions,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const run = await this.read(transaction, runId);
      await this.save(
        transaction,
        {
          ...run,
          resourceReleases: (run.resourceReleases ?? []).map((entry) =>
            entry.id === release.id ? release : entry,
          ),
        },
        options,
      );
      await transaction.execute(
        `
        UPDATE agent_local_session_owners
        SET released_at = $released_at, importer_token = NULL
        WHERE run_id = $run_id AND released_at IS NULL;
      `,
        { run_id: runId, released_at: release.createdAt },
      );
      await transaction.execute(
        "DELETE FROM agent_plan_workspace_locks WHERE run_id = $run_id;",
        { run_id: runId },
      );
      await transaction.execute(
        "DELETE FROM acp_resource_leases WHERE run_id = $run_id;",
        { run_id: runId },
      );
    });
  }

  private async resources(owner: StoredOwner): Promise<readonly string[]> {
    if (
      owner.resources.length &&
      owner.resources.every(isConcretePlanWriterResource)
    )
      return [...new Set(owner.resources)];
    if (typeof owner.snapshot !== "string") return owner.resources;
    const snapshot = readPlanSnapshot(
      JSON.parse(await readStoredAgentPayload(this.database, owner.snapshot)),
    );
    return [
      ...new Set([
        ...owner.resources.filter(isConcretePlanWriterResource),
        ...(await expandedPlanWriteResources(planWritingWorkspaces(snapshot))),
      ]),
    ];
  }

  private async read(
    transaction: DatabaseTransaction,
    runId: string,
  ): Promise<AgentPlanRun> {
    const [row] = await transaction.query(
      "SELECT view_json FROM agent_plan_runs WHERE id = $id FOR UPDATE;",
      { id: runId },
    );
    return readPlanRun(JSON.parse(readTextColumn(row ?? [], 0, "view_json")));
  }

  private async save(
    transaction: DatabaseTransaction,
    run: AgentPlanRun,
    options: ReleaseWriteOptions,
  ): Promise<void> {
    await transaction.execute(
      `
      UPDATE agent_plan_runs
      SET status = $status, view_json = $view_json, recovery_revision = recovery_revision + $advance
      WHERE id = $id;
    `,
      {
        id: run.id,
        status: run.status,
        view_json: JSON.stringify(run),
        advance: options.preserveRevision ? 0 : 1,
      },
    );
  }
}

function cancelUnfinishedStep(
  step: AgentPlanRun["steps"][number],
): AgentPlanRun["steps"][number] {
  if (!["running", "waiting", "paused"].includes(step.status)) return step;
  return {
    ...step,
    status: "cancelled",
    cancellation: step.status === "running" ? "requested" : "not_started",
    isBlocked: false,
  };
}
