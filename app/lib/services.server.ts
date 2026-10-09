import path from "node:path";

import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { Database } from "@/backend/database/Database";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { GitHubSyncScheduler } from "@/backend/github/GitHubSyncScheduler";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { AdministrationService } from "@/backend/service/AdministrationService";
import { GroupAdministrationService } from "@/backend/service/GroupAdministrationService";
import { InstanceSettingsRepository } from "@/backend/database/repositories/InstanceSettingsRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserBoardPreferencesRepository } from "@/backend/database/repositories/UserBoardPreferencesRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { BoardPreferencesService } from "@/backend/service/BoardPreferencesService";
import { HealthService } from "@/backend/service/HealthService";
import { InstanceSettingsService } from "@/backend/service/InstanceSettingsService";
import { SettingsService } from "@/backend/service/SettingsService";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { UserService } from "@/backend/service/UserService";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";
import { WikiService } from "@/backend/service/WikiService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { SetupService } from "@/backend/setup/SetupService";

import { createAgentServices } from "./agent-services.server";

import type { AgentApplicationServices } from "./agent-services.server";

/** Server-only service instances shared by React Router loaders and actions. */
export interface ApplicationServices extends AgentApplicationServices {
  readonly administrationService: AdministrationService;
  readonly groupAdministrationService: GroupAdministrationService;
  readonly authService: AuthService;
  readonly sessionService: SessionService;
  readonly userService: UserService;
  readonly boardPreferencesService: BoardPreferencesService;
  readonly healthService: HealthService;
  readonly instanceSettingsService: InstanceSettingsService;
  readonly settingsService: SettingsService;
  readonly projectService: ProjectService;
  readonly taskService: TaskService;
  readonly taskTemplateService: TaskTemplateService;
  readonly wikiService: WikiService;
  readonly gitHubSyncService: GitHubSyncService;
  readonly permissionService: PermissionService;
  readonly passwordHasher: PasswordHasher;
}

declare global {
  var pagesServices: Promise<ApplicationServices> | undefined;
  var pagesShutdownHandlerRegistered: boolean | undefined;
  var pagesSyncSchedulerStarted: boolean | undefined;
  var pagesWikiMaintenanceStarted: boolean | undefined;
}

/**
 * Closes the database on process shutdown so DuckDB finishes queued
 * statements and checkpoints its write-ahead log instead of leaving it for
 * a replay on the next start.
 *
 * @param database - Central database access to close on shutdown.
 */
function registerShutdownHandler(
  database: Database,
  agents: AgentApplicationServices,
): void {
  if (globalThis.pagesShutdownHandlerRegistered) {
    return;
  }

  globalThis.pagesShutdownHandlerRegistered = true;

  const shutdown = async (): Promise<void> => {
    try {
      await agents.agentCatalogScheduler.shutdown();
      await agents.agentCliLoginService.shutdown();
      await database.close();
      process.exit(0);
    } catch (error: unknown) {
      console.error("[pages] Closing the database failed.", error);
      process.exit(1);
    }
  };

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

/**
 * Creates the services that need little more than the database.
 *
 * @param database - Central database access.
 * @param databasePath - Path of the database; attachments live next to it.
 * @param projectService - Decides which projects an account reads.
 * @param permissionService - Decides the capabilities of an account.
 * @returns Health, instance settings and the wiki.
 */
function createWorkspaceServices(
  database: Database,
  databasePath: string,
  projectService: ProjectService,
  permissionService: PermissionService,
): Pick<
  ApplicationServices,
  "healthService" | "instanceSettingsService" | "wikiService"
> {
  const wikiService = new WikiService(
    new WikiRepository(database),
    projectService,
    permissionService,
    new WikiFileStore(
      path.join(path.dirname(databasePath), "wiki-attachments"),
    ),
  );
  startWikiMaintenanceScheduler(wikiService);
  return {
    healthService: new HealthService(database),
    instanceSettingsService: new InstanceSettingsService(
      new InstanceSettingsRepository(database),
      permissionService,
    ),
    wikiService,
  };
}

/**
 * Brings accounts and sessions up to date at startup.
 *
 * @param setupService - Upgrades a legacy bootstrap administrator.
 * @param sessionService - Removes the sessions that expired meanwhile.
 * @returns The session service, ready for requests.
 */
async function prepareSessions(
  setupService: SetupService,
  sessionService: SessionService,
): Promise<SessionService> {
  if (await setupService.migrateLegacyBootstrapAdministrator()) {
    console.info(
      '[pages] Migrated the default administrator "admin" to the current password hashing algorithm.',
    );
  }

  await sessionService.removeExpiredSessions();

  return sessionService;
}

async function initializeServices(
  database: Database,
  databasePath: string,
): Promise<ApplicationServices> {
  await database.migrate(DATABASE_MIGRATIONS);

  const passwordHasher = new PasswordHasher();
  const serverCache = new ServerCache();
  const authorizationRepository = new AuthorizationRepository(database);
  const administrationService = new AdministrationService(
    authorizationRepository,
    serverCache,
    passwordHasher,
  );
  const groupAdministrationService = new GroupAdministrationService(
    authorizationRepository,
    serverCache,
  );
  const permissionService = new PermissionService((id) =>
    administrationService.getContext(id),
  );
  const userRepository = new UserRepository(database);
  const projectRepository = new ProjectRepository(database);
  const taskRepository = new TaskRepository(database);
  const gitHubRepository = new GitHubRepository(database);
  const userSettingsRepository = new UserSettingsRepository(database);
  const sessionRepository = new SessionRepository(database);
  const userService = new UserService(
    userRepository,
    permissionService,
    administrationService,
  );
  const settingsService = new SettingsService(userSettingsRepository);
  const boardPreferencesService = new BoardPreferencesService(
    new UserBoardPreferencesRepository(database),
  );
  const tokenKey = resolveGitHubTokenKey(databasePath);
  const agentServices = startAgentServices(database, databasePath, tokenKey);
  const projectService = new ProjectService(
    projectRepository,
    permissionService,
    tokenKey,
    serverCache,
  );
  const taskService = new TaskService(
    taskRepository,
    projectService,
    permissionService,
    serverCache,
  );
  const taskTemplateService = new TaskTemplateService(
    new WorkItemTemplateRepository(database),
    taskService,
    projectService,
    permissionService,
  );
  const gitHubSyncService = new GitHubSyncService({
    cache: serverCache,
    gitHubRepository,
    projectRepository,
    projectService,
    taskRepository,
    taskService,
    tokenKey,
    userRepository,
  });
  taskService.setGitHubSync(gitHubSyncService);
  startGitHubSyncScheduler(gitHubSyncService);
  const workspaceServices = createWorkspaceServices(
    database,
    databasePath,
    projectService,
    permissionService,
  );
  const sessionService = await prepareSessions(
    new SetupService(userRepository, passwordHasher),
    new SessionService(sessionRepository, userService),
  );

  return {
    ...agentServices,
    administrationService,
    authService: new AuthService(
      userService,
      sessionService,
      passwordHasher,
      new LoginThrottle(),
    ),
    boardPreferencesService,
    gitHubSyncService,
    groupAdministrationService,
    ...workspaceServices,
    passwordHasher,
    permissionService,
    projectService,
    sessionService,
    settingsService,
    taskService,
    taskTemplateService,
    userService,
  };
}

/**
 * Starts the server-side GitHub synchronization scheduler exactly once.
 *
 * @param gitHubSyncService - Service executing the due project runs.
 *
 * @remarks
 * The scheduler lives in the server process, so configured intervals keep
 * running whether or not any browser currently has Pages open.
 */
function startGitHubSyncScheduler(gitHubSyncService: GitHubSyncService): void {
  if (globalThis.pagesSyncSchedulerStarted) {
    return;
  }

  globalThis.pagesSyncSchedulerStarted = true;
  new GitHubSyncScheduler(gitHubSyncService).start();
}

/**
 * Starts the wiki cleanup (expired trash, old versions, orphaned files)
 * exactly once, with a first run at the start.
 *
 * @param wikiService - Service that carries out the cleanup.
 */
function startWikiMaintenanceScheduler(wikiService: WikiService): void {
  if (globalThis.pagesWikiMaintenanceStarted) {
    return;
  }

  globalThis.pagesWikiMaintenanceStarted = true;
  new WikiMaintenanceScheduler(wikiService).start();
}

async function openConfiguredServices(): Promise<ApplicationServices> {
  const runtime = await getPagesRuntime();
  const databasePath = runtime.getDatabasePath();

  return initializeServices(await Database.create(databasePath), databasePath);
}

/**
 * Returns the initialized server-side services for the current Pages process.
 *
 * @throws {SetupPendingError} While the setup is pending; no database is
 * opened or created before the setup finished.
 */
export function getApplicationServices(): Promise<ApplicationServices> {
  globalThis.pagesServices ??= openConfiguredServices().catch(
    (error: unknown) => {
      // Keep no failed start, so a later request can try again.
      globalThis.pagesServices = undefined;

      throw error;
    },
  );

  return globalThis.pagesServices;
}

/**
 * Starts the services on the database a finished setup just prepared.
 *
 * @param database - Open database of the finished setup.
 * @param databasePath - Path of that database.
 * @returns The services, which later requests receive as well.
 */
export function activateApplicationServices(
  database: Database,
  databasePath: string,
): Promise<ApplicationServices> {
  globalThis.pagesServices = initializeServices(database, databasePath);

  return globalThis.pagesServices;
}

function startAgentServices(
  database: Database,
  databasePath: string,
  tokenKey: Buffer,
): AgentApplicationServices {
  const services = createAgentServices(
    database,
    path.dirname(databasePath),
    tokenKey,
  );
  services.agentCatalogScheduler.start();
  registerShutdownHandler(database, services);
  return services;
}
