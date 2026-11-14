import path from "node:path";

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

import type { PasswordHasher } from "@/backend/auth/PasswordHasher";
import type { SessionService } from "@/backend/auth/SessionService";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
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

/**
 * Builds the agent write services and the chat on the same operation catalog,
 * and shares the existing maintenance scheduler.
 */
export async function startMcpWorkspace(context: McpWorkspaceContext): Promise<
  McpApplicationServices &
    ChatApplicationServices &
    EmployeeApplicationServices & {
      readonly managementService: ManagementService;
    }
> {
  const directory = path.dirname(context.databasePath);
  // The management service needs the employee services, which need the agent
  // services built here, so the agent services reach it through this slot.
  const managementSlot: { service?: ManagementService } = {};
  const services = createWorkspaceServices(context, directory, () => {
    if (!managementSlot.service)
      throw new Error("Management services are not initialized");
    return managementSlot.service;
  });
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
    pool: chat.picaAcpSessionPool,
    workspaceRoot: picaSettings.workspaceRoot,
    observer: context.agents,
    hostFiles: {
      tickets: context.tasks.taskAttachmentService,
      ticketKeys: context.tasks.taskService,
      wiki: context.wiki,
    },
    knowledge: { tickets: context.tasks.taskService, wiki: context.wiki },
    conversations: {
      directory,
      events: context.tasks.pagesEventPublisher,
      speech: runtime.getConfig().speechRecognition,
      publicUrl: runtime.getConfig().publicUrl,
    },
  });
  const managementService = new ManagementService({
    database: context.database,
    cache: context.serverCache,
    hasher: context.hasher,
    agents: employees.agentEmployeeAdministration,
    invitations: new SendmailInvitationDelivery(),
  });
  managementSlot.service = managementService;
  chat.picaAcpService?.setAgentDeletions(employees.agentDeletionService);
  if (!isLocalSessionOwner() && !isPagesRunsProcess())
    startWikiMaintenanceScheduler(
      context.wiki,
      services.agentAssetService,
      new PagesEventRetention(
        new PagesEventOutboxReaderRepository(context.database),
      ),
      employees.agentDeletionService,
    );
  return {
    ...services,
    managementService,
    ...chat,
    ...employees,
  };
}
