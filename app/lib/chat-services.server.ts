import path from "node:path";

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
import { PicaApiService } from "@/backend/service/chat/PicaApiService";
import { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { PicaBridge } from "@/backend/service/chat/acp/PicaBridge";
import { ChatError } from "@/backend/error/ChatErrors";
import { isApiProvider } from "@/definition/AgentConnection";
import { readPicaInstructions } from "@/backend/service/chat/PicaInstructionFiles";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { isSafeSvg } from "./settings-actions/svg-safety.server";

import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import type { AgentProfileService } from "@/backend/service/agents/AgentProfileService";
import type { PicaApiModels } from "@/backend/agents/providers/PicaApiModels";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { ExecutionAuthorizer } from "@/backend/agents/ScopedExecution";
import type {
  ChatContextUsage,
  ChatSessionActivity,
} from "@/definition/ChatJob";

/** The global chat agent Pica: sessions, attachments, settings and turns (A11.4). */
export interface ChatApplicationServices {
  readonly chatService: ChatService;
  readonly chatContextService: ChatContextService;
  readonly chatSessionService: ChatSessionService;
  readonly chatAttachmentService: ChatAttachmentService;
  readonly chatSettingsService: ChatSettingsService;
  /** Pica's server-side jobs over Codex ACP and their journal (PAGE-68); `null` without the Codex path. */
  readonly picaAcpService: PicaAcpService | null;
  /** The MCP endpoint through which Codex reaches Pica's tools; `null` without the Codex path. */
  readonly picaBridge: PicaBridge | null;
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
  readonly requests: AssistantRequestRegistry;
  readonly sessions: ChatSessionService;
  readonly messages: ChatSessionRepository;
  readonly attachments: ChatAttachmentService;
  readonly answerFiles: ChatAnswerFileService;
  readonly tools: ChatToolExecutor;
}

/** Builds the Codex path on the existing scheduler, executor, registry and repositories. */
function createPicaAcp(
  parts: PicaAcpParts,
): Pick<ChatApplicationServices, "picaAcpService" | "picaBridge"> {
  const { settings, plans, access } = parts;
  if (!settings || !plans || !access)
    return { picaAcpService: null, picaBridge: null };
  const picaBridge = new PicaBridge(settings.bridgeUrl);
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
    access,
    sessions: parts.sessions,
    requests: parts.requests,
    workspace: new PicaAcpWorkspace(settings.workspaceRoot),
  });
  parts.sessions.setDeletionEffects({
    before: (userId, sessionId) => picaAcpService.forget(userId, sessionId),
    after: (sessionId) => picaAcpService.cleanup(sessionId),
  });
  return { picaAcpService, picaBridge };
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
  };
}

/** What the chat is wired from. */
export interface ChatServicesInput {
  readonly database: Database;
  /** Directory next to the database; attachments live in its `chat-attachments`. */
  readonly directory: string;
  readonly accounts: {
    readonly users: Pick<UserService, "getById">;
    readonly administration: Pick<AdministrationService, "getContext">;
  };
  readonly agents: {
    readonly agentProfileService: Pick<AgentProfileService, "resolve">;
    readonly agentChatExecution: TextExecution;
    readonly picaApiModels: PicaApiModels;
    readonly chatRequests: AssistantRequestRegistry;
    /** With the two below and `acp`, Codex CLI agents answer over ACP; without, only API agents. */
    readonly agentPlanExecution?: PlanExecution;
    readonly agentConnectionAccess?: ExecutionAuthorizer;
  };
  readonly router: AgentOperationRouter;
  readonly acp?: PicaAcpSettings;
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
  const { activity, adapterContext } = createChatActivity(database);
  const chatSessionService = new ChatSessionService({
    sessions,
    attachments,
    settings: chatSettingsService,
    languages,
    files,
    activity,
  });
  const fileParts = {
    attachments,
    settings: chatSettingsService,
    files,
    isSafeSvg,
  };
  const chatAttachmentService = new ChatAttachmentService({
    sessions,
    ...fileParts,
  });
  const answerFiles = new ChatAnswerFileService(fileParts);
  const steers = new ChatSteerRepository(database);
  const chatContextService = new ChatContextService({
    sessions: chatSessionService,
    messages: sessions,
    contexts: new ChatContextRepository(database),
    agents: input.agents.agentProfileService,
    catalogs: new AgentConnectionRepository(database).catalogs(),
    execution: {
      run: (request, signal) => {
        if (!isApiProvider(request.agent.connection.provider))
          throw new ChatError("apiModeRequired");
        return input.agents.agentChatExecution.run(request, signal);
      },
    },
    requests: input.agents.chatRequests,
    adapterContext,
  });
  const tools = new ChatToolExecutor({
    router: input.router,
    identities: new AgentIdentityService(
      input.accounts.users,
      input.accounts.administration,
    ),
  });
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
  });
  return {
    ...acp,
    chatContextService,
    chatSessionService,
    chatAttachmentService,
    chatSettingsService,
    chatService: new ChatService({
      mode: "native-api",
      api: new PicaApiService({
        models: input.agents.picaApiModels,
        sessions: chatSessionService,
        tools,
        answerFiles,
      }),
      ...(acp.picaAcpService ? { acp: acp.picaAcpService } : {}),
      sessions: chatSessionService,
      context: chatContextService,
      messages: sessions,
      attachments: chatAttachmentService,
      answerFiles,
      selections: (sessionId, selection) => steers.select(sessionId, selection),
      settings: chatSettingsService,
      protectedInstructions: readPicaInstructions,
      agents: input.agents.agentProfileService,
      requests: input.agents.chatRequests,
      languages,
    }),
  };
}
