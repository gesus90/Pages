import path from "node:path";

import { RepositoryReadService } from "@/backend/service/github/RepositoryReadService";
import { hasRunServiceOwnership } from "@/backend/runtime/RunsMode";
import { GitHubCreationRepository } from "@/backend/database/repositories/integrations/GitHubCreationRepository";
import { AuthService } from "@/backend/auth/AuthService";
import { LoginThrottle } from "@/backend/auth/LoginThrottle";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { PermissionService } from "@/backend/auth/PermissionService";
import { SessionService } from "@/backend/auth/SessionService";
import { Database } from "@/backend/database/Database";
import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { retireMatchingSetupIntent } from "@/backend/setup/SetupIntent";
import { GitHubJobRepository } from "@/backend/database/repositories/integrations/GitHubJobRepository";
import { GitHubJobClient } from "@/backend/service/integrations/GitHubJobClient";
import { GitHubJobWorker } from "@/backend/service/integrations/GitHubJobWorker";
import { canProcessIntegrations } from "@/backend/service/integrations/IntegrationProcessing";
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
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { HealthService } from "@/backend/service/HealthService";
import { InstanceSettingsService } from "@/backend/service/InstanceSettingsService";
import { GitHubSyncService } from "@/backend/service/GitHubSyncService";
import { ProjectService } from "@/backend/service/ProjectService";
import { ProjectDeletionStorage } from "@/backend/service/project/ProjectDeletionStorage";
import { AnnouncingTaskService } from "@/backend/service/AnnouncingTaskService";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { TaskTemplateService } from "@/backend/service/TaskTemplateService";
import { UserService } from "@/backend/service/UserService";
import { AnnouncingWikiService } from "@/backend/service/wiki/AnnouncingWikiService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { SetupService } from "@/backend/setup/SetupService";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import {
  createServiceCache,
  prepareServiceDatabase,
  startGitHubWorker,
} from "./services-background.server";
import { prepareSessions } from "./session-services.server";
import { startExecutionServices } from "./agent-execution-services.server";
import { createTicketServices } from "./ticket-services.server";
import { planMcpSettings } from "./bridge-settings.server";
import { startMcpWorkspace } from "./mcp-workspace-services.server";
import { createAgentPlanService } from "./agent-plan-services.server";
import { createDiscordServices } from "./discord-services.server";
import { createGoogleDriveServices } from "./google-drive-services.server";
import { createLiveChangeServices } from "./live-change-services.server";
import { createPreferenceServices } from "./preference-services.server";
import { registerShutdownHandler } from "./services-shutdown.server";
import { createAutomationServices } from "./automation-services.server";
import { createCalendarService } from "./calendar-services.server";

import type { WikiService } from "@/backend/service/WikiService";
import type { CalendarService } from "@/backend/service/calendar/CalendarService";
import type { AutomationApplicationServices } from "./automation-services.server";
import type { TaskAttachmentService } from "@/backend/service/task/TaskAttachmentService";
import type { TicketAssetAuditService } from "@/backend/service/task/TicketAssetAuditService";
import type { TicketTreeService } from "@/backend/service/task/TicketTreeService";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { LiveChangeHub } from "@/backend/service/events/LiveChangeHub";
import type { LiveChangeAudience } from "@/backend/service/events/LiveChangeAudience";
import type { AgentLocalSessionPreparation } from "@/backend/service/agents/AgentLocalSessionPreparation";
import type { TaskService } from "@/backend/service/TaskService";
import type { AgentApplicationServices } from "./agent-services.server";
import type { ChatApplicationServices } from "./chat-services.server";
import type { EmployeeApplicationServices } from "./employee-services.server";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import type { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import type {
  AgentPlanLoaderServices,
  AgentPlanServices,
} from "./agent-plan-services.server";
import type { McpApplicationServices } from "./mcp-services.server";
import type { DiscordApplicationServices } from "./discord-services.server";
import type { GoogleDriveApplicationServices } from "./google-drive-services.server";
import type { PreferenceApplicationServices } from "./preference-services.server";
import type { SystemApplicationServices } from "./system-services.server";

/** Server-only service instances shared by React Router loaders and actions. */
export interface ApplicationServices
  extends
    AgentApplicationServices,
    ChatApplicationServices,
    EmployeeApplicationServices,
    McpApplicationServices,
    DiscordApplicationServices,
    GoogleDriveApplicationServices,
    PreferenceApplicationServices,
    SystemApplicationServices,
    AutomationApplicationServices,
    AgentPlanLoaderServices {
  readonly administrationService: AdministrationService;
  readonly agentPlanService: AgentPlanService;
  readonly agentLocalSessionPreparation: AgentLocalSessionPreparation;
  /** The PageAgentCLI sessions of plan nodes: history, live events and instructions. */
  readonly agentSessionService: AgentSessionService;
  readonly agentPlanRecoveryService: AgentPlanRecoveryService;
  readonly groupAdministrationService: GroupAdministrationService;
  readonly authService: AuthService;
  readonly sessionService: SessionService;
  readonly userService: UserService;
  readonly healthService: HealthService;
  readonly instanceSettingsService: InstanceSettingsService;
  readonly projectService: ProjectService;
  readonly taskService: TaskService;
  readonly taskTemplateService: TaskTemplateService;
  readonly taskAttachmentService: TaskAttachmentService;
  readonly ticketAssetAuditService: TicketAssetAuditService;
  readonly ticketTreeService: TicketTreeService;
  readonly wikiService: WikiService;
  readonly gitHubSyncService: GitHubSyncService;
  readonly repositoryReadService: RepositoryReadService;
  /** The live notices of open pages: kind and id of changed objects, per account. */
  readonly liveChangeHub: LiveChangeHub;
  /** Decides who may learn about which event, for the hub and `pages-core`. */
  readonly liveChangeAudience: LiveChangeAudience;
  readonly permissionService: PermissionService;
  readonly passwordHasher: PasswordHasher;
  /** The calendar of PAGE-301 for the interface, Pica Mobile, Pica and MCP. */
  readonly calendarService: CalendarService;
}

declare global {
  var pagesServices: Promise<ApplicationServices> | undefined;
  var pagesShutdownHandlerRegistered: boolean | undefined;
  var pagesWikiMaintenanceStarted: boolean | undefined;
  var pagesGitHubWorkerStarted: Promise<void> | undefined;
}

/**
 * Creates the services that need little more than the database.
 *
 * @param database - Central database access.
 * @param databasePath - Path of the database; attachments live next to it.
 * @param access - Decides project access and capabilities; the publisher
 * receives the wiki's committed page changes.
 * @returns Health, instance settings and the wiki.
 */
function createWorkspaceServices(
  database: Database,
  databasePath: string,
  access: {
    readonly projectService: ProjectService;
    readonly permissionService: PermissionService;
    readonly events: PagesEventPublisher;
  },
): Pick<
  ApplicationServices,
  "healthService" | "instanceSettingsService" | "wikiService"
> {
  const { permissionService } = access;
  const wikiService = new AnnouncingWikiService(
    new WikiRepository(database),
    access,
    new WikiFileStore(
      path.join(path.dirname(databasePath), "wiki-attachments"),
    ),
    access.events,
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

function createSessionAuth(
  users: UserService,
  sessions: SessionService,
  hasher: PasswordHasher,
): AuthService {
  return new AuthService(users, sessions, hasher, new LoginThrottle());
}

async function initializeServices(
  database: Database,
  databasePath: string,
): Promise<ApplicationServices> {
  await prepareServiceDatabase(database);

  const passwordHasher = new PasswordHasher();
  const serverCache = await createServiceCache();
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
  const { settingsService, designThemeService, boardPreferencesService } =
    createPreferenceServices(database, databasePath);
  const tokenKey = resolveGitHubTokenKey(databasePath);
  const projectService = new ProjectService(
    projectRepository,
    permissionService,
    tokenKey,
    serverCache,
  );
  // One publisher for the whole process: tickets, wiki, agents, Discord and the live view.
  const pagesEventPublisher = new PagesEventPublisher(database);
  const workspaceServices = createWorkspaceServices(database, databasePath, {
    projectService,
    permissionService,
    events: pagesEventPublisher,
  });
  const taskServices = await createTaskServices({
    administrationService,
    pagesEventPublisher,
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
    browserAuthentication: sessionService,
    database,
    databasePath,
    accounts: { users: userService, administration: administrationService },
    agents: { ...agentServices, ...planServices },
    wiki: workspaceServices.wikiService,
    instanceSettings: workspaceServices.instanceSettingsService,
    projects: projectService,
    tasks: taskServices,
    serverCache,
    tokenKey,
  });
  const calendarService = createCalendarService({
    database,
    projectService,
    permissionService,
    settingsService,
    events: pagesEventPublisher,
    push: async () => {
      const services = await getApplicationServices();
      return {
        picaMobileNotifications: services.picaMobileNotifications,
        picaMobileAutomationPush: services.picaMobileAutomationPush,
        settingsService: services.settingsService,
      };
    },
  });
  return {
    ...agentServices,
    ...planServices,
    ...mcpServices,
    calendarService,
    administrationService,
    authService: createSessionAuth(userService, sessionService, passwordHasher),
    boardPreferencesService,
    designThemeService,
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
    readonly projects: ProjectService;
    readonly tasks: TaskService;
    readonly users: UserService;
  },
): Promise<AgentPlanServices & AutomationApplicationServices> {
  const runtime = await getPagesRuntime();
  const services = await createAgentPlanService({
    database,
    agents: input.agents,
    tasks: input.tasks,
    users: input.users,
    mcp: planMcpSettings(runtime.getConfig().port),
    api: async () => (await getApplicationServices()).pagesAgentApiService,
  });
  const plans = services.agentPlanService;
  // Deleting a project has to end its plan runs and clear their files first.
  input.projects.setDeletionEffects(
    new ProjectDeletionStorage(plans, path.dirname(runtime.getDatabasePath())),
  );
  const automations = createAutomationServices(database, input, services);
  registerShutdownHandler(database, input.agents, plans);
  return { ...services, ...automations };
}

/** What the task services are built from. */
interface TaskServiceContext {
  readonly administrationService: AdministrationService;
  readonly database: Database;
  readonly pagesEventPublisher: PagesEventPublisher;
  readonly databasePath: string;
  readonly permissionService: PermissionService;
  readonly projectRepository: ProjectRepository;
  readonly projectService: ProjectService;
  readonly serverCache: ServerCache;
  readonly tokenKey: ReturnType<typeof resolveGitHubTokenKey>;
  readonly userRepository: UserRepository;
  readonly wikiService: WikiService;
}

type TaskApplicationServices = Pick<
  ApplicationServices,
  | "discordAuthorizationService"
  | "discordConnectionService"
  | "gitHubSyncService"
  | "repositoryReadService"
  | keyof GoogleDriveApplicationServices
  | "liveChangeHub"
  | "liveChangeAudience"
  | "pagesEventPublisher"
  | "taskAttachmentService"
  | "ticketAssetAuditService"
  | "taskService"
  | "taskTemplateService"
  | "ticketTreeService"
>;

function createRepositoryReads(
  context: TaskServiceContext,
): RepositoryReadService {
  return new RepositoryReadService({
    projects: context.projectService,
    accounts: { getById: (id) => context.userRepository.findById(id) },
    repository: context.projectRepository,
    tokenKey: context.tokenKey,
  });
}

/**
 * Creates the services of tickets: the tickets themselves, templates, GitHub
 * synchronization, ticket attachments, the ticket tree (A8.2), the
 * Discord notifications that follow ticket and milestone changes and the
 * Google Drive connection of the instance (PAGE-170).
 *
 * @param context - The repositories and services the ticket services use.
 * @returns The ticket services, with GitHub and attachment files attached,
 * and the event publisher both the interface and the agents announce on.
 */
async function createTaskServices(
  context: TaskServiceContext,
): Promise<TaskApplicationServices> {
  const { database, permissionService, projectService } = context;
  const taskRepository = new TaskRepository(database);
  const { pagesEventPublisher } = context;
  const taskService = new AnnouncingTaskService(
    {
      cache: context.serverCache,
      permissionService,
      projectService,
      taskRepository,
    },
    pagesEventPublisher,
  );
  const githubOptions = {
    creations: new GitHubCreationRepository(database),
    cache: context.serverCache,
    gitHubRepository: new GitHubRepository(database),
    projectRepository: context.projectRepository,
    projectService,
    taskRepository,
    taskService,
    tokenKey: context.tokenKey,
    userRepository: context.userRepository,
    events: pagesEventPublisher,
  };
  const jobs = new GitHubJobRepository(database);
  const gitHubSyncService = new GitHubSyncService({
    ...githubOptions,
    jobs: new GitHubJobClient(jobs, {
      waitForPublication:
        (await getPagesRuntime()).getConfig().integrationsMode !== "separate",
    }),
  });
  taskService.setGitHubSync(gitHubSyncService);
  const config = (await getPagesRuntime()).getConfig();
  if (canProcessIntegrations()) {
    const worker = new GitHubJobWorker({
      jobs,
      github: new GitHubSyncService(githubOptions),
      users: context.userRepository,
      tasks: taskService,
    });
    await startGitHubWorker(worker);
  }

  return {
    ...createDiscordServices({
      database,
      events: pagesEventPublisher,
      projectRepository: context.projectRepository,
      projectService,
      taskRepository,
    }),
    gitHubSyncService,
    repositoryReadService: createRepositoryReads(context),
    ...createGoogleDriveServices(database, context.tokenKey, (id) =>
      context.administrationService.getContext(id),
    ),
    ...createLiveChangeServices({
      database,
      databaseUrl: config.firstRun ? undefined : config.databaseUrl,
      events: pagesEventPublisher,
      audience: {
        tickets: taskService,
        milestones: taskRepository,
        projects: projectService,
        wiki: context.wikiService,
      },
    }),
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

async function openConfiguredServices(): Promise<ApplicationServices> {
  logEvent({
    level: "info",
    event: "services.initialization.started",
    component: "ApplicationServices",
    message: "Application services initializing",
  });
  const runtime = await getPagesRuntime();
  const databasePath = runtime.getDatabasePath();
  const databaseUrl = runtime.getDatabaseUrl();

  if (databaseUrl === null)
    throw new Error("A PostgreSQL databaseUrl is required to start Pages.");

  const services = await initializeServices(
    await Database.connect(databaseUrl, path.dirname(databasePath)),
    databasePath,
  );
  await retireMatchingSetupIntent(runtime.configFile.path, databaseUrl);
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
  // The first caller is often a request; the schedulers armed here must not inherit it.
  globalThis.pagesServices ??= withBackgroundDatabaseWork(
    "services_startup",
    openConfiguredServices,
  ).catch((error: unknown) => {
    logCaughtError("services", error);

    if (hasRunServiceOwnership()) process.exit(1);
    // A reader-only failed start can be retried without creating a second scheduler.
    globalThis.pagesServices = undefined;

    throw error;
  });

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
  globalThis.pagesServices = withBackgroundDatabaseWork(
    "services_startup",
    () => initializeServices(database, databasePath),
  );

  return globalThis.pagesServices;
}
