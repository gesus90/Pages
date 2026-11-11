import path from "node:path";

import { AgentAssetDownloadService } from "@/backend/service/agents/AgentAssetDownloadService";
import { createAgentAssetReaders } from "@/backend/service/agents/AgentAssetReaders";
import { AgentTicketUploadService } from "@/backend/service/agents/AgentTicketUploadService";
import { TicketAssetAuditService } from "@/backend/service/task/TicketAssetAuditService";
import { AgentPlanTemplateService } from "@/backend/service/agents/AgentPlanTemplateService";
import { AgentPlanTemplateRepository } from "@/backend/database/repositories/agent/AgentPlanTemplateRepository";
import { AgentChatSessionOperationService } from "@/backend/service/agents/AgentChatSessionOperationService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { AgentAssetRepository } from "@/backend/database/repositories/agents/AgentAssetRepository";
import { AgentAssetService } from "@/backend/service/agents/AgentAssetService";
import { createAgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import { AgentUploadAuthorityService } from "@/backend/service/agents/AgentUploadAuthorityService";
import { AgentUploadTicketService } from "@/backend/service/agents/AgentUploadTicketService";
import { AgentWikiCommentService } from "@/backend/service/agents/AgentWikiCommentService";
import { AgentWikiCreateService } from "@/backend/service/agents/AgentWikiCreateService";
import { AgentWikiFieldService } from "@/backend/service/agents/AgentWikiFieldService";
import { AgentWriteOperationService } from "@/backend/service/agents/AgentWriteOperationService";
import { StructuredImportService } from "@/backend/service/agents/StructuredImportService";
import { WikiImportService } from "@/backend/service/agents/WikiImportService";
import { WikiImportUpdateService } from "@/backend/service/agents/WikiImportUpdateService";
import { ServerCache } from "@/backend/cache/ServerCache";
import { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AgentExtensionService } from "@/backend/service/agents/AgentExtensionService";
import { AgentAdministrationService } from "@/backend/service/agents/AgentAdministrationService";
import { AgentProjectDeletionService } from "@/backend/service/agents/AgentProjectDeletionService";
import { ChatInstanceAdministrationService } from "@/backend/service/agents/ChatInstanceAdministrationService";
import { ProjectDeletionStorage } from "@/backend/service/project/ProjectDeletionStorage";
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { AgentWorkspaceOperationService } from "@/backend/service/agents/AgentWorkspaceOperationService";
import { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";
import { ChatAgentOperationService } from "@/backend/service/agents/ChatAgentOperationService";
import { PageAgentOperationService } from "@/backend/service/agents/PageAgentOperationService";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { AgentPlanWorkGate } from "@/backend/service/agents/AgentPlanWorkGate";
import { AgentPlanStepProgressService } from "@/backend/service/agents/AgentPlanStepProgressService";
import { AgentPlanStepProgressRepository } from "@/backend/database/repositories/agent/AgentPlanStepProgressRepository";
import { AgentPlanStepReportRepository } from "@/backend/database/repositories/agent/AgentPlanStepReportRepository";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { agentConfirmationWord } from "@/backend/service/agents/AgentConfirmation";
import { AgentOperationKeyRepository } from "@/backend/database/repositories/agents/AgentOperationKeyRepository";
import { McpUserApi } from "@/backend/service/mcp/users/McpUserApi";
import { PasswordHasher } from "@/backend/auth/PasswordHasher";

import { runnerAssetUpload } from "./agent-asset-return.server";
import { createMcpDeviceServices } from "./mcp-device-services.server";

import { AutomationOperationService } from "@/backend/service/automation/AutomationOperationService";

import type { AutomationService } from "@/backend/service/automation/AutomationService";
import type { McpDeviceApplicationServices } from "./mcp-device-services.server";
import type { AgentPlanStepReportService } from "@/backend/service/agents/AgentPlanStepReportService";
import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { ChatInstanceAdministrationDependencies } from "@/backend/service/agents/ChatInstanceAdministrationService";
import type { AgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import type { AgentWikiCreateDependencies } from "@/backend/service/agents/AgentWikiCreateService";
import type { AgentWriteDependencies } from "@/backend/service/agents/AgentWriteOperationService";
import type { AgentTicketPublisher } from "@/backend/service/agents/AgentTicketAnnouncer";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { AgentPlanRecoveryService } from "@/backend/service/agents/recovery/AgentPlanRecoveryService";
import type { AgentSessionService } from "@/backend/service/agents/sessions/AgentSessionService";
import type { PageAgentService } from "@/backend/service/agents/PageAgentService";
import type { WikiService } from "@/backend/service/WikiService";
import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";
import type { McpPlanServices } from "@/backend/service/mcp/plan/McpPlanApi";

/** The operation services behind the agent API, the plan bridge and the chat. */
export interface McpApplicationServices extends McpDeviceApplicationServices {
  readonly agentAssetService: AgentAssetService;
  readonly agentTicketUploadService: AgentTicketUploadService;
  /** The same operation catalog for the chat agent: UI role mode, changes marked as AI actions. */
  readonly chatOperationRouter: AgentOperationRouter;
  readonly agentUploadTicketService: AgentUploadTicketService;
  readonly agentAssetDownloadService: AgentAssetDownloadService;
  readonly pagesEventPublisher: PagesEventPublisher;
  readonly pagesAgentApiService: PagesAgentApiService;
  /** The plan operations of the paired Pages MCP machines, on the `mcp` channel (PAGE-246). */
  readonly mcpPlanServices: () => McpPlanServices;
  /** The plan service of the paired Pages MCP machines, bound to the `mcp` channel (PAGE-246, PAGE-250). */
  readonly mcpPlanService: () => AgentPlanService;
  /** The saves of the wiki API of the paired Pages MCP machines by operation ID (PAGE-257). */
  readonly mcpWikiOperations: AgentOperationKeyRepository;
  /** The user management API of the paired Pages MCP machines (PAGE-280). */
  readonly mcpUserApi: McpUserApi;
}

/** What the operations of one agent channel share. */
interface OperationContext {
  readonly database: Database;
  readonly events: PagesEventPublisher;
  readonly cache: ServerCache;
  readonly channel: AgentChannel;
}

/** The page and comment operations; each call runs in one transaction on the shared connection. */
function createWikiOperations(
  context: OperationContext,
  planning: AgentPlanningServices,
): {
  fields: AgentWikiFieldService;
  comments: AgentWikiCommentService;
  extensions: AgentExtensionService;
} {
  const { database, events, cache, channel } = context;
  return {
    fields: new AgentWikiFieldService({ database, events, channel }),
    comments: new AgentWikiCommentService({ database, events, channel }),
    extensions: new AgentExtensionService({
      database,
      planning: planning.reads,
      announcer: planning.announcer,
      cache,
      channel,
    }),
  };
}

/** What the operation catalogs of both agent channels are built from. */
interface RouterContext extends Omit<OperationContext, "channel"> {
  readonly directory: string;
  readonly planRecovery?: AgentPlanRecoveryService;
  readonly planSessions?: AgentSessionService;
  readonly users: Pick<UserService, "getById">;
  /** The plan service of the plan page; the agent tools and the chat use it alike. */
  readonly plans: AgentPlanService;
  readonly publisher: AgentTicketPublisher | null;
  readonly writes: Omit<AgentWriteDependencies, "create">;
  readonly creation: AgentWikiCreateDependencies;
  /** The permanent project deletion; only the agent tools get it. */
  readonly projectDeletion: AgentProjectDeletionService;
  readonly chatSessions: AgentChatSessionOperationService;
  /** The connection and instance settings services of the chat administration. */
  readonly instanceAdministration?: Omit<
    ChatInstanceAdministrationDependencies,
    "database"
  >;
  /** The automations (PAGE-297); the agent tools and the chat use them alike. */
  readonly automations?: AutomationService;
}

/** The automation operations of one channel, when the automations are wired. */
function automationOperations(
  context: RouterContext,
  channel: "mcp" | "chat",
): { readonly automations?: AutomationOperationService } {
  if (!context.automations) return {};
  return {
    automations: new AutomationOperationService({
      automations: context.automations,
      channel,
    }),
  };
}

/**
 * Builds the operation catalog of the agent tools, including imports and uploads.
 *
 * @remarks
 * The workspace registry and the permanent deletion of projects belong to this
 * catalog; user-agent management and agent plans are also available to the
 * signed-in chat through the same Pages services.
 */
function createMcpOperationRouter(
  context: RouterContext,
  workspaces: AgentWorkspaceService,
  pageAgents: PageAgentService,
): AgentOperationRouter {
  const { creation } = context;
  const planning = createAgentPlanningServices(context);
  return new AgentOperationRouter({
    administration: new AgentAdministrationService(
      context.database,
      context.cache,
    ),
    projectDeletion: context.projectDeletion,
    chatSessions: context.chatSessions,
    workspaces: new AgentWorkspaceOperationService({
      database: context.database,
      workspaces: workspaces.forChannel("mcp"),
    }),
    pageAgents: new PageAgentOperationService({
      database: context.database,
      agents: pageAgents,
    }),
    plans: new AgentPlanOperationService({
      database: context.database,
      plans: context.plans,
      resources: {
        sessions: context.planSessions,
        recovery: context.planRecovery,
        plans: context.plans,
        templates: new AgentPlanTemplateService({
          plans: context.plans,
          templates: new AgentPlanTemplateRepository(context.database),
        }),
      },
    }),
    ...automationOperations(context, "mcp"),
    projects: new ProjectRepository(context.database),
    wiki: new WikiRepository(context.database),
    users: context.users,
    writes: new AgentWriteOperationService({
      ...context.writes,
      create: new AgentWikiCreateService(creation),
    }),
    imports: new WikiImportService(creation),
    importUpdates: new WikiImportUpdateService(creation),
    structured: new StructuredImportService({ creation, planning }),
    ...createWikiOperations({ ...context, channel: "mcp" }, planning),
    planning,
  });
}

/**
 * Builds the operation catalog for the chat agent (T6.12.5).
 *
 * @remarks
 * It shares every service and check with MCP but runs on the chat channel:
 * administrators keep the role mode of the interface, and changes are marked
 * as AI actions. Imports and uploads are not wired, so they do not exist for
 * the chat.
 */
function createChatOperationRouter(
  context: RouterContext,
  pageAgents: PageAgentService,
): AgentOperationRouter {
  const channel = "chat";
  const planning = createAgentPlanningServices({ ...context, channel });
  return new AgentOperationRouter({
    administration: new AgentAdministrationService(
      context.database,
      context.cache,
      channel,
    ),
    ...(context.instanceAdministration
      ? {
          instanceAdministration: new ChatInstanceAdministrationService({
            database: context.database,
            ...context.instanceAdministration,
          }),
        }
      : {}),
    pageAgents: new ChatAgentOperationService({
      database: context.database,
      agents: pageAgents,
    }),
    plans: new AgentPlanOperationService({
      database: context.database,
      plans: context.plans,
      resources: {
        sessions: context.planSessions,
        recovery: context.planRecovery,
        plans: context.plans,
        templates: new AgentPlanTemplateService({
          plans: context.plans,
          templates: new AgentPlanTemplateRepository(context.database),
        }),
      },
    }),
    ...automationOperations(context, channel),
    projects: new ProjectRepository(context.database),
    wiki: new WikiRepository(context.database),
    users: context.users,
    writes: new AgentWriteOperationService({
      ...context.writes,
      create: new AgentWikiCreateService({ ...context.creation, channel }),
    }),
    ...createWikiOperations({ ...context, channel }, planning),
    planning,
    channel,
  });
}

/**
 * Builds the plan operations of the paired Pages MCP machines (PAGE-246).
 *
 * @remarks
 * The same operation layer as the agent tools and Pica, over the plan
 * service of the plan page bound to the `mcp` channel; runs are no part of
 * the interface, so their sessions and recovery are not wired.
 */
function createMcpPlanServices(
  database: Database,
  channelPlans: AgentPlanService,
  identities: AgentIdentityService,
): McpPlanServices {
  return {
    operations: new AgentPlanOperationService({
      database,
      plans: channelPlans,
      resources: {
        plans: channelPlans,
        templates: new AgentPlanTemplateService({
          plans: channelPlans,
          templates: new AgentPlanTemplateRepository(database),
        }),
      },
    }),
    identities,
    confirmationWord: (userId) => agentConfirmationWord(database, userId),
  };
}

/**
 * Builds the plan service of the paired Pages MCP machines on their first request (PAGE-246, PAGE-250).
 *
 * @remarks
 * The plan service of the `mcp` channel is a second view of the shared plans;
 * a process that no paired machine calls never builds it. The plan API and
 * the plan notation API share this one view.
 */
function lazyMcpPlanService(plans: AgentPlanService): () => AgentPlanService {
  let channelPlans: AgentPlanService | null = null;
  return () => {
    channelPlans ??= plans.forChannel("mcp");
    return channelPlans;
  };
}

/** Builds the plan operations of the paired Pages MCP machines on their first request (PAGE-246). */
function lazyMcpPlanServices(
  database: Database,
  channelPlans: () => AgentPlanService,
  identities: AgentIdentityService,
): () => McpPlanServices {
  let services: McpPlanServices | null = null;
  return () => {
    services ??= createMcpPlanServices(database, channelPlans(), identities);
    return services;
  };
}

/** Shares the normal own-session service with the MCP-specific confirmation adapter. */
function createChatSessionOperations(input: {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
  readonly directory: string;
}): AgentChatSessionOperationService {
  const { database, users, directory } = input;
  return new AgentChatSessionOperationService({
    users,
    sessions: new ChatSessionService({
      sessions: new ChatSessionRepository(database),
      attachments: new ChatAttachmentRepository(database),
      languages: new UserSettingsRepository(database),
      files: new WikiFileStore(path.join(directory, "chat-attachments")),
    }),
  });
}

function createAssetServices(
  database: Database,
  workspace: {
    readonly directory: string;
    readonly wikiService: Pick<WikiService, "getSettings" | "openAttachment">;
  },
): {
  readonly staging: WikiFileStore;
  readonly agentAssetService: AgentAssetService;
  readonly agentTicketUploadService: AgentTicketUploadService;
} {
  const staging = new WikiFileStore(
    path.join(workspace.directory, "agent-assets"),
  );
  return {
    staging,
    agentAssetService: new AgentAssetService({
      repository: new AgentAssetRepository(database),
      files: staging,
      wiki: workspace.wikiService,
      referencedTicketUploads: () =>
        new TicketAssetAuditService(
          database,
          workspace.directory,
        ).referencedUploadIds(),
    }),
    agentTicketUploadService: new AgentTicketUploadService(
      database,
      workspace.directory,
      workspace.wikiService,
    ),
  };
}

function createBinaryAssetServices(input: {
  readonly database: Database;
  readonly users: Pick<UserService, "getById">;
  readonly identities: AgentIdentityService;
  readonly workspace: Parameters<typeof createAssetServices>[1];
  readonly stepReports: AgentPlanStepReportService | undefined;
}): ReturnType<typeof createAssetServices> & {
  readonly apiFor: (operations: AgentOperationRouter) => PagesAgentApiService;
  readonly runCredentials: AgentRunCredentialService;
  readonly agentUploadTicketService: AgentUploadTicketService;
  readonly agentAssetDownloadService: AgentAssetDownloadService;
} {
  const { database, users, identities, workspace, stepReports } = input;
  const runCredentials = new AgentRunCredentialService(
    new AgentRunCredentialRepository(database),
    identities,
  );
  const authority = new AgentUploadAuthorityService(runCredentials);
  const agentUploadTicketService = new AgentUploadTicketService((hash) =>
    authority.verify(hash),
  );
  const { staging, agentAssetService, agentTicketUploadService } =
    createAssetServices(database, workspace);
  const agentAssetDownloadService = new AgentAssetDownloadService({
    users,
    assets: createAgentAssetReaders({
      database,
      directory: workspace.directory,
      wiki: workspace.wikiService,
      assets: agentAssetService,
    }),
    verify: (hash) => authority.verify(hash),
  });
  return {
    apiFor: (operations) =>
      new PagesAgentApiService(
        new AgentProjectService(new ProjectRepository(database)),
        operations,
        {
          runs: runCredentials,
          workGate: new AgentPlanWorkGate(database, users),
          stepReports,
          stepProgress: new AgentPlanStepProgressService({
            reports: new AgentPlanStepReportRepository(database),
            progress: new AgentPlanStepProgressRepository(database),
          }),
          downloads: agentAssetDownloadService,
          upload: runnerAssetUpload(async () => ({
            agentUploadTicketService,
            agentTicketUploadService,
            agentAssetService,
          })),
        },
      ),
    staging,
    agentAssetService,
    agentTicketUploadService,
    runCredentials,
    agentUploadTicketService,
    agentAssetDownloadService,
  };
}

/** Services and storage context shared by the personal MCP and chat routers. */
interface McpWorkspace {
  readonly directory: string;
  readonly wikiService: Pick<WikiService, "getSettings" | "openAttachment">;
  /** What reacts to a committed ticket change; without it nothing is published or invalidated. */
  readonly tickets?: {
    readonly cache: ServerCache;
    readonly publisher: AgentTicketPublisher | null;
  };
  /** The agent workspace registry; the agent tools manage workspaces through it. */
  readonly agentWorkspaces: AgentWorkspaceService;
  /** The user-agent management shared by the agent tools and the signed-in chat. */
  readonly pageAgents: PageAgentService;
  /** The agent plans shared by the agent tools and the signed-in chat. */
  readonly plans: AgentPlanService;
  /** Takes what a plan session reports through `report_step_result`. */
  readonly stepReports?: AgentPlanStepReportService;
  readonly planRecovery?: AgentPlanRecoveryService;
  readonly planSessions?: AgentSessionService;
  /** The connection and instance settings services the chat administration uses. */
  readonly instanceAdministration?: RouterContext["instanceAdministration"];
  /** The publisher the interface announces its changes on too; a new one by default. */
  readonly events?: PagesEventPublisher;
  /** The automations shared by the agent tools and the signed-in chat (PAGE-297). */
  readonly automations?: AutomationService;
}

/** Wires the API/services/repositories without opening another database or reading credential files. */
export function createMcpServices(
  database: Database,
  users: Pick<UserService, "getById">,
  administration: Pick<AdministrationService, "getContext">,
  workspace: McpWorkspace,
): McpApplicationServices {
  const identities = new AgentIdentityService(users, administration);
  const mcpPlanService = lazyMcpPlanService(workspace.plans);
  const {
    staging,
    agentAssetService,
    agentTicketUploadService,
    apiFor,
    agentUploadTicketService,
    agentAssetDownloadService,
  } = createBinaryAssetServices({
    database,
    users,
    identities,
    workspace,
    stepReports: workspace.stepReports,
  });
  const pagesEventPublisher =
    workspace.events ?? new PagesEventPublisher(database);
  const creation = {
    database,
    staging,
    wikiFiles: new WikiFileStore(
      path.join(workspace.directory, "wiki-attachments"),
    ),
    events: pagesEventPublisher,
  };
  const routers: RouterContext = {
    database,
    directory: workspace.directory,
    events: pagesEventPublisher,
    cache: workspace.tickets?.cache ?? ServerCache.disabled(),
    users,
    plans: workspace.plans,
    planRecovery: workspace.planRecovery,
    planSessions: workspace.planSessions,
    instanceAdministration: workspace.instanceAdministration,
    automations: workspace.automations,
    publisher: workspace.tickets?.publisher ?? null,
    chatSessions: createChatSessionOperations({
      database,
      users,
      directory: workspace.directory,
    }),
    projectDeletion: new AgentProjectDeletionService({
      cache: workspace.tickets?.cache ?? ServerCache.disabled(),
      database,
      effects: new ProjectDeletionStorage(workspace.plans, workspace.directory),
    }),
    writes: {
      users,
      tickets: agentUploadTicketService,
      assets: agentAssetService,
      ticketUploads: agentTicketUploadService,
      wiki: workspace.wikiService,
    },
    creation,
  };
  const devices = createMcpDeviceServices(database);
  return {
    ...devices,
    agentAssetService,
    agentTicketUploadService,
    chatOperationRouter: createChatOperationRouter(
      routers,
      workspace.pageAgents,
    ),
    agentUploadTicketService,
    agentAssetDownloadService,
    pagesEventPublisher,
    pagesAgentApiService: apiFor(
      createMcpOperationRouter(
        routers,
        workspace.agentWorkspaces,
        workspace.pageAgents,
      ),
    ),
    mcpPlanServices: lazyMcpPlanServices(database, mcpPlanService, identities),
    mcpPlanService,
    mcpWikiOperations: new AgentOperationKeyRepository(database),
    mcpUserApi: new McpUserApi({
      database,
      cache: workspace.tickets?.cache ?? ServerCache.disabled(),
      hasher: new PasswordHasher(),
      devices: devices.mcpDeviceService,
    }),
  };
}
