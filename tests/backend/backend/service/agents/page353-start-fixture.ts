import { vi } from "vitest";

import { readPlanRun } from "@/backend/agents/AgentPlanRunInput";
import { AgentPlanStartResourceRepository } from "@/backend/database/repositories/agent/AgentPlanStartResourceRepository";
import { AgentPlanRunEngine } from "@/backend/service/agents/AgentPlanRunEngine";
import { AgentPlanStartResources } from "@/backend/service/agents/AgentPlanStartResources";
import { planWriterResourcesCollide } from "@/backend/service/agents/AgentPlanWriterResources";
import { isActivePlanRun } from "@/definition/AgentPlanRunState";

import { recoveryFixture } from "./page84-recovery-fixture";

import type {
  DatabaseTransaction,
  DatabaseValue,
  SqlParameters,
} from "@/backend/database/Database";
import type { AgentPlanRun } from "@/definition/AgentPlan";
import type { AgentPlanSnapshot } from "@/backend/service/agents/AgentPlanSnapshot";
import type { AgentPlanRemoteExecution } from "@/backend/service/agents/AgentPlanRemoteExecution";
import type { AgentPlanStepRunner } from "@/backend/service/agents/AgentPlanStepRunner";

interface StartResourceWorld {
  readonly old: AgentPlanRun;
  readonly snapshot: AgentPlanSnapshot;
  readonly database: StartResourceDatabase;
  readonly repository: AgentPlanStartResourceRepository;
  readonly service: AgentPlanStartResources;
  readonly engine: AgentPlanRunEngine;
  readonly create: ReturnType<
    typeof vi.fn<(run: AgentPlanRun) => Promise<void>>
  >;
  readonly reserve: ReturnType<
    typeof vi.fn<(runId: string, keys: readonly string[]) => Promise<boolean>>
  >;
  readonly blocker: ReturnType<typeof vi.fn<() => Promise<null>>>;
  readonly localSessions: {
    readonly forgetForcedRun: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
  readonly resources: {
    readonly forceReleaseRun: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  };
  readonly execute: ReturnType<typeof vi.fn<AgentPlanStepRunner["run"]>>;
}

export const DIRECTORY = "local-directory:/synthetic";
export const BRANCH = "local-git-branch:synthetic-branch";

/** SQL boundary stand-in: no database, filesystem, subprocess or service is started. */
export class StartResourceDatabase implements DatabaseTransaction {
  public readonly runs = new Map<string, AgentPlanRun>();
  public readonly locks = new Map<string, string>();
  public readonly owners = new Map<
    string,
    { readonly runId: string; isReleased: boolean }
  >();
  public readonly statements: {
    readonly statement: string;
    readonly parameters?: SqlParameters;
  }[] = [];
  private readonly snapshot: AgentPlanSnapshot;

  public constructor(snapshot: AgentPlanSnapshot, run?: AgentPlanRun) {
    this.snapshot = snapshot;
    if (run) this.seed(run);
  }

  /** Reserves directory, branch and two independent native owners for a synthetic old run. */
  public seed(run: AgentPlanRun): void {
    this.runs.set(run.id, structuredClone(run));
    this.locks.set(DIRECTORY, run.id);
    this.locks.set(BRANCH, run.id);
    for (const id of ["owned-instance", "orphan-owner"])
      this.owners.set(id, { runId: run.id, isReleased: false });
  }

  /** Executes only the statements of the forced-release repository. */
  public async execute(
    statement: string,
    parameters?: SqlParameters,
  ): Promise<void> {
    this.statements.push({ statement, parameters });
    if (statement.includes("UPDATE agent_plan_runs")) {
      const run = readPlanRun(JSON.parse(String(parameters?.view_json)));
      this.runs.set(run.id, run);
    } else if (statement.includes("UPDATE agent_local_session_owners")) {
      for (const owner of this.owners.values())
        if (owner.runId === parameters?.run_id) owner.isReleased = true;
    } else if (statement.includes("DELETE FROM agent_plan_workspace_locks")) {
      for (const [key, id] of this.locks)
        if (id === parameters?.run_id) this.locks.delete(key);
    } else if (statement.includes("DELETE FROM acp_resource_leases")) {
      return;
    } else throw new Error(`Unexpected statement: ${statement}`);
  }

  /** Returns durable owner facts and row-locked run views from memory. */
  public async query(
    statement: string,
    parameters?: SqlParameters,
  ): Promise<readonly DatabaseValue[][]> {
    if (statement.includes("LEFT JOIN agent_plan_workspace_locks")) {
      return this.conflictRows(parameters);
    }
    if (statement.includes("SELECT instance_id"))
      return [...this.owners]
        .filter(
          ([, owner]) =>
            owner.runId === parameters?.run_id && !owner.isReleased,
        )
        .map(([id]) => [id]);
    if (statement.includes("SELECT view_json")) {
      const run = this.runs.get(String(parameters?.id));
      return run ? [[JSON.stringify(run)]] : [];
    }
    throw new Error(`Unexpected query: ${statement}`);
  }

  /** Runs repository transactions against the isolated statement boundary. */
  public async transaction<Result>(
    work: (transaction: DatabaseTransaction) => Promise<Result>,
  ): Promise<Result> {
    return work(this);
  }
  private conflictRows(parameters?: SqlParameters): readonly DatabaseValue[][] {
    const rows: DatabaseValue[][] = [];
    for (const run of this.runs.values()) {
      const keys = [...this.locks]
        .filter(([, id]) => id === run.id)
        .map(([key]) => key);
      const hasOwner = [...this.owners.values()].some(
        (owner) => owner.runId === run.id && !owner.isReleased,
      );
      const sameActivePlan =
        run.planId === parameters?.plan_id && isActivePlanRun(run.status);
      if (
        !keys.length &&
        !hasOwner &&
        run.id !== parameters?.source_run_id &&
        !sameActivePlan
      )
        continue;
      for (const key of keys.length ? keys : [null])
        rows.push([JSON.stringify(run), JSON.stringify(this.snapshot), key]);
    }
    return rows;
  }
}

/** Builds the actual start service and engine around mocked runtime boundaries. */
export async function startResourceWorld(
  options: {
    readonly status?: AgentPlanRun["status"];
    readonly otherPlan?: boolean;
    readonly remote?: Pick<AgentPlanRemoteExecution, "stop" | "withProgress">;
    readonly seed?: boolean;
  } = {},
): Promise<StartResourceWorld> {
  const fixture = await recoveryFixture();
  const old: AgentPlanRun = {
    ...fixture.failed,
    id: "old-run",
    planName: "Earlier Plan",
    planId: options.otherPlan ? "other-plan" : fixture.snapshot.plan.id,
    status: options.status ?? "failed",
    steps: fixture.failed.steps.map((step) =>
      step.session
        ? {
            ...step,
            session: { ...step.session, closeout: "failed", processId: 4321 },
          }
        : step,
    ),
  };
  const snapshot = {
    ...fixture.snapshot,
    steps: fixture.snapshot.steps.slice(0, 1),
    plan: {
      ...fixture.snapshot.plan,
      nodes: fixture.snapshot.plan.nodes.slice(0, 1),
      edges: [],
    },
  };
  const database = new StartResourceDatabase(
    snapshot,
    options.seed === false ? undefined : old,
  );
  const repository = new AgentPlanStartResourceRepository(database);
  const localSessions = { forgetForcedRun: vi.fn(async () => undefined) };
  const resources = { forceReleaseRun: vi.fn(async () => true) };
  const service = new AgentPlanStartResources({
    repository,
    localSessions,
    resources,
    remote: options.remote,
  });
  const blocker = vi.fn(async () => null);
  const create = vi.fn(async (run: AgentPlanRun) => {
    if ([...database.locks.values()].some((id) => id !== run.id))
      throw new Error("Old lock survived start");
    database.runs.set(run.id, run);
  });
  const reserve = vi.fn(async (runId: string, keys: readonly string[]) => {
    if (
      keys.some((key) =>
        [...database.locks].some(
          ([held, id]) => id !== runId && planWriterResourcesCollide(held, key),
        ),
      )
    )
      return false;
    for (const key of keys) database.locks.set(key, runId);
    return true;
  });
  const execute = vi.fn<AgentPlanStepRunner["run"]>(async () => ({
    status: "succeeded",
    output: "new result",
  }));
  const runs = {
    create,
    insert: vi.fn(),
    reserve,
    resourceBlocker: blocker,
    find: async (id: string) => database.runs.get(id) ?? null,
    update: async (run: AgentPlanRun) => {
      if (!database.runs.get(run.id)?.resourceReleases?.length)
        database.runs.set(run.id, run);
    },
  };
  const engine = new AgentPlanRunEngine({
    startResources: service,
    runs,
    start: { control: async () => undefined },
    steps: { closeGroups: async () => undefined, run: execute },
  });
  return {
    old,
    snapshot,
    database,
    repository,
    service,
    engine,
    create,
    reserve,
    blocker,
    localSessions,
    resources,
    execute,
  };
}
