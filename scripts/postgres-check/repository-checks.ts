import { strict as assert } from "node:assert";
import path from "node:path";

import { Database } from "@/backend/database/Database";
import { PostgresLocaleError } from "@/backend/database/postgres/PostgresLocale";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { ProjectActivityRepository } from "@/backend/database/repositories/project/ProjectActivityRepository";
import { ProjectCoreRepository } from "@/backend/database/repositories/project/ProjectCoreRepository";
import { ProjectDeletionScopeRepository } from "@/backend/database/repositories/project/ProjectDeletionScopeRepository";
import { ProjectDepartmentRepository } from "@/backend/database/repositories/project/ProjectDepartmentRepository";
import { ProjectEventRepository } from "@/backend/database/repositories/project/ProjectEventRepository";
import { ProjectGoalRepository } from "@/backend/database/repositories/project/ProjectGoalRepository";
import { ProjectIconRepository } from "@/backend/database/repositories/project/ProjectIconRepository";
import { ProjectIntegrationRepository } from "@/backend/database/repositories/project/ProjectIntegrationRepository";
import { ProjectLifecycleRepository } from "@/backend/database/repositories/project/ProjectLifecycleRepository";
import { ProjectMemberRepository } from "@/backend/database/repositories/project/ProjectMemberRepository";
import { ProjectTagRepository } from "@/backend/database/repositories/project/ProjectTagRepository";
import { ProjectTemplateRepository } from "@/backend/database/repositories/project/ProjectTemplateRepository";

import {
  SESSION_FLOW,
  SETTINGS_FLOW,
  USER_FLOW,
} from "./repositories/account-flows";
import {
  AUTHORIZATION_FLOW,
  GROUP_FLOW,
} from "./repositories/authorization-flows";
import { GITHUB_FLOW } from "./repositories/github-flow";
import { CONNECTION_FLOW, INSTANCE_FLOW } from "./repositories/instance-flows";
import { PROJECT_DELETION_FLOW } from "./repositories/project-deletion-flow";
import { PROJECT_FLOW } from "./repositories/project-flows";
import { readPublicApi } from "./repositories/public-api";
import { TASK_FACADE_FLOW } from "./repositories/task-facade-flows";
import { WIKI_FACADE_FLOW } from "./repositories/wiki-facade-flow";
import { createWorld } from "./repositories/world";
import { readMigrations } from "./schema-checks";

import type { PublicApi } from "./repositories/public-api";
import type {
  RepositoryFlow,
  RepositoryStep,
  RepositoryWorld,
} from "./repositories/world";
import type { TemporaryPostgres } from "./temporary-instance";

const REPOSITORY_DATABASE_NAME = "pages_repository_check";

/** Flows in dependency order: accounts first, the deletion of a project last. */
const FLOWS: readonly RepositoryFlow[] = [
  USER_FLOW,
  SESSION_FLOW,
  SETTINGS_FLOW,
  AUTHORIZATION_FLOW,
  GROUP_FLOW,
  INSTANCE_FLOW,
  CONNECTION_FLOW,
  GITHUB_FLOW,
  PROJECT_FLOW,
  TASK_FACADE_FLOW,
  WIKI_FACADE_FLOW,
  PROJECT_DELETION_FLOW,
];

/** Every class of the area, whose methods are watched while the flows run. */
const AREA_CLASSES: Readonly<Record<string, { readonly prototype: object }>> = {
  AdministrationActivityRepository,
  AgentConnectionRepository,
  AuthorizationRepository,
  GitHubRepository,
  InstanceSettingsRepository,
  ProjectRepository,
  SessionRepository,
  TaskRepository,
  UserBoardPreferencesRepository,
  UserGroupRepository,
  UserRepository,
  UserSettingsRepository,
  WikiRepository,
  ProjectActivityRepository,
  ProjectCoreRepository,
  ProjectDeletionScopeRepository,
  ProjectDepartmentRepository,
  ProjectEventRepository,
  ProjectGoalRepository,
  ProjectIconRepository,
  ProjectIntegrationRepository,
  ProjectLifecycleRepository,
  ProjectMemberRepository,
  ProjectTagRepository,
  ProjectTemplateRepository,
};

const STORED_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
const GENERATED_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/**
 * Facade methods whose statements lie in `task/`, which PAGE-215 ports and this
 * area must not change.
 *
 * @remarks
 * Only these may still differ. An entry that no longer differs fails the check,
 * so the list shrinks with PAGE-215 and cannot hide a new difference.
 */
const FOREIGN_GAPS: Readonly<Record<string, string>> = {
  "TaskRepository.findMilestonesByProjectIds":
    "task/MilestoneRepository.ts sorts by the nullable due_at without NULLS FIRST",
  "TaskRepository.findAll":
    "task/WorkItemFilter.ts ends the board order on created_at, without a unique last key",
  "TaskRepository.countWorkItemsOverview":
    "task/WorkItemCountRepository.ts uses TRY_CAST, which only DuckDB knows",
  "TaskRepository.update":
    "task/WorkItemWriteRepository.ts tests untyped parameters with IS NULL",
};

/** What one step ended with, in a form both databases can be compared on. */
interface StepOutcome {
  readonly name: string;
  readonly label: string;
  readonly isExpected: boolean;
  readonly text: string;
}

/**
 * Takes out what may differ between two runs: the moment and generated identifiers.
 *
 * @remarks
 * A time only passes as the moment when it has the stored format, so another
 * format still counts as a difference. Sorting by time is pinned by the flows.
 */
function stableValue(input: unknown): unknown {
  if (typeof input === "string") {
    if (STORED_TIME.test(input)) return "<time>";
    return GENERATED_ID.test(input) ? "<id>" : input;
  }
  if (typeof input === "bigint") return String(input);
  if (Buffer.isBuffer(input)) return `hex:${input.toString("hex")}`;
  if (input instanceof Map) return { map: stableValue([...input.entries()]) };
  if (input instanceof Set) return { set: stableValue([...input.values()]) };
  if (Array.isArray(input)) return input.map(stableValue);
  if (typeof input === "object" && input !== null)
    return Object.fromEntries(
      Object.entries(input).map(([key, item]) => [key, stableValue(item)]),
    );
  return input === undefined ? "<undefined>" : input;
}

/** Errors of the code keep their name and text; the words of a server are its own. */
function refusalText(error: unknown): string {
  if (!(error instanceof Error)) return "not an error";
  if (error.name !== "Error" && error.name !== "error") return error.name;
  const isOfTheCode =
    error.message.startsWith("Database returned") ||
    error.message.startsWith("A read transaction") ||
    error.message.startsWith("The flow ends");
  return isOfTheCode ? error.message : "statement refused";
}

async function runStep(
  step: RepositoryStep,
  world: RepositoryWorld,
  label: string,
): Promise<StepOutcome> {
  const { name } = step;
  try {
    const result = await step.run(world);
    return {
      name,
      label,
      isExpected: !step.isRefusal,
      text: JSON.stringify(stableValue(result)),
    };
  } catch (error: unknown) {
    return {
      name,
      label,
      isExpected: step.isRefusal,
      text: step.isRefusal
        ? `refused: ${refusalText(error)}`
        : `failed: ${String(error)}`,
    };
  }
}

async function runFlows(world: RepositoryWorld): Promise<StepOutcome[]> {
  const outcomes: StepOutcome[] = [];
  for (const flow of FLOWS)
    for (const [index, step] of flow.steps.entries())
      outcomes.push(
        await runStep(
          step,
          world,
          `${flow.title} #${String(index)} ${step.name}`,
        ),
      );
  return outcomes;
}

/** One step that failed or differs. */
interface StepDifference {
  readonly name: string;
  readonly text: string;
}

/**
 * Compares what the two databases did, step by step.
 *
 * @param duckdb - The steps on DuckDB.
 * @param postgres - The same steps on PostgreSQL.
 * @returns One entry per step that failed or differs. A step DuckDB fails is
 * a fault of the flow and is never covered by {@link FOREIGN_GAPS}.
 */
function findDifferences(
  duckdb: readonly StepOutcome[],
  postgres: readonly StepOutcome[],
): readonly StepDifference[] {
  const findings: StepDifference[] = [];
  duckdb.forEach((expected, index) => {
    const actual = postgres[index];
    const { name, label } = expected;
    if (!expected.isExpected)
      findings.push({
        name: `DuckDB ${name}`,
        text: `${label}: DuckDB ${expected.text}`,
      });
    if (!actual?.isExpected)
      findings.push({
        name,
        text: `${label}: PostgreSQL ${String(actual?.text)}`,
      });
    else if (actual.text !== expected.text)
      findings.push({
        name,
        text: `${label}:\n  DuckDB     ${expected.text}\n  PostgreSQL ${actual.text}`,
      });
  });
  return findings;
}

/** Fails on every difference outside the list, and on a list entry that no longer differs. */
function requireOnlyForeignGaps(differences: readonly StepDifference[]): void {
  const unexplained = differences.filter(
    ({ name }) => FOREIGN_GAPS[name] === undefined,
  );
  assert.equal(
    unexplained.length,
    0,
    `The databases differ:\n${unexplained.map(({ text }) => text).join("\n")}`,
  );
  const found = new Set(differences.map(({ name }) => name));
  assert.deepEqual(
    Object.keys(FOREIGN_GAPS).filter((name) => !found.has(name)),
    [],
    "The list names a gap that no longer exists.",
  );
}

/** Notes each call of a public method of the area, also behind a facade. */
function watchCalls(api: PublicApi, called: Set<string>): void {
  assert.deepEqual(
    [...api.methods.keys()].sort(),
    Object.keys(AREA_CLASSES).sort(),
    "The area has a class this check does not watch.",
  );
  for (const [className, methods] of api.methods) {
    const prototype = AREA_CLASSES[className]?.prototype;
    assert.ok(prototype);
    for (const method of methods) {
      const original: unknown = Reflect.get(prototype, method);
      assert.ok(typeof original === "function", `${className}.${method}`);
      Reflect.set(
        prototype,
        method,
        function watched(this: unknown, ...values: unknown[]): unknown {
          called.add(`${className}.${method}`);
          return Reflect.apply(original, this, values);
        },
      );
    }
  }
}

function missingFromFlows(
  api: PublicApi,
  called: ReadonlySet<string>,
): readonly string[] {
  const named = new Set(
    FLOWS.flatMap((flow) => flow.steps.map((step) => step.name)),
  );
  const methods = [...api.methods].flatMap(([className, names]) =>
    names.map((name) => `${className}.${name}`),
  );
  return [
    ...methods.filter((name) => !called.has(name)),
    ...api.functions.filter((name) => !named.has(name)),
  ];
}

/** A comparison that cannot fail proves nothing, so it has to find what is tampered with. */
function checkComparisonFindsDifferences(
  outcomes: readonly StepOutcome[],
): void {
  const [first] = outcomes;
  assert.ok(first);
  assert.equal(findDifferences([first], [first]).length, 0);
  for (const tampered of [
    { ...first, text: `${first.text} ` },
    { ...first, isExpected: false },
  ])
    assert.equal(findDifferences([first], [tampered]).length, 1);
  assert.equal(stableValue("2026-01-01 00:00:00"), "<time>");
  assert.equal(stableValue("2026-01-01T00:00:00Z"), "2026-01-01T00:00:00Z");
}

async function withMigratedDatabases<Result>(
  instance: TemporaryPostgres,
  administration: Database,
  work: (duckdb: Database, postgres: Database) => Promise<Result>,
): Promise<Result> {
  await administration.execute(`CREATE DATABASE ${REPOSITORY_DATABASE_NAME};`);
  const postgres = await Database.connect(
    instance.urlOfDatabase(REPOSITORY_DATABASE_NAME),
  );
  const duckdb = await Database.create(
    path.join(instance.directory, "repository-check.duckdb"),
  );
  try {
    await postgres.migrate(await readMigrations("postgres/migrations"));
    await duckdb.migrate(await readMigrations("migrations"));
    return await work(duckdb, postgres);
  } finally {
    await duckdb.close();
    await postgres.close();
  }
}

/** A database with other text rules must not open, because lists would sort differently. */
async function checkLocaleRefusal(
  instance: TemporaryPostgres,
  administration: Database,
): Promise<void> {
  const refusedDatabases = {
    pages_locale_icu: "LOCALE_PROVIDER icu ICU_LOCALE 'de-DE' LOCALE 'C.UTF-8'",
    pages_locale_c: "LOCALE_PROVIDER libc LOCALE 'C'",
  };
  for (const [name, locale] of Object.entries(refusedDatabases)) {
    await administration.execute(
      `CREATE DATABASE ${name} TEMPLATE template0 ${locale};`,
    );
    await assert.rejects(
      Database.connect(instance.urlOfDatabase(name)),
      PostgresLocaleError,
    );
    // Dropping only works when the refusal left no connection behind.
    await administration.execute(`DROP DATABASE ${name};`);
  }
}

/**
 * Runs every public method of the area on PostgreSQL and on DuckDB and compares the results.
 *
 * @param instance - The running server.
 * @param administration - An open connection to create the databases with.
 */
export async function runRepositoryChecks(
  instance: TemporaryPostgres,
  administration: Database,
): Promise<void> {
  await checkLocaleRefusal(instance, administration);
  console.info("ok   a database with other text rules is refused");

  const api = await readPublicApi();
  const called = new Set<string>();
  watchCalls(api, called);
  const { duckdb, postgres } = await withMigratedDatabases(
    instance,
    administration,
    async (duckdbDatabase, postgresDatabase) => {
      const duckdbOutcomes = await runFlows(createWorld(duckdbDatabase));
      called.clear();
      return {
        duckdb: duckdbOutcomes,
        postgres: await runFlows(createWorld(postgresDatabase)),
      };
    },
  );
  checkComparisonFindsDifferences(duckdb);
  requireOnlyForeignGaps(findDifferences(duckdb, postgres));
  const missing = missingFromFlows(api, called);
  assert.deepEqual(missing, [], "No step reaches these public methods.");
  const methodCount = [...api.methods.values()].reduce(
    (sum, methods) => sum + methods.length,
    api.functions.length,
  );
  const refusals = FLOWS.flatMap((flow) => flow.steps).filter(
    (step) => step.isRefusal,
  ).length;
  console.info(
    `ok   repositories: ${String(api.files.length)} files, ${String(methodCount)} public methods and functions, ${String(duckdb.length)} steps with ${String(refusals)} refusals, same results in both databases except the listed gaps`,
  );
  for (const [method, reason] of Object.entries(FOREIGN_GAPS))
    console.info(`gap  ${method}: ${reason} (PAGE-215)`);
}
