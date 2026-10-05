import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { Database } from "@/backend/database/Database";
import {
  createLegacyDatabaseWarning,
  resolveDatabasePath,
} from "@/backend/database/DatabasePath";
import { DATABASE_MIGRATIONS } from "@/backend/database/Migrations";
import { GitHubSyncScheduler } from "@/backend/github/GitHubSyncScheduler";
import { resolveGitHubTokenKey } from "@/backend/github/GitHubTokenKey";
import { SessionRepository } from "@/backend/database/repositories/SessionRepository";
import { GitHubRepository } from "@/backend/database/repositories/GitHubRepository";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { SettingsService } from "@/backend/service/SettingsService";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { ProjectService } from "@/backend/service/ProjectService";
import { TaskService } from "@/backend/service/TaskService";
import { UserService } from "@/backend/service/UserService";
import { SetupService } from "@/backend/setup/SetupService";

/** Server-only service instances shared by React Router loaders and actions. */
export interface ApplicationServices {
  readonly authService: AuthService;
  readonly sessionService: SessionService;
  readonly userService: UserService;
  readonly settingsService: SettingsService;
  readonly projectService: ProjectService;
  readonly taskService: TaskService;
  readonly gitHubSyncService: GitHubSyncService;
  readonly permissionService: PermissionService;
  readonly passwordHasher: PasswordHasher;
}

declare global {
  var pagesServices: Promise<ApplicationServices> | undefined;
  var pagesShutdownHandlerRegistered: boolean | undefined;
  var pagesSyncSchedulerStarted: boolean | undefined;
}

/**
 * Closes the database on process shutdown so DuckDB finishes queued
 * statements and checkpoints its write-ahead log instead of leaving it for
 * a replay on the next start.
 *
 * @param database - Central database access to close on shutdown.
 */
function registerShutdownHandler(database: Database): void {
  if (globalThis.pagesShutdownHandlerRegistered) {
    return;
  }

  globalThis.pagesShutdownHandlerRegistered = true;

  const shutdown = async (): Promise<void> => {
    try {
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

async function initializeServices(): Promise<ApplicationServices> {
  const databasePath = resolveDatabasePath();
  const legacyDatabaseWarning = createLegacyDatabaseWarning(databasePath);
  const database = await Database.create(databasePath);

  if (legacyDatabaseWarning) {
    console.warn(legacyDatabaseWarning);
  }

  registerShutdownHandler(database);

  await database.migrate(DATABASE_MIGRATIONS);

  const passwordHasher = new PasswordHasher();
  const permissionService = new PermissionService();
  const userRepository = new UserRepository(database);
  const projectRepository = new ProjectRepository(database);
  const taskRepository = new TaskRepository(database);
  const gitHubRepository = new GitHubRepository(database);
  const userSettingsRepository = new UserSettingsRepository(database);
  const sessionRepository = new SessionRepository(database);
  const userService = new UserService(userRepository, permissionService);
  const settingsService = new SettingsService(userSettingsRepository);
  const tokenKey = resolveGitHubTokenKey(databasePath);
  const serverCache = new ServerCache();
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
  const sessionService = new SessionService(sessionRepository, userService);
  const setupService = new SetupService(userRepository, passwordHasher);

  if (await setupService.ensureDefaultAdministrator()) {
    console.info(
      '[pages] Created the default administrator "admin". Change its password after the first login.',
    );
  } else if (await setupService.migrateLegacyBootstrapAdministrator()) {
    console.info(
      '[pages] Migrated the default administrator "admin" to the current password hashing algorithm.',
    );
  }

  await sessionService.removeExpiredSessions();

  return {
    authService: new AuthService(
      userService,
      sessionService,
      passwordHasher,
      new LoginThrottle(),
    ),
    gitHubSyncService,
    passwordHasher,
    permissionService,
    projectService,
    sessionService,
    settingsService,
    taskService,
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

/** Returns the initialized server-side services for the current Pages process. */
export function getApplicationServices(): Promise<ApplicationServices> {
  globalThis.pagesServices ??= initializeServices();

  return globalThis.pagesServices;
}
