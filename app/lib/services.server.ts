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
import { WorkItemAttachmentRepository } from "@/backend/database/repositories/task/WorkItemAttachmentRepository";
import { WorkItemTemplateRepository } from "@/backend/database/repositories/task/WorkItemTemplateRepository";
import { WorkItemTreeRepository } from "@/backend/database/repositories/task/WorkItemTreeRepository";
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
import { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";
import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import { TicketTreeService } from "@/backend/service/task/TicketTreeService";
import { UserService } from "@/backend/service/UserService";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";
import { WikiService } from "@/backend/service/WikiService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { resolveAgentsDirectory } from "@/backend/config/PagesConfig";
import { SetupService } from "@/backend/setup/SetupService";

import { createAgentServices } from "./agent-services.server";
import { createChatServices } from "./chat-services.server";
import { createAgentPlanService } from "./agent-plan-services.server";
import { createTextAssistantServices } from "./text-assistant-services.server";
import { createMcpServices } from "./mcp-services.server";

import type { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import type { AgentApplicationServices } from "./agent-services.server";
import type { ChatApplicationServices } from "./chat-services.server";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { TextAssistantApplicationServices } from "./text-assistant-services.server";
import type { McpApplicationServices } from "./mcp-services.server";

/** Server-only service instances shared by React Router loaders and actions. */
export interface ApplicationServices
  extends
    AgentApplicationServices,
    ChatApplicationServices,
    TextAssistantApplicationServices,
    McpApplicationServices {
  readonly administrationService: AdministrationService;
  readonly agentPlanService: AgentPlanService;
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
  readonly taskAttachmentService: TaskAttachmentService;
  readonly ticketTreeService: TicketTreeService;
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
  assistant: TextAssistantApplicationServices,
  plans: AgentPlanService,
): void {
  if (globalThis.pagesShutdownHandlerRegistered) {
    return;
  }

  globalThis.pagesShutdownHandlerRegistered = true;

  const shutdown = async (): Promise<void> => {
    try {
      await assistant.assistantHistoryScheduler.shutdown();
      await assistant.textAssistantService.shutdown();
      await agents.chatRequests.shutdown();
      await plans.shutdown();
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

/**
 * Creates the services that decide what an account may do.
 *
 * @param database - The open database.
 * @param passwordHasher - Hashes the passwords the administration sets.
 * @param serverCache - Shared cache the administration invalidates on changes.
 * @returns The administration, the group administration and the permission service.
 */
function createAuthorizationServices(
  database: Database,
  passwordHasher: PasswordHasher,
  serverCache: ServerCache,
): Pick<
  ApplicationServices,
  "administrationService" | "groupAdministrationService" | "permissionService"
> {
  const authorizationRepository = new AuthorizationRepository(database);
  const administrationService = new AdministrationService(
    authorizationRepository,
    serverCache,
    passwordHasher,
  );

  return {
    administrationService,
    groupAdministrationService: new GroupAdministrationService(
      authorizationRepository,
      serverCache,
    ),
    permissionService: new PermissionService((id) =>
      administrationService.getContext(id),
    ),
  };
}

async function initializeServices(
  database: Database,
  databasePath: string,
): Promise<ApplicationServices> {
  await database.migrate(DATABASE_MIGRATIONS);

  const passwordHasher = new PasswordHasher();
  const serverCache = new ServerCache();
  const {
    administrationService,
    groupAdministrationService,
    permissionService,
  } = createAuthorizationServices(database, passwordHasher, serverCache);
  const userRepository = new UserRepository(database);
  const projectRepository = new ProjectRepository(database);
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
  const agentServices = await startAgents(database, databasePath, tokenKey);
  const projectService = new ProjectService(
    projectRepository,
    permissionService,
    tokenKey,
    serverCache,
  );
  const workspaceServices = createWorkspaceServices(
    database,
    databasePath,
    projectService,
    permissionService,
  );
  const assistantServices = createTextAssistantServices({
    database,
    projectService,
    permissions: permissionService,
    agents: agentServices,
  });
  assistantServices.assistantHistoryScheduler.start();
  const taskServices = createTaskServices({
    database,
    databasePath,
    permissionService,
    projectRepository,
    projectService,
    serverCache,
    tokenKey,
    userRepository,
    wikiService: workspaceServices.wikiService,
  });
  const agentPlanService = await preparePlanService(database, {
    agents: agentServices,
    assistant: assistantServices,
    tasks: taskServices.taskService,
    users: userService,
  });
  const sessionService = await prepareSessions(
    new SetupService(userRepository, passwordHasher),
    new SessionService(sessionRepository, userService),
  );

  const mcpServices = startMcpWorkspace({
    database,
    databasePath,
    accounts: { users: userService, administration: administrationService },
    agents: agentServices,
    wiki: workspaceServices.wikiService,
    gitHubSync: taskServices.gitHubSyncService,
    serverCache,
  });
  return {
    ...agentServices,
    agentPlanService,
    ...mcpServices,
    ...assistantServices,
    administrationService,
    authService: new AuthService(
      userService,
      sessionService,
      passwordHasher,
      new LoginThrottle(),
    ),
    boardPreferencesService,
    groupAdministrationService,
    ...workspaceServices,
    passwordHasher,
    permissionService,
    projectService,
    sessionService,
    settingsService,
    ...taskServices,
    userService,
  };
}

async function preparePlanService(
  database: Database,
  input: {
    readonly agents: AgentApplicationServices;
    readonly assistant: TextAssistantApplicationServices;
    readonly tasks: TaskService;
    readonly users: UserService;
  },
): Promise<AgentPlanService> {
  const plans = await createAgentPlanService({
    database,
    agents: input.agents,
    tasks: input.tasks,
    users: input.users,
  });
  registerShutdownHandler(database, input.agents, input.assistant, plans);
  return plans;
}

/**
 * Builds the agent write services and the chat on the same operation catalog,
 * and shares the existing maintenance scheduler.
 */
function startMcpWorkspace(context: {
  readonly database: Database;
  readonly databasePath: string;
  readonly accounts: {
    readonly users: UserService;
    readonly administration: AdministrationService;
  };
  readonly agents: AgentApplicationServices;
  readonly wiki: WikiService;
  readonly gitHubSync: GitHubSyncService;
  readonly serverCache: ServerCache;
}): McpApplicationServices & ChatApplicationServices {
  // The publisher of the ticket pages, on its own repository: agent ticket changes
  // follow the same GitHub rule once they are committed.
  const taskRepository = new TaskRepository(context.database);
  const publisher = new TaskGitHubPublisher(
    taskRepository,
    new TaskHistoryRecorder(taskRepository),
    context.serverCache,
  );
  publisher.attach(context.gitHubSync);
  const { users, administration } = context.accounts;
  const directory = path.dirname(context.databasePath);
  const services = createMcpServices(context.database, users, administration, {
    directory,
    wikiService: context.wiki,
    tickets: { cache: context.serverCache, publisher },
  });
  startWikiMaintenanceScheduler(context.wiki, services.agentAssetService);
  return {
    ...services,
    ...createChatServices({
      database: context.database,
      directory,
      accounts: context.accounts,
      agents: context.agents,
      router: services.chatOperationRouter,
    }),
  };
}

/** What the task services are built from. */
interface TaskServiceContext {
  readonly database: Database;
  readonly databasePath: string;
  readonly permissionService: PermissionService;
  readonly projectRepository: ProjectRepository;
  readonly projectService: ProjectService;
  readonly serverCache: ServerCache;
  readonly tokenKey: ReturnType<typeof resolveGitHubTokenKey>;
  readonly userRepository: UserRepository;
  readonly wikiService: WikiService;
}

/**
 * Creates the services of tickets: the tickets themselves, templates, GitHub
 * synchronization, ticket attachments and the ticket tree (A8.2).
 *
 * @param context - The repositories and services the ticket services use.
 * @returns The ticket services, with GitHub and attachment files attached.
 */
function createTaskServices(
  context: TaskServiceContext,
): Pick<
  ApplicationServices,
  | "gitHubSyncService"
  | "taskAttachmentService"
  | "taskService"
  | "taskTemplateService"
  | "ticketTreeService"
> {
  const { database, permissionService, projectService } = context;
  const taskRepository = new TaskRepository(database);
  const taskService = new TaskService(
    taskRepository,
    projectService,
    permissionService,
    context.serverCache,
  );
  const gitHubSyncService = new GitHubSyncService({
    cache: context.serverCache,
    gitHubRepository: new GitHubRepository(database),
    projectRepository: context.projectRepository,
    projectService,
    taskRepository,
    taskService,
    tokenKey: context.tokenKey,
    userRepository: context.userRepository,
  });

  taskService.setGitHubSync(gitHubSyncService);
  startGitHubSyncScheduler(gitHubSyncService);

  return {
    gitHubSyncService,
    ...createTicketServices(
      database,
      context.databasePath,
      taskService,
      context.wikiService,
    ),
    taskService,
    taskTemplateService: new TaskTemplateService(
      new WorkItemTemplateRepository(database),
      taskService,
      projectService,
      permissionService,
    ),
  };
}

/**
 * Creates the services of ticket attachments and the ticket tree (A8.2).
 *
 * @param database - The open database.
 * @param databasePath - Path of the database; attachments lie next to it.
 * @param taskService - Checks the access to tickets.
 * @param wikiService - Provides the instance-wide upload limits.
 * @returns The services, with the attachment files tied to ticket deletion.
 */
function createTicketServices(
  database: Database,
  databasePath: string,
  taskService: TaskService,
  wikiService: WikiService,
): Pick<ApplicationServices, "taskAttachmentService" | "ticketTreeService"> {
  const taskAttachmentService = new TaskAttachmentService(
    new WorkItemAttachmentRepository(database),
    taskService,
    wikiService,
    new WikiFileStore(
      path.join(path.dirname(databasePath), "ticket-attachments"),
    ),
  );

  taskService.setAttachmentFiles(taskAttachmentService);
  void sweepTicketAttachments(taskAttachmentService);

  return {
    taskAttachmentService,
    ticketTreeService: new TicketTreeService(
      new WorkItemTreeRepository(database),
      taskService,
    ),
  };
}

/**
 * Removes ticket attachment files nothing refers to any more, such as those
 * of projects deleted for good, once when the server starts.
 *
 * @param service - The ticket attachment service.
 */
async function sweepTicketAttachments(
  service: TaskAttachmentService,
): Promise<void> {
  try {
    await service.sweep();
  } catch (error: unknown) {
    console.warn("Pages could not sweep ticket attachment files.", error);
  }
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
function startWikiMaintenanceScheduler(
  wikiService: WikiService,
  assets: AgentAssetService,
): void {
  if (globalThis.pagesWikiMaintenanceStarted) {
    return;
  }

  globalThis.pagesWikiMaintenanceStarted = true;
  new WikiMaintenanceScheduler({
    runMaintenance: async () => {
      await wikiService.runMaintenance();
      await assets.runMaintenance();
    },
  }).start();
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

/** The agent folders lie next to the configuration file, apart from the data directory. */
async function startAgents(
  database: Database,
  databasePath: string,
  tokenKey: Buffer,
): Promise<AgentApplicationServices> {
  const runtime = await getPagesRuntime();
  const services = createAgentServices(
    database,
    path.dirname(databasePath),
    tokenKey,
    resolveAgentsDirectory(runtime.configFile.path),
  );
  services.agentCatalogScheduler.start();
  return services;
}
