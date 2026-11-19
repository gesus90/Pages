import path from "node:path";

import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { AgentCallService } from "@/backend/service/employee/call/AgentCallService";
import { ManagementService } from "@/backend/service/management/ManagementService";
import { SendmailInvitationDelivery } from "@/backend/service/management/SendmailInvitationDelivery";
import { StorageOperationRepository } from "@/backend/database/repositories/google/StorageOperationRepository";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { PagesEventOutboxReaderRepository } from "@/backend/database/repositories/events/PagesEventOutboxReaderRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { getPagesRuntime } from "@/backend/runtime/PagesRuntime";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import { AgentPlanTasks } from "@/backend/service/agents/AgentPlanTasks";
import { PagesEventRetention } from "@/backend/service/events/PagesEventRetention";
import { TaskGitHubPublisher } from "@/backend/service/task/TaskGitHubPublisher";
import { TaskHistoryRecorder } from "@/backend/service/task/TaskHistoryRecorder";

import { picaAcpSettings } from "./bridge-settings.server";
import { createChatServices } from "./chat-services.server";
import { createEmployeeServices } from "./employee-services.server";
import { createMcpServices } from "./mcp-services.server";
import { picaBrowserOptions } from "./pica-browser.server";
import { startWikiMaintenanceScheduler } from "./services-background.server";

import { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import { createPlanTodoProgress } from "./agent-plan-todo-progress.server";

import type { SessionService } from "@/backend/auth/SessionService";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import type { InstanceSettingsService } from "@/backend/service/InstanceSettingsService";
import type { UserService } from "@/backend/service/UserService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { WikiService } from "@/backend/service/WikiService";
import type { AgentPlanServices } from "./agent-plan-services.server";
import type { AgentApplicationServices } from "./agent-services.server";
import type { AutomationApplicationServices } from "./automation-services.server";
import type { ChatApplicationServices } from "./chat-services.server";
import type { EmployeeApplicationServices } from "./employee-services.server";
import type { McpApplicationServices } from "./mcp-services.server";
import type { ApplicationServices } from "./services.server";

/** What the workspace services are built from. */
interface McpWorkspaceContext {
  readonly browserAuthentication?: Pick<SessionService, "setAgentBrowsers">;
  readonly database: Database;
  readonly databasePath: string;
  readonly accounts: {
    readonly users: UserService;
    readonly administration: AdministrationService;
  };
  /** The agent services, with the plan service the agent tools and the chat use. */
  readonly agents: AgentApplicationServices &
    AgentPlanServices &
    AutomationApplicationServices;
  readonly wiki: WikiService;
  /** The instance settings the chat administration changes with the regular rules. */
  readonly instanceSettings: InstanceSettingsService;
  readonly projects: Pick<ProjectService, "findAll" | "getById">;
  /** The ticket services, whose GitHub synchronization and event publisher the workspace shares. */
  readonly tasks: Pick<
    ApplicationServices,
    | "gitHubSyncService"
    | "googleDriveFileService"
    | "repositoryReadService"
    | "storageAccessService"
    | "pagesEventPublisher"
    | "taskService"
    | "taskAttachmentService"
    | "taskTemplateService"
  >;
  readonly serverCache: ServerCache;
  /** The one password hasher of the application, shared with the account services. */
  readonly hasher: PasswordHasher;
  readonly tokenKey: Buffer;
}

/** The agent write services on the operation catalog of the chat. */
function createWorkspaceServices(
  context: McpWorkspaceContext,
  directory: string,
  management: () => ManagementService,
  agentEmployees: () => AgentEmployeeAdministration,
): McpApplicationServices {
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
  return createMcpServices(context.database, users, administration, {
    directory,
    management,
    agentEmployees,
    externalFiles: {
      files: context.tasks.googleDriveFileService,
      access: context.tasks.storageAccessService,
      repositories: context.tasks.repositoryReadService,
      receipts: new StorageOperationRepository(context.database),
    },
    wikiService: context.wiki,
    tickets: { cache: context.serverCache, publisher },
    agentWorkspaces: context.agents.agentWorkspaceService,
    pageAgents: context.agents.pageAgentService,
    plans: context.agents.agentPlanService,
    stepReports: new AgentPlanStepReportService(
      new AgentPlanStepReportRepository(context.database),
      new AgentPlanTasks(context.tasks.taskService, users),
      createPlanTodoProgress(context.database),
    ),
    planRecovery: context.agents.agentPlanRecoveryService,
    planSessions: context.agents.agentSessionService,
    instanceAdministration: {
      connections: context.agents.agentConnectionService,
      settings: context.instanceSettings,
    },
    events: context.tasks.pagesEventPublisher,
    automations: context.agents.automationService,
  });
}

/** A getter for a service that the start stores later; reading it earlier is a wiring error. */
function laterService<T>(read: () => T | undefined, message: string): () => T {
  return () => {
    const service = read();
    if (service === undefined) throw new Error(message);
    return service;
  };
}

/** Starts the hourly wiki, asset and outbox cleanup when this process owns none of it. */
function startWorkspaceMaintenance(
  context: McpWorkspaceContext,
  assets: ReturnType<typeof createWorkspaceServices>["agentAssetService"],
  deletions: ReturnType<typeof createEmployeeServices>["agentDeletionService"],
): void {
  if (isLocalSessionOwner() || isPagesRunsProcess()) return;
  startWikiMaintenanceScheduler(
    context.wiki,
    assets,
    new PagesEventRetention(
      new PagesEventOutboxReaderRepository(context.database),
    ),
    deletions,
  );
}

/** The management service of the instance, on the employee administration of the workspace. */
function createManagementService(
  context: McpWorkspaceContext,
  agentEmployees: AgentEmployeeAdministration,
): ManagementService {
  return new ManagementService({
    database: context.database,
    cache: context.serverCache,
    hasher: context.hasher,
    agents: agentEmployees,
    invitations: new SendmailInvitationDelivery(),
  });
}

/** The voice calls of the direct chat, on the employee sessions and the speech services. */
function createAgentCallService(
  context: McpWorkspaceContext,
  sessions: ReturnType<typeof createEmployeeServices>["agentEmployeeSessions"],
): AgentCallService {
  return new AgentCallService({
    sessions,
    recognition: context.agents.speechRecognitionService,
    speech: context.agents.agentSpeechService,
    messages: new ChatSessionRepository(context.database),
  });
}

/**
 * Builds the agent write services and the chat on the same operation catalog,
 * and shares the existing maintenance scheduler.
 */
export async function startMcpWorkspace(context: McpWorkspaceContext): Promise<
  McpApplicationServices &
    ChatApplicationServices &
    EmployeeApplicationServices & {
      readonly managementService: ManagementService;
      readonly agentCallService: AgentCallService;
    }
> {
  const directory = path.dirname(context.databasePath);
  // The management service needs the employee services, which need the agent
  // services built here, so the agent services reach it through this slot.
  const managementSlot: {
    service?: ManagementService;
    agentEmployees?: AgentEmployeeAdministration;
  } = {};
  const services = createWorkspaceServices(
    context,
    directory,
    laterService(
      () => managementSlot.service,
      "Management services are not initialized",
    ),
    laterService(
      () => managementSlot.agentEmployees,
      "Agent administration is not initialized",
    ),
  );
  const runtime = await getPagesRuntime();
  const picaSettings = await picaAcpSettings();
  const chat = createChatServices({
    database: context.database,
    directory,
    accounts: context.accounts,
    agents: context.agents,
    router: services.chatOperationRouter,
    tickets: {
      tasks: context.tasks.taskService,
      templates: context.tasks.taskTemplateService,
      attachments: context.tasks.taskAttachmentService,
      projects: context.projects,
      users: context.accounts.users,
    },
    acp: picaSettings,
    protectedOrigin: runtime.getConfig().publicUrl,
    storage: context.tasks.googleDriveFileService,
    repositoryReads: context.tasks.repositoryReadService,
    picaBrowser: picaBrowserOptions({
      directory,
      instanceKey: context.tokenKey,
      config: () => runtime.getConfig(),
    }),
  });
  context.browserAuthentication?.setAgentBrowsers(chat.agentBrowserSessions);
  const employees = createEmployeeServices({
    automations: context.agents.automationService,
    database: context.database,
    cache: context.serverCache,
    acp: chat.picaAcpService,
    chatAttachments: chat.chatAttachmentService,
    pool: chat.picaAcpSessionPool,
    workspaceRoot: picaSettings.workspaceRoot,
    cipher: new InstanceSecretCipher(context.tokenKey),
    observer: context.agents,
    hostFiles: {
      tickets: context.tasks.taskAttachmentService,
      ticketKeys: context.tasks.taskService,
      wiki: context.wiki,
    },
    knowledge: { tickets: context.tasks.taskService, wiki: context.wiki },
    // The shell of the toolkit never sees the data folder.
    toolkitHiddenDirectories: [directory],
    conversations: {
      directory,
      events: context.tasks.pagesEventPublisher,
      speech: runtime.getConfig().speechRecognition,
      chatCalls: runtime.getConfig().chatCalls,
      publicUrl: runtime.getConfig().publicUrl,
      chatPlayerOrigin: runtime.getConfig().chatPlayerOrigin,
    },
  });
  const managementService = createManagementService(
    context,
    employees.agentEmployeeAdministration,
  );
  managementSlot.service = managementService;
  managementSlot.agentEmployees = employees.agentEmployeeAdministration;
  chat.picaAcpService?.setAgentDeletions(employees.agentDeletionService);
  startWorkspaceMaintenance(
    context,
    services.agentAssetService,
    employees.agentDeletionService,
  );
  return {
    ...services,
    managementService,
    ...chat,
    ...employees,
    agentCallService: createAgentCallService(
      context,
      employees.agentEmployeeSessions,
    ),
  };
}
