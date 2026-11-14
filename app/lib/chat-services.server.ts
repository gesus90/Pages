import path from "node:path";

import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";
import { WikiMaintenanceScheduler } from "@/backend/service/wiki/WikiMaintenanceScheduler";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";

import { AgentBrowserRuntimeFiles } from "@/backend/service/chat/browser/AgentBrowserRuntimeFiles";
import { AgentBrowserSessions } from "@/backend/service/chat/browser/AgentBrowserSessions";
import { AgentBrowserService } from "@/backend/service/chat/browser/AgentBrowserService";
import { AgentEmployeeRepository } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import { PicaAdminService } from "@/backend/service/chat/admin/PicaAdminService";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatContextRepository } from "@/backend/database/repositories/chat/ChatContextRepository";
import { ChatJobRepository } from "@/backend/database/repositories/chat/ChatJobRepository";
import { ChatSteerRepository } from "@/backend/database/repositories/chat/ChatSteerRepository";
import { ChatContextService } from "@/backend/service/chat/ChatContextService";
import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ChatAnswerFileService } from "@/backend/service/chat/ChatAnswerFileService";
import { ChatAttachmentService } from "@/backend/service/chat/ChatAttachmentService";
import { ChatService } from "@/backend/service/chat/ChatService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { ChatSettingsService } from "@/backend/service/chat/ChatSettingsService";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";
import { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";
import { AgentChatSessionRepository } from "@/backend/database/repositories/employee/AgentChatSessionRepository";
import { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import { ChatError } from "@/backend/error/ChatErrors";
import { readPicaInstructions } from "@/backend/service/chat/PicaInstructionFiles";
import { PicaIdentityService } from "@/backend/service/chat/PicaIdentityService";
import { PicaTicketLifecycleService } from "@/backend/service/chat/PicaTicketLifecycleService";
import { PicaCalendarToolService } from "@/backend/service/chat/PicaCalendarToolService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { isSafeSvg } from "./settings-actions/svg-safety.server";

import type { RepositoryReadService } from "@/backend/service/github/RepositoryReadService";
import type { CalendarService } from "@/backend/service/calendar/CalendarService";
import type { Database } from "@/backend/database/Database";
import type { PicaAdminServiceOptions } from "@/backend/service/chat/admin/PicaAdminService";
import type { PicaStorageFiles } from "@/backend/service/chat/admin/PicaStorageHandlers";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";
import type { McpTicketDependencies } from "@/backend/service/mcp/ticket/McpTicketContext";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { ChatRequestRegistry } from "@/backend/service/chat/ChatRequestRegistry";
import type { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type { AcpResourceScheduler } from "@/backend/service/agents/AcpResourceScheduler";
import type {
  ChatContextUsage,
  ChatJob,
  ChatSessionActivity,
} from "@/definition/ChatJob";

/** The global chat agent Pica: sessions, attachments, settings and turns (A11.4). */
export interface ChatApplicationServices {
  readonly picaAdminService: PicaAdminService;
  readonly agentBrowserSessions: AgentBrowserSessions;
  readonly chatService: ChatService;
  readonly chatContextService: ChatContextService;
  readonly chatSessionService: ChatSessionService;
  readonly chatAttachmentService: ChatAttachmentService;
  readonly chatSettingsService: ChatSettingsService;
  /** Pica's server-side jobs over Codex ACP and their journal (PAGE-68); `null` without the Codex path. */
  readonly picaAcpService: PicaAcpService | null;
  /** Pica's turn-bound tool endpoint; `null` without the ACP path. */
  readonly picaBridge: PicaBridge | null;
  /** The chat sessions agents keep between rounds (PAGE-335); `null` without the ACP path. */
  readonly picaAcpSessionPool: PicaAcpSessionPool | null;
}

/** Where the Codex path of Pica runs and how its agent processes reach the bridge. */
export interface PicaAcpSettings {
  /** The bridge endpoint for local agent processes. */
  readonly bridgeUrl: string;
  /** The folder of the per-conversation working directories, outside the instance folders. */
  readonly workspaceRoot: string;
}

/** The repositories and services the Codex path of Pica runs on; without the first three it is off. */
interface PicaAcpParts {
  readonly settings: PicaAcpSettings | undefined;
  readonly plans: PlanExecution | undefined;
  readonly access: ExecutionAuthorizer | undefined;
  readonly database: Database;
  readonly requests: ChatRequestRegistry;
  readonly sessions: ChatSessionService;
  readonly messages: ChatSessionRepository;
  readonly attachments: ChatAttachmentService;
  readonly answerFiles: ChatAnswerFileService;
  readonly tools: ChatToolExecutor;
  readonly adminTools: PicaAdminService;
  readonly agentBrowsers: AgentBrowserService;
  readonly pica?: PicaSettingsService;
  /** Lets a waiting start take the place of a resting chat session (PAGE-335). */
  readonly resources?: Pick<AcpResourceScheduler, "setIdleReclaimer">;
}

/** Builds the Codex path on the existing scheduler, executor, registry and repositories. */
function createPicaAcp(
  parts: PicaAcpParts,
): Pick<
  ChatApplicationServices,
  "picaAcpService" | "picaBridge" | "picaAcpSessionPool"
> {
  const { settings, plans, access } = parts;
  if (!settings || !plans || !access)
    return { picaAcpService: null, picaBridge: null, picaAcpSessionPool: null };
  const picaBridge = new PicaBridge(settings.bridgeUrl);
  const sessionSettings = new AgentSessionSettingsRepository(parts.database);
  const chatSessions = new AgentChatSessionRepository(parts.database);
  const picaAcpSessionPool = new PicaAcpSessionPool({
    // The agent's own idle time wins; without one the instance setting applies (PAGE-376).
    idleMinutes: async (agentId) =>
      (await chatSessions.settings(agentId))?.idleMinutes ??
      (await sessionSettings.read()).idleMinutes,
  });
  parts.resources?.setIdleReclaimer(() => picaAcpSessionPool.reclaimIdle());
  const picaAcpService = new PicaAcpService({
    plans,
    jobs: new ChatJobRepository(parts.database),
    steers: new ChatSteerRepository(parts.database),
    acpSessions: new ChatAcpSessionRepository(parts.database),
    messages: parts.messages,
    attachments: parts.attachments,
    answerFiles: parts.answerFiles,
    bridge: picaBridge,
    tools: parts.tools,
    adminTools: parts.adminTools,
    agentBrowsers: parts.agentBrowsers,
    access,
    sessions: parts.sessions,
    requests: parts.requests,
    workspace: new PicaAcpWorkspace(settings.workspaceRoot),
    admit: (work) => (parts.pica ? parts.pica.admit(work) : work()),
    requireCurrent: (userId, assignment) =>
      parts.pica?.requireCurrent(userId, assignment) ?? Promise.resolve(),
    pool: picaAcpSessionPool,
  });
  startWorkspaceMaintenance(picaAcpService);
  parts.sessions.setDeletionEffects({
    before: (userId, sessionId) => picaAcpService.forget(userId, sessionId),
    after: (sessionId) => picaAcpService.cleanup(sessionId),
  });
  return { picaAcpService, picaBridge, picaAcpSessionPool };
}

/** What the Codex path adds to the session view and the context indicator. */
function createChatActivity(database: Database): {
  readonly activity: (
    userId: string,
    sessionId: string,
  ) => Promise<ChatSessionActivity>;
  readonly adapterContext: (
    userId: string,
    sessionId: string,
  ) => Promise<ChatContextUsage | null>;
  readonly latestJob: (
    userId: string,
    sessionId: string,
  ) => Promise<ChatJob | null>;
} {
  const jobs = new ChatJobRepository(database);
  const steers = new ChatSteerRepository(database);
  return {
    activity: async (userId, sessionId) => {
      const [job, steered, selections] = await Promise.all([
        jobs.latest(userId, sessionId),
        steers.list(sessionId),
        steers.selections(sessionId),
      ]);
      return { job, steers: steered, selections };
    },
    adapterContext: async (userId, sessionId) =>
      (await jobs.latest(userId, sessionId))?.usage.context ?? null,
    latestJob: (userId, sessionId) => jobs.latest(userId, sessionId),
  };
}

/** What the chat is wired from. */
export interface ChatServicesInput {
  readonly protectedOrigin?: string;
  /** The operator browser of Pica (PAGE-181): local origins, saved sessions and an optional launcher. */
  readonly picaBrowser?: PicaAdminServiceOptions;
  /** The Storage interface of the instance Drive; Pica's Storage tools use it (PAGE-271). */
  readonly repositoryReads?: RepositoryReadService;
  /** Shared UI ticket services for Pica's archive and restore tools. */
  readonly tickets?: McpTicketDependencies;
  readonly storage?: PicaStorageFiles & {
    readonly forAccount?: (userId: string) => PicaStorageFiles;
  };
  readonly database: Database;
  /** Directory next to the database; attachments live in its `chat-attachments`. */
  readonly directory: string;
  readonly accounts: {
    readonly users: Pick<UserService, "getById">;
    readonly administration: Pick<AdministrationService, "getContext">;
  };
  readonly agents: {
    readonly picaSettingsService?: PicaSettingsService;
    readonly agentProfileService: Pick<AgentProfileService, "resolve">;
    readonly chatRequests: ChatRequestRegistry;
    /** Where a waiting start takes the place of a resting chat session (PAGE-335). */
    readonly acpResourceScheduler?: Pick<
      AcpResourceScheduler,
      "setIdleReclaimer"
    >;
    /** With the two below and `acp`, the native CLI agents answer over ACP. */
    readonly agentPlanExecution?: PlanExecution;
    readonly agentConnectionAccess?: ExecutionAuthorizer;
  };
  readonly router: AgentOperationRouter;
  readonly acp?: PicaAcpSettings;
}

/**
 * Resolves the calendar on demand: the application services start it after
 * the chat, so a static import or a constructor argument would come too early.
 */
async function resolveCalendarService(): Promise<CalendarService> {
  const { getApplicationServices } = await import("./services.server");
  return (await getApplicationServices()).calendarService;
}

/** Resolves the stored access of agent accounts, for read-only agents in the calendar. */
async function resolveAgentAccess(): Promise<{
  find(agentId: string): Promise<{ readonly access: string } | null>;
}> {
  const { getApplicationServices } = await import("./services.server");
  return (await getApplicationServices()).mcpAgentEmployees;
}

/** Runs Pica's operations as the current identity, with the shared ticket lifecycle and calendar. */
function createChatTools(input: ChatServicesInput): ChatToolExecutor {
  return new ChatToolExecutor({
    repositoryReads: input.repositoryReads,
    ...(input.tickets
      ? { ticketLifecycle: new PicaTicketLifecycleService(input.tickets) }
      : {}),
    calendar: new PicaCalendarToolService({
      users: input.accounts.users,
      calendar: resolveCalendarService,
      agentAccess: resolveAgentAccess,
    }),
    router: input.router,
    identities: new PicaIdentityService(
      input.accounts.users,
      input.accounts.administration,
    ),
  });
}

/** Wires the chat on the shared database; nothing runs until a person sends a message. */
export function createChatServices(
  input: ChatServicesInput,
): ChatApplicationServices {
  const { database } = input;
  const sessions = new ChatSessionRepository(database);
  const attachments = new ChatAttachmentRepository(database);
  const languages = new UserSettingsRepository(database);
  const files = new WikiFileStore(
    path.join(input.directory, "chat-attachments"),
  );
  const chatSettingsService = new ChatSettingsService(
    new ChatSettingsRepository(database),
    input.accounts.administration,
  );
  const { activity, adapterContext, latestJob } = createChatActivity(database);
  const chatSessionService = new ChatSessionService({
    sessions,
    attachments,
    languages,
    files,
    activity,
    latestJob,
    requireEnabled: () =>
      input.agents.picaSettingsService?.requireEnabled() ?? Promise.resolve(),
    admit: (work) =>
      input.agents.picaSettingsService
        ? input.agents.picaSettingsService.admit(work)
        : work(),
  });
  const fileParts = { attachments, files, isSafeSvg };
  const chatAttachmentService = new ChatAttachmentService({
    sessions,
    ...fileParts,
  });
  const answerFiles = new ChatAnswerFileService(fileParts);
  const chatContextService = createChatContext({
    input,
    sessions,
    chatSessionService,
    adapterContext,
  });
  const { adminTools, agentBrowsers, agentBrowserSessions } =
    createBrowserServices(input);
  const tools = createChatTools(input);
  const acp = createPicaAcp({
    settings: input.acp,
    plans: input.agents.agentPlanExecution,
    access: input.agents.agentConnectionAccess,
    database,
    requests: input.agents.chatRequests,
    sessions: chatSessionService,
    messages: sessions,
    attachments: chatAttachmentService,
    answerFiles,
    tools,
    pica: input.agents.picaSettingsService,
    adminTools,
    agentBrowsers,
    resources: input.agents.acpResourceScheduler,
  });
  configurePicaStop(input, acp);
  return {
    ...acp,
    picaAdminService: adminTools,
    agentBrowserSessions,
    chatContextService,
    chatSessionService,
    chatAttachmentService,
    chatSettingsService,
    chatService: new ChatService({
      mode: "acp",
      ...(acp.picaAcpService ? { acp: acp.picaAcpService } : {}),
      sessions: chatSessionService,
      context: chatContextService,
      messages: sessions,
      attachments: chatAttachmentService,
      answerFiles,
      settings: chatSettingsService,
      protectedInstructions: readPicaInstructions,
      agents: input.agents.agentProfileService,
      administrators: adminTools,
      requests: input.agents.chatRequests,
      languages,
    }),
  };
}

function createChatContext(parts: {
  readonly input: ChatServicesInput;
  readonly sessions: ChatSessionRepository;
  readonly chatSessionService: ChatSessionService;
  readonly adapterContext: ReturnType<
    typeof createChatActivity
  >["adapterContext"];
}): ChatContextService {
  const { input, sessions, chatSessionService, adapterContext } = parts;
  const database = input.database;
  return new ChatContextService({
    sessions: chatSessionService,
    messages: sessions,
    contexts: new ChatContextRepository(database),
    agents: input.agents.agentProfileService,
    catalogs: new AgentConnectionRepository(database).catalogs(),
    execution: {
      run: () => Promise.reject(new ChatError("nativeContextManaged")),
    },
    requests: input.agents.chatRequests,
    adapterContext,
  });
}

function configurePicaStop(
  input: ChatServicesInput,
  acp: Pick<ChatApplicationServices, "picaAcpService">,
): void {
  input.agents.picaSettingsService?.setStopHandler(async () => {
    await Promise.all([
      acp.picaAcpService?.stopAll(),
      input.agents.chatRequests.cancelAll(),
    ]);
  });
}

/** Builds the separate employee and administrator browser paths on the same configured origins. */
function createBrowserServices(input: ChatServicesInput): {
  readonly adminTools: PicaAdminService;
  readonly agentBrowsers: AgentBrowserService;
  readonly agentBrowserSessions: AgentBrowserSessions;
} {
  const origins =
    input.picaBrowser?.localOrigins ?? (() => ({ pages: [], services: [] }));
  const employees = new AgentEmployeeRepository(input.database);
  const agentBrowserSessions = new AgentBrowserSessions(
    {
      user: (id) => input.accounts.users.getById(id),
      employee: (id) => employees.find(id),
      origins: () => origins().pages,
    },
    new AgentBrowserRuntimeFiles(
      path.join(input.directory, "agent-browser-runtime"),
    ),
  );
  const agentBrowsers = new AgentBrowserService(agentBrowserSessions, {
    origins,
    ...(input.picaBrowser?.launchBrowser
      ? { launch: input.picaBrowser.launchBrowser }
      : {}),
  });
  const adminTools = new PicaAdminService(input.accounts, {
    ...input.picaBrowser,
    agentBrowsers,
    ...(input.storage ? { storage: input.storage } : {}),
  });
  if (input.protectedOrigin) adminTools.protectOrigin(input.protectedOrigin);
  return { adminTools, agentBrowsers, agentBrowserSessions };
}

/** Only the API owner runs Pica jobs and may sweep its process-local reservations. */
function startWorkspaceMaintenance(service: PicaAcpService): void {
  if (isLocalSessionOwner() || isPagesRunsProcess()) return;
  const maintenance = new WikiMaintenanceScheduler(
    { runMaintenance: () => service.runMaintenance() },
    60_000,
  );
  maintenance.start();
  registerShutdownTask(
    async () => {
      maintenance.stop();
    },
    { step: "pica_workspace_maintenance" },
  );
}
