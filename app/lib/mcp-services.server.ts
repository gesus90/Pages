import path from "node:path";

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
import { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import { AgentWorkspaceOperationService } from "@/backend/service/agents/AgentWorkspaceOperationService";
import { AgentPlanOperationService } from "@/backend/service/agents/AgentPlanOperationService";
import { ChatAgentOperationService } from "@/backend/service/agents/ChatAgentOperationService";
import { PageAgentOperationService } from "@/backend/service/agents/PageAgentOperationService";
import { AgentRunCredentialRepository } from "@/backend/database/repositories/mcp/AgentRunCredentialRepository";
import { PersonalAgentTokenRepository } from "@/backend/database/repositories/mcp/PersonalAgentTokenRepository";
import { PairingRepository } from "@/backend/database/repositories/mcp/PairingRepository";
import { PairingService } from "@/backend/service/mcp/PairingService";
import { PagesAgentApiService } from "@/backend/service/PagesAgentApiService";
import { ProjectRepository } from "@/backend/database/repositories/ProjectRepository";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { AgentProjectService } from "@/backend/service/mcp/AgentProjectService";
import { AgentRunCredentialService } from "@/backend/service/mcp/AgentRunCredentialService";
import { PersonalAgentTokenService } from "@/backend/service/mcp/PersonalAgentTokenService";

import type { AgentChannel } from "@/backend/auth/McpActorContext";
import type { AgentPlanningServices } from "@/backend/service/agents/AgentPlanningServices";
import type { AgentWikiCreateDependencies } from "@/backend/service/agents/AgentWikiCreateService";
import type { AgentWriteDependencies } from "@/backend/service/agents/AgentWriteOperationService";
import type { AgentTicketPublisher } from "@/backend/service/agents/AgentTicketAnnouncer";
import type { AgentWorkspaceService } from "@/backend/service/agents/AgentWorkspaceService";
import type { AgentPlanService } from "@/backend/service/agents/AgentPlanService";
import type { PageAgentService } from "@/backend/service/agents/PageAgentService";
import type { WikiService } from "@/backend/service/WikiService";
import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";

/** Personal authentication and operation services shared by stdio clients and Pages. */
export interface McpApplicationServices {
  readonly agentAssetService: AgentAssetService;
  /** The same operation catalog for the chat agent: UI role mode, changes marked as AI actions. */
  readonly chatOperationRouter: AgentOperationRouter;
  readonly agentUploadTicketService: AgentUploadTicketService;
  readonly pagesEventPublisher: PagesEventPublisher;
  readonly pagesAgentApiService: PagesAgentApiService;
  readonly personalAgentTokenService: PersonalAgentTokenService;
  readonly pairingService: PairingService;
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
  readonly users: Pick<UserService, "getById">;
  /** The plan service of the plan page; MCP clients and the chat use it alike. */
  readonly plans: AgentPlanService;
  readonly publisher: AgentTicketPublisher | null;
  readonly writes: Omit<AgentWriteDependencies, "create">;
  readonly creation: AgentWikiCreateDependencies;
}

/**
 * Builds the operation catalog of MCP clients, including imports and uploads.
 *
 * @remarks
 * The workspace registry belongs to this catalog; user-agent management and
 * agent plans are also available to the signed-in chat through the same Pages
 * services.
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
    }),
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
    pageAgents: new ChatAgentOperationService({
      database: context.database,
      agents: pageAgents,
    }),
    plans: new AgentPlanOperationService({
      database: context.database,
      plans: context.plans,
    }),
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

/** Shares the existing database and fresh identity checks between personal tokens and pairing. */
function createPersonalAuthorization(
  database: Database,
  identities: AgentIdentityService,
): Pick<
  McpApplicationServices,
  "personalAgentTokenService" | "pairingService"
> {
  return {
    personalAgentTokenService: new PersonalAgentTokenService(
      new PersonalAgentTokenRepository(database),
      identities,
    ),
    pairingService: new PairingService(
      new PairingRepository(database),
      identities,
    ),
  };
}

/** Wires the API/services/repositories without opening another database or reading credential files. */
export function createMcpServices(
  database: Database,
  users: Pick<UserService, "getById">,
  administration: Pick<AdministrationService, "getContext">,
  workspace: {
    readonly directory: string;
    readonly wikiService: Pick<WikiService, "getSettings" | "openAttachment">;
    /** What reacts to a committed ticket change; without it nothing is published or invalidated. */
    readonly tickets?: {
      readonly cache: ServerCache;
      readonly publisher: AgentTicketPublisher | null;
    };
    /** The agent workspace registry; MCP clients manage workspaces through it. */
    readonly agentWorkspaces: AgentWorkspaceService;
    /** The user-agent management shared by MCP clients and the signed-in chat. */
    readonly pageAgents: PageAgentService;
    /** The agent plans shared by MCP clients and the signed-in chat. */
    readonly plans: AgentPlanService;
    /** The publisher the interface announces its changes on too; a new one by default. */
    readonly events?: PagesEventPublisher;
  },
): McpApplicationServices {
  const identities = new AgentIdentityService(users, administration);
  const { personalAgentTokenService, pairingService } =
    createPersonalAuthorization(database, identities);
  const authority = new AgentUploadAuthorityService(personalAgentTokenService);
  const agentUploadTicketService = new AgentUploadTicketService((hash) =>
    authority.verify(hash),
  );
  const staging = new WikiFileStore(
    path.join(workspace.directory, "agent-assets"),
  );
  const pagesEventPublisher = workspace.events ?? new PagesEventPublisher();
  const agentAssetService = new AgentAssetService({
    repository: new AgentAssetRepository(database),
    files: staging,
    wiki: workspace.wikiService,
  });
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
    events: pagesEventPublisher,
    cache: workspace.tickets?.cache ?? ServerCache.disabled(),
    users,
    plans: workspace.plans,
    publisher: workspace.tickets?.publisher ?? null,
    writes: {
      users,
      tickets: agentUploadTicketService,
      assets: agentAssetService,
      wiki: workspace.wikiService,
    },
    creation,
  };
  return {
    agentAssetService,
    chatOperationRouter: createChatOperationRouter(
      routers,
      workspace.pageAgents,
    ),
    agentUploadTicketService,
    pagesEventPublisher,
    personalAgentTokenService,
    pairingService,
    pagesAgentApiService: new PagesAgentApiService(
      personalAgentTokenService,
      new AgentProjectService(new ProjectRepository(database)),
      createMcpOperationRouter(
        routers,
        workspace.agentWorkspaces,
        workspace.pageAgents,
      ),
      new AgentRunCredentialService(
        new AgentRunCredentialRepository(database),
        identities,
      ),
    ),
  };
}
