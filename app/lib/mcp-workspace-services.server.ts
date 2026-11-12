import path from "node:path";

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

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { InstanceSettingsService } from "@/backend/service/InstanceSettingsService";
import type { UserService } from "@/backend/service/UserService";
import type { WikiService } from "@/backend/service/WikiService";
import type { AgentPlanServices } from "./agent-plan-services.server";
import type { AgentApplicationServices } from "./agent-services.server";
import type { AutomationApplicationServices } from "./automation-services.server";
import type { ChatApplicationServices } from "./chat-services.server";
import type { EmployeeApplicationServices } from "./employee-services.server";
import type { McpApplicationServices } from "./mcp-services.server";
import type { ApplicationServices } from "./services.server";

/**
 * Builds the agent write services and the chat on the same operation catalog,
 * and shares the existing maintenance scheduler.
 */
export async function startMcpWorkspace(context: {
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
  /** The ticket services, whose GitHub synchronization and event publisher the workspace shares. */
  readonly tasks: Pick<
    ApplicationServices,
    | "gitHubSyncService"
    | "googleDriveFileService"
    | "pagesEventPublisher"
    | "taskService"
    | "taskAttachmentService"
  >;
  readonly serverCache: ServerCache;
  readonly tokenKey: Buffer;
}): Promise<
  McpApplicationServices & ChatApplicationServices & EmployeeApplicationServices
> {
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
  if (!isLocalSessionOwner() && !isPagesRunsProcess())
    startWikiMaintenanceScheduler(
      context.wiki,
      services.agentAssetService,
      new PagesEventRetention(
        new PagesEventOutboxReaderRepository(context.database),
      ),
    );
  const runtime = await getPagesRuntime();
  const chat = createChatServices({
    database: context.database,
    directory,
    accounts: context.accounts,
    agents: context.agents,
    router: services.chatOperationRouter,
    acp: await picaAcpSettings(),
    protectedOrigin: runtime.getConfig().publicUrl,
    storage: context.tasks.googleDriveFileService,
    picaBrowser: picaBrowserOptions({
      directory,
      instanceKey: context.tokenKey,
      config: () => runtime.getConfig(),
    }),
  });
  return {
    ...services,
    ...chat,
    ...createEmployeeServices({
      automations: context.agents.automationService,
      database: context.database,
      cache: context.serverCache,
      acp: chat.picaAcpService,
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
    }),
  };
}
