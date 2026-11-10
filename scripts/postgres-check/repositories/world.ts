import { strict as assert } from "node:assert";

import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { SystemMetricsRepository } from "@/backend/database/repositories/SystemMetricsRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";

import type {
  Database,
  DatabaseTransaction,
  SqlParameters,
} from "@/backend/database/Database";

/** The repositories of the area on one database. */
export interface RepositoryWorld {
  readonly database: Database;
  /** URL of this disposable check database, never a runtime configuration fallback. */
  readonly databaseUrl: string;
  readonly activity: AdministrationActivityRepository;
  readonly authorization: AuthorizationRepository;
  readonly boards: UserBoardPreferencesRepository;
  readonly connections: AgentConnectionRepository;
  readonly github: GitHubRepository;
  readonly groups: UserGroupRepository;
  readonly instance: InstanceSettingsRepository;
  readonly projects: ProjectRepository;
  readonly sessions: SessionRepository;
  readonly settings: UserSettingsRepository;
  readonly systemMetrics: SystemMetricsRepository;
  readonly tasks: TaskRepository;
  readonly users: UserRepository;
  readonly wiki: WikiRepository;
}

/** One action of a flow; both databases run it with the same input. */
export interface RepositoryStep {
  /** `Class.method` or function the step calls, or what it prepares. */
  readonly name: string;
  readonly run: (world: RepositoryWorld) => Promise<unknown>;
  /** The step only passes when the repository refuses it. */
  readonly isRefusal: boolean;
}

/** Steps of one business flow, in the order they depend on each other. */
export interface RepositoryFlow {
  readonly title: string;
  readonly steps: readonly RepositoryStep[];
}

const NOTHING: unknown = null;

/** A missing value where the types want text, for the refusal of a `NOT NULL` column. */
export const MISSING_TEXT = NOTHING as string;

/**
 * Creates the repositories of the area on one database.
 *
 * @param database - The migrated database.
 * @param databaseUrl - The explicitly selected disposable database of this check.
 * @returns The repositories.
 */
export function createWorld(
  database: Database,
  databaseUrl: string,
): RepositoryWorld {
  return {
    database,
    databaseUrl,
    activity: new AdministrationActivityRepository(database),
    authorization: new AuthorizationRepository(database),
    boards: new UserBoardPreferencesRepository(database),
    connections: new AgentConnectionRepository(database),
    github: new GitHubRepository(database),
    groups: new UserGroupRepository(database),
    instance: new InstanceSettingsRepository(database),
    projects: new ProjectRepository(database),
    sessions: new SessionRepository(database),
    settings: new UserSettingsRepository(database),
    systemMetrics: new SystemMetricsRepository(database),
    tasks: new TaskRepository(database),
    users: new UserRepository(database),
    wiki: new WikiRepository(database),
  };
}

/**
 * A step whose result both databases must agree on.
 *
 * @param name - The method or function it calls.
 * @param run - The call.
 * @returns The step.
 */
export function call(name: string, run: RepositoryStep["run"]): RepositoryStep {
  return { name, run, isRefusal: false };
}

/**
 * A step both databases must refuse in the same way.
 *
 * @param name - The method or function it calls.
 * @param run - The call.
 * @returns The step.
 */
export function refused(
  name: string,
  run: RepositoryStep["run"],
): RepositoryStep {
  return { name, run, isRefusal: true };
}

/**
 * A statement of the flow itself, for rows and times no repository method sets.
 *
 * @param statement - The statement.
 * @param parameters - Its values.
 * @returns The step.
 */
export function prepare(
  statement: string,
  parameters: SqlParameters = {},
): RepositoryStep {
  return call("prepare", ({ database }) =>
    database.execute(statement, parameters),
  );
}

/**
 * A read that has to fail, for a repository that only reads: the table it needs
 * is gone for the length of a transaction that never commits.
 *
 * @param name - The method it calls.
 * @param table - The table the method reads.
 * @param read - The call on the open transaction.
 * @returns The step.
 */
export function refusedWithoutTable(
  name: string,
  table: string,
  read: (transaction: DatabaseTransaction) => Promise<unknown>,
): RepositoryStep {
  return refused(name, ({ database }) =>
    database.transaction(async (transaction) => {
      await transaction.execute(`ALTER TABLE ${table} RENAME TO hidden_table;`);
      await read(transaction);
    }),
  );
}

/**
 * Reverses the physical order of a table, in PostgreSQL only.
 *
 * @param table - The table.
 * @returns The step.
 *
 * @remarks
 * Equal sort keys come back in the physical order, also through an index. A
 * list without a unique last key therefore differs after this step, where a
 * single `UPDATE` can leave the order alone.
 */
export function reversedInPostgres(table: string): RepositoryStep {
  return call("prepare", async ({ database }) => {
    await database.transaction(async (transaction) => {
      const dependents =
        table === "agent_plan_runs"
          ? [
              "agent_local_session_owners",
              "agent_local_session_results",
              "plan_run_commands",
              "plan_run_api_cleanup",
            ]
          : [];
      for (const dependent of dependents) {
        const [row] = await transaction.query(
          `SELECT COUNT(*) FROM ${dependent};`,
        );
        assert.equal(row?.[0], 0, `Reversal must preserve ${dependent}.`);
      }
      await transaction.execute(
        `CREATE TEMPORARY TABLE reversed_rows ON COMMIT DROP AS TABLE ${table};`,
      );
      await transaction.execute(
        `TRUNCATE ${[table, ...dependents].join(", ")};`,
      );
      await transaction.execute(
        `INSERT INTO ${table} TABLE reversed_rows ORDER BY ctid DESC;`,
      );
    });
  });
}

/**
 * A read of what a method without a read of its own has stored.
 *
 * @param statement - The query.
 * @param parameters - Its values.
 * @returns The step.
 */
export function stored(
  statement: string,
  parameters: SqlParameters = {},
): RepositoryStep {
  return call("stored", ({ database }) =>
    database.query(statement, parameters),
  );
}
