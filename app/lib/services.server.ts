import path from "node:path";

import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
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
import { ProjectDeletionStorage } from "@/backend/service/project/ProjectDeletionStorage";
import { AnnouncingTaskService } from "@/backend/service/AnnouncingTaskService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
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
import { SetupService } from "@/backend/setup/SetupService";
import { PICA_WORKSPACE_DIRECTORY_NAME } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import {
  logCaughtError,
  logDiagnostic,
  logEvent,
} from "@/backend/logging/Logger";
import { pagesMcpBundlePath } from "@/backend/agents/cli/PagesMcpBundle";

import { startExecutionServices } from "./agent-execution-services.server";
import { createChatServices } from "./chat-services.server";
import { createAgentPlanService } from "./agent-plan-services.server";
import { createMcpServices } from "./mcp-services.server";
import { createDiscordServices } from "./discord-services.server";

import type { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import type { TaskService } from "@/backend/service/TaskService";
import type { AgentApplicationServices } from "./agent-services.server";
import type {
  ChatApplicationServices,
  PicaAcpSettings,
} from "./chat-services.server";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import type { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import type { AgentPlanServices } from "./agent-plan-services.server";
import type { AgentPlanMcpSettings } from "@/backend/service/agents/AgentPlanSessionAccess";
import type { McpApplicationServices } from "./mcp-services.server";
import type { DiscordApplicationServices } from "./discord-services.server";

/** Server-only service instances shared by React Router loaders and actions. */
export interface ApplicationServices
  extends
    AgentApplicationServices,
    ChatApplicationServices,
    McpApplicationServices,
    DiscordApplicationServices {
  readonly administrationService: AdministrationService;
  readonly agentPlanService: AgentPlanService;
  /** The PageAgentCLI sessions of plan nodes: history, live events and instructions. */
  readonly agentSessionService: AgentSessionService;
  readonly agentPlanRecoveryService: AgentPlanRecoveryService;
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
  plans: AgentPlanService,
): void {
  if (globalThis.pagesShutdownHandlerRegistered) {
    return;
  }

  globalThis.pagesShutdownHandlerRegistered = true;

  const shutdown = async (): Promise<void> => {
    try {
      await agents.chatRequests.shutdown();
      try {
        await plans.shutdown();
      } finally {
        await agents.acpResourceScheduler.shutdown();
      }
      await agents.agentCatalogScheduler.shutdown();
      await agents.agentToolManagerService.shutdown();
      await agents.agentToolStartupService.shutdown();
      await agents.agentCliLoginService.shutdown();
      await database.close();
    } catch (error: unknown) {
      logCaughtError("services", error);

      logDiagnostic(
        "services",
        "error",
        "[pages] Closing the database failed.",
        error,
      );
      throw error;
    }
  };

  registerShutdownTask(shutdown);
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
    logDiagnostic(
      "services",
      "info",
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
  const userService = new UserService(
    userRepository,
    permissionService,
    administrationService,
  );
  const { settingsService, boardPreferencesService } =
    createPreferenceServices(database);
  const tokenKey = resolveGitHubTokenKey(databasePath);
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
  const { agentServices } = await startExecutionServices(
    database,
    databasePath,
    {
      tokenKey,
      tickets: taskServices.taskAttachmentService,
      wiki: workspaceServices.wikiService,
    },
  );
  const planServices = await preparePlanService(database, {
    agents: agentServices,
    projects: projectService,
    tasks: taskServices.taskService,
    users: userService,
  });
  const sessionService = await prepareSessions(
    new SetupService(userRepository, passwordHasher),
    new SessionService(new SessionRepository(database), userService),
  );

  const mcpServices = await startMcpWorkspace({
    database,
    databasePath,
    accounts: { users: userService, administration: administrationService },
    agents: { ...agentServices, ...planServices },
    wiki: workspaceServices.wikiService,
    tasks: taskServices,
    serverCache,
  });
  return {
    ...agentServices,
    ...planServices,
    ...mcpServices,
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

/**
 * Where plan sessions find the Pages MCP bundle and how it reaches this instance.
 *
 * @remarks
 * `PAGES_MCP_BUNDLE` names a built bundle; without it the bundle of the MCP
 * package next to the server is used when it exists. `PAGES_AGENT_API_URL`
 * overrides the loopback address of the configured port, for example behind
 * a reverse proxy.
 */
function planMcpSettings(port: number): AgentPlanMcpSettings {
  return {
    bundle: pagesMcpBundlePath(),
    url: configuredValue("PAGES_AGENT_API_URL") ?? `http://127.0.0.1:${port}`,
    node: process.execPath,
  };
}

/**
 * Where Pica's Codex sessions reach the tool bridge and keep their working directories.
 *
 * @remarks
 * The bridge uses the same local address as the Pages MCP process of plan
 * nodes. The working directories lie next to the agent folders, outside the
 * folders the isolation hides.
 */
async function picaAcpSettings(): Promise<PicaAcpSettings> {
  const runtime = await getPagesRuntime();
  const { url } = planMcpSettings(runtime.getConfig().port);
  return {
    bridgeUrl: `${url.replace(/\/$/u, "")}/api/v1/pica-bridge`,
    workspaceRoot: path.join(
      path.dirname(runtime.configFile.path),
      PICA_WORKSPACE_DIRECTORY_NAME,
    ),
  };
}

/** An environment variable with content; empty counts as unset. */
function configuredValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value === undefined || value === "" ? null : value;
}

async function preparePlanService(
  database: Database,
  input: {
    readonly agents: AgentApplicationServices;
    readonly projects: ProjectService;
    readonly tasks: TaskService;
    readonly users: UserService;
  },
): Promise<AgentPlanServices> {
  const runtime = await getPagesRuntime();
  const services = await createAgentPlanService({
    database,
    agents: input.agents,
    tasks: input.tasks,
    users: input.users,
    mcp: planMcpSettings(runtime.getConfig().port),
  });
  const plans = services.agentPlanService;
  // Deleting a project has to end its plan runs and clear their files first.
  input.projects.setDeletionEffects(
    new ProjectDeletionStorage(plans, path.dirname(runtime.getDatabasePath())),
  );
  registerShutdownHandler(database, input.agents, plans);
  return services;
}

/**
 * Builds the agent write services and the chat on the same operation catalog,
 * and shares the existing maintenance scheduler.
 */
async function startMcpWorkspace(context: {
  readonly database: Database;
  readonly databasePath: string;
  readonly accounts: {
    readonly users: UserService;
    readonly administration: AdministrationService;
  };
  /** The agent services, with the plan service MCP clients and the chat use. */
  readonly agents: AgentApplicationServices & {
    readonly agentPlanService: AgentPlanService;
  };
  readonly wiki: WikiService;
  /** The ticket services, whose GitHub synchronization and event publisher the workspace shares. */
  readonly tasks: Pick<
    ApplicationServices,
    "gitHubSyncService" | "pagesEventPublisher"
  >;
  readonly serverCache: ServerCache;
}): Promise<McpApplicationServices & ChatApplicationServices> {
  // The publisher of the ticket pages, on its own repository: agent ticket changes
  // follow the same GitHub rule once they are committed.
  const taskRepository = new TaskRepository(context.database);
  const publisher = new TaskGitHubPublisher(
    taskRepository,
    new TaskHistoryRecorder(taskRepository),
    context.serverCache,
  );
  publisher.attach(context.tasks.gitHubSyncService);
  const { users, administration } = context.accounts;
  const directory = path.dirname(context.databasePath);
  const services = createMcpServices(context.database, users, administration, {
    directory,
    wikiService: context.wiki,
    tickets: { cache: context.serverCache, publisher },
    agentWorkspaces: context.agents.agentWorkspaceService,
    pageAgents: context.agents.pageAgentService,
    plans: context.agents.agentPlanService,
    events: context.tasks.pagesEventPublisher,
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
      acp: await picaAcpSettings(),
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
 * synchronization, ticket attachments, the ticket tree (A8.2) and the
 * Discord notifications that follow ticket and milestone changes.
 *
 * @param context - The repositories and services the ticket services use.
 * @returns The ticket services, with GitHub and attachment files attached,
 * and the event publisher both the interface and the agents announce on.
 */
function createTaskServices(
  context: TaskServiceContext,
): Pick<
  ApplicationServices,
  | "discordAuthorizationService"
  | "discordConnectionService"
  | "gitHubSyncService"
  | "pagesEventPublisher"
  | "taskAttachmentService"
  | "taskService"
  | "taskTemplateService"
  | "ticketTreeService"
> {
  const { database, permissionService, projectService } = context;
  const taskRepository = new TaskRepository(database);
  const pagesEventPublisher = new PagesEventPublisher();
  const taskService = new AnnouncingTaskService(
    {
      cache: context.serverCache,
      permissionService,
      projectService,
      taskRepository,
    },
    pagesEventPublisher,
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
    ...createDiscordServices({
      database,
      events: pagesEventPublisher,
      projectRepository: context.projectRepository,
      projectService,
      taskRepository,
    }),
    gitHubSyncService,
    pagesEventPublisher,
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
    logCaughtError("services", error);

    logDiagnostic(
      "services",
      "warn",
      "Pages could not sweep ticket attachment files.",
      error,
    );
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
  const scheduler = new GitHubSyncScheduler(gitHubSyncService);
  scheduler.start();
  registerShutdownTask(async () => {
    scheduler.stop();
  });
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
  const scheduler = new WikiMaintenanceScheduler({
    runMaintenance: async () => {
      await wikiService.runMaintenance();
      await assets.runMaintenance();
    },
  });
  scheduler.start();
  registerShutdownTask(async () => {
    scheduler.stop();
  });
}

async function openConfiguredServices(): Promise<ApplicationServices> {
  logEvent({
    level: "info",
    event: "services.initialization.started",
    component: "ApplicationServices",
    message: "Application services initializing",
  });
  const runtime = await getPagesRuntime();
  const databasePath = runtime.getDatabasePath();

  const services = await initializeServices(
    await Database.create(databasePath),
    databasePath,
  );
  logEvent({
    level: "info",
    event: "services.initialization.completed",
    component: "ApplicationServices",
    message: "Application services initialized",
  });
  return services;
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
      logCaughtError("services", error);

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

function createPreferenceServices(
  database: Database,
): Pick<ApplicationServices, "settingsService" | "boardPreferencesService"> {
  return {
    settingsService: new SettingsService(new UserSettingsRepository(database)),
    boardPreferencesService: new BoardPreferencesService(
      new UserBoardPreferencesRepository(database),
    ),
  };
}
