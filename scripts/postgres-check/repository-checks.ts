import path from "node:path";
import { strict as assert } from "node:assert";

import { Database } from "@/backend/database/Database";
import { PostgresLocaleError } from "@/backend/database/postgres/PostgresLocale";
import { AdministrationActivityRepository } from "@/backend/database/repositories/AdministrationActivityRepository";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { LiveChangeNotificationRepository } from "@/backend/database/repositories/LiveChangeNotificationRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { SystemMetricsRepository } from "@/backend/database/repositories/SystemMetricsRepository";
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
import { EligibleAssigneeRepository } from "@/backend/database/repositories/task/EligibleAssigneeRepository";
import { MilestoneDependencyRepository } from "@/backend/database/repositories/task/MilestoneDependencyRepository";
import { MilestoneInitiativeRepository } from "@/backend/database/repositories/task/MilestoneInitiativeRepository";
import { MilestoneRepository } from "@/backend/database/repositories/task/MilestoneRepository";
import { TaskLabelRepository } from "@/backend/database/repositories/task/TaskLabelRepository";
import { TicketAssetAuditRepository } from "@/backend/database/repositories/task/TicketAssetAuditRepository";
import { TicketAssetMigrationRepository } from "@/backend/database/repositories/task/TicketAssetMigrationRepository";
import { WorkflowStatusRepository } from "@/backend/database/repositories/task/WorkflowStatusRepository";
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemChecklistRepository } from "@/backend/database/repositories/task/WorkItemChecklistRepository";
import { WorkItemChecklistRevisionRepository } from "@/backend/database/repositories/task/WorkItemChecklistRevisionRepository";
import { WorkItemCountRepository } from "@/backend/database/repositories/task/WorkItemCountRepository";
import { WorkItemHistoryRepository } from "@/backend/database/repositories/task/WorkItemHistoryRepository";
import { WorkItemKeyRepository } from "@/backend/database/repositories/task/WorkItemKeyRepository";
import { WorkItemLifecycleRepository } from "@/backend/database/repositories/task/WorkItemLifecycleRepository";
import { WorkItemLinkRepository } from "@/backend/database/repositories/task/WorkItemLinkRepository";
import { WorkItemProjectMoveRepository } from "@/backend/database/repositories/task/WorkItemProjectMoveRepository";
import { WorkItemQueryRepository } from "@/backend/database/repositories/task/WorkItemQueryRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
import { WorkItemWriteRepository } from "@/backend/database/repositories/task/WorkItemWriteRepository";
import { WikiAnchorRepository } from "@/backend/database/repositories/wiki/WikiAnchorRepository";
import { WikiAttachmentRepository } from "@/backend/database/repositories/wiki/WikiAttachmentRepository";
import { WikiCommentRepository } from "@/backend/database/repositories/wiki/WikiCommentRepository";
import { WikiFeedRepository } from "@/backend/database/repositories/wiki/WikiFeedRepository";
import { WikiLinkRepository } from "@/backend/database/repositories/wiki/WikiLinkRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { WikiMentionRepository } from "@/backend/database/repositories/wiki/WikiMentionRepository";
import { WikiPageRepository } from "@/backend/database/repositories/wiki/WikiPageRepository";
import { WikiPageWriteRepository } from "@/backend/database/repositories/wiki/WikiPageWriteRepository";
import { WikiSearchRepository } from "@/backend/database/repositories/wiki/WikiSearchRepository";
import { WikiSettingsRepository } from "@/backend/database/repositories/wiki/WikiSettingsRepository";
import { WikiStateRepository } from "@/backend/database/repositories/wiki/WikiStateRepository";
import { WikiVersionRepository } from "@/backend/database/repositories/wiki/WikiVersionRepository";

import {
  SESSION_FLOW,
  SETTINGS_FLOW,
  USER_FLOW,
} from "./repositories/account-flows";
import {
  AUTHORIZATION_FLOW,
  GROUP_FLOW,
} from "./repositories/authorization-flows";
import {
  AGENT_AREA_CLASSES,
  AGENT_AREA_FLOWS,
} from "./repositories/agent-area";
import { GITHUB_FLOW } from "./repositories/github-flow";
import { CONNECTION_FLOW, INSTANCE_FLOW } from "./repositories/instance-flows";
import {
  MESSAGING_AREA_CLASSES,
  MESSAGING_AREA_FLOWS,
} from "./repositories/messaging-area";
import { PROJECT_DELETION_FLOW } from "./repositories/project-deletion-flow";
import { PROJECT_FLOW } from "./repositories/project-flows";
import {
  AREA_NUL_FLOW,
  SAVED_ORDER_FLOW,
} from "./repositories/saved-order-flows";
import { readPublicApi } from "./repositories/public-api";
import { TASK_FACADE_FLOW } from "./repositories/task-facade-flows";
import { TICKET_CHANGE_FLOW } from "./repositories/ticket-change-flows";
import { TICKET_WIKI_NUL_FLOW } from "./repositories/ticket-wiki-nul-flow";
import { CREATION_ORDER_FLOW } from "./repositories/ticket-wiki-order-flows";
import { TICKET_READ_FLOW } from "./repositories/ticket-read-flows";
import { WIKI_CONTENT_FLOW } from "./repositories/wiki-content-flows";
import { WIKI_FACADE_FLOW } from "./repositories/wiki-facade-flow";
import { WIKI_PAGE_FLOW } from "./repositories/wiki-page-flows";
import { WIKI_STATE_FLOW } from "./repositories/wiki-state-flows";
import { createWorld } from "./repositories/world";
import { runRepeatedSaveChecks } from "./repeated-save-checks";
import { readMigrations } from "../read-database-migrations";

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
  SAVED_ORDER_FLOW,
  AREA_NUL_FLOW,
  TASK_FACADE_FLOW,
  TICKET_READ_FLOW,
  TICKET_CHANGE_FLOW,
  CREATION_ORDER_FLOW,
  TICKET_WIKI_NUL_FLOW,
  WIKI_FACADE_FLOW,
  WIKI_PAGE_FLOW,
  WIKI_CONTENT_FLOW,
  WIKI_STATE_FLOW,
  ...AGENT_AREA_FLOWS,
  ...MESSAGING_AREA_FLOWS,
  PROJECT_DELETION_FLOW,
];

/** Every class of the area, whose methods are watched while the flows run. */
const AREA_CLASSES: Readonly<Record<string, { readonly prototype: object }>> = {
  AdministrationActivityRepository,
  AgentConnectionRepository,
  AuthorizationRepository,
  GitHubRepository,
  InstanceSettingsRepository,
  LiveChangeNotificationRepository,
  ProjectRepository,
  SessionRepository,
  SystemMetricsRepository,
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
  EligibleAssigneeRepository,
  MilestoneDependencyRepository,
  MilestoneInitiativeRepository,
  MilestoneRepository,
  TaskLabelRepository,
  TicketAssetAuditRepository,
  TicketAssetMigrationRepository,
  WorkflowStatusRepository,
  WorkItemAttachmentRepository,
  WorkItemChecklistRepository,
  WorkItemChecklistRevisionRepository,
  WorkItemCountRepository,
  WorkItemHistoryRepository,
  WorkItemKeyRepository,
  WorkItemLifecycleRepository,
  WorkItemLinkRepository,
  WorkItemProjectMoveRepository,
  WorkItemQueryRepository,
  WorkItemTemplateRepository,
  WorkItemTreeRepository,
  WorkItemWriteRepository,
  WikiAnchorRepository,
  WikiAttachmentRepository,
  WikiCommentRepository,
  WikiFeedRepository,
  WikiLinkRepository,
  WikiLookupRepository,
  WikiMentionRepository,
  WikiPageRepository,
  WikiPageWriteRepository,
  WikiSearchRepository,
  WikiSettingsRepository,
  WikiStateRepository,
  WikiVersionRepository,
  ...AGENT_AREA_CLASSES,
  ...MESSAGING_AREA_CLASSES,
};

const STORED_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u;
const GENERATED_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

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

/** Errors of the code keep their name, code and text; the words of a server are its own. */
function refusalText(error: unknown): string {
  if (!(error instanceof Error)) return "not an error";
  if (error.name !== "Error" && error.name !== "error")
    return "code" in error ? `${error.name} ${String(error.code)}` : error.name;
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

async function withMigratedDatabase<Result>(
  instance: TemporaryPostgres,
  administration: Database,
  work: (postgres: Database) => Promise<Result>,
): Promise<Result> {
  await administration.execute(`CREATE DATABASE ${REPOSITORY_DATABASE_NAME};`);
  const postgres = await Database.connect(
    instance.urlOfDatabase(REPOSITORY_DATABASE_NAME),
    path.join(instance.directory, "repository-payloads"),
  );
  try {
    await postgres.migrate(await readMigrations("postgres/migrations"));
    return await work(postgres);
  } finally {
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
    const connections = await administration.query(
      "SELECT count(*) FROM pg_stat_activity WHERE datname = $name;",
      { name },
    );
    assert.deepEqual(connections, [[0]]);
  }
}

/**
 * Runs existing repository flows and their explicit PostgreSQL expectations.
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
  await runRepeatedSaveChecks(instance, administration);
  console.info("ok   a repeated save with U+0000 under a concurrent change");

  const api = await readPublicApi();
  const called = new Set<string>();
  watchCalls(api, called);
  const outcomes = await withMigratedDatabase(
    instance,
    administration,
    async (database) =>
      runFlows(
        createWorld(database, instance.urlOfDatabase(REPOSITORY_DATABASE_NAME)),
      ),
  );
  assert.deepEqual(
    outcomes
      .filter((outcome) => !outcome.isExpected)
      .map((outcome) => `${outcome.label}: ${outcome.text}`),
    [],
    "Every repository step must have its expected outcome.",
  );
  for (const outcome of outcomes) {
    if (outcome.text.startsWith("refused:")) continue;
    const value: unknown = JSON.parse(outcome.text);
    if (typeof value === "object" && value !== null) {
      if ("isAsApproved" in value)
        assert.equal(value.isAsApproved, true, outcome.label);
      if ("isAsKnown" in value)
        assert.equal(value.isAsKnown, true, outcome.label);
    }
  }
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
    `ok   repositories: ${String(api.files.length)} files, ${String(methodCount)} public methods and functions, ${String(outcomes.length)} steps with ${String(refusals)} refusals and explicit PostgreSQL expectations`,
  );
}
