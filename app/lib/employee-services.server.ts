import path from "node:path";

import { CliHostMcpServers } from "@/backend/agents/cli/CliHostMcpServers";
import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedAgentMemoryModel } from "@/backend/agents/simulation/SimulatedAgentMemoryModel";
import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationError } from "@/backend/error/ConversationError";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { createChatSessionId } from "@/backend/service/chat/ChatSessionWords";
import { AgentAccessEnvironmentService } from "@/backend/service/employee/AgentAccessEnvironmentService";
import { AgentChatPrivacyService } from "@/backend/service/employee/AgentChatPrivacyService";
import { AgentChatReader } from "@/backend/service/employee/AgentChatReader";
import { AgentChatSessionLifecycle } from "@/backend/service/employee/AgentChatSessionLifecycle";
import { AgentChatSessionService } from "@/backend/service/employee/AgentChatSessionService";
import { AgentChatToolGuard } from "@/backend/service/employee/AgentChatToolGuard";
import { AgentHostFiles } from "@/backend/service/employee/AgentHostFiles";
import { AgentLogbookAdministration } from "@/backend/service/employee/AgentLogbookAdministration";
import { AgentLogbookScheduler } from "@/backend/service/employee/AgentLogbookScheduler";
import { AgentLogbookService } from "@/backend/service/employee/AgentLogbookService";
import { AgentLogbookSummarizer } from "@/backend/service/employee/AgentLogbookSummarizer";
import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";
import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";
import { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
import { AgentProfileReadService } from "@/backend/service/employee/profile/AgentProfileReadService";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import { AgentLearningScheduler } from "@/backend/service/employee/AgentLearningScheduler";
import { AgentLearningService } from "@/backend/service/employee/AgentLearningService";
import { AgentSessionMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import { AgentMemoryRecorder } from "@/backend/service/employee/AgentMemoryRecorder";
import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";
import {
  AgentKnowledgeAccess,
  AgentMemorySharing,
} from "@/backend/service/employee/AgentMemorySharing";
import { AgentSessionLimitService } from "@/backend/service/employee/AgentSessionLimitService";
import { AgentSessionSlots } from "@/backend/service/employee/AgentSessionSlots";
import { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";
import { ChatGroupService } from "@/backend/service/employee/ChatGroupService";
import { PersonColorService } from "@/backend/service/employee/PersonColorService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { startAutomationAgentWorker } from "./automation-services.server";
import { createConversationServices } from "./conversation-services.server";
import { defaultAgentTemplateTexts } from "./agent-template-texts.server";

import { conversationModelRoot } from "@/backend/service/conversation/ConversationModelDirectory";

import type { AgentChatTools } from "@/definition/AgentChat";
import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AutomationService } from "@/backend/service/automation/AutomationService";
import type { AgentDeletionDependencies } from "@/backend/service/employee/AgentDeletionService";
import type { AgentLearningDependencies } from "@/backend/service/employee/AgentLearningService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentHostFileStores } from "@/backend/service/employee/AgentHostFiles";
import type { AgentMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import type { TaskService } from "@/backend/service/TaskService";
import type { WikiService } from "@/backend/service/WikiService";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";
import type { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import type { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { AgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import type {
  ConversationApplicationServices,
  ConversationObserverInput,
} from "./conversation-services.server";

/**
 * Agents as employees, the chat directory and person colors (PAGE-266), with
 * the stored conversations the chat page shows (PAGE-278).
 */
export interface EmployeeApplicationServices extends ConversationApplicationServices {
  readonly agentEmployeeAdministration: AgentEmployeeAdministration;
  readonly agentDeletionService: AgentDeletionService;
  /** The templates of `AGENT.md` (PAGE-283). */
  readonly agentTemplateService: AgentTemplateService;
  /** The readable profiles of agents for administrators and leaders (PAGE-308). */
  readonly agentProfileReadService: AgentProfileReadService;
  readonly agentEmployeeSessions: AgentEmployeeSessions;
  /** The chat sessions of agents: the popup "Agent-Einstellungen" and the head of a chat (PAGE-376). */
  readonly agentChatSessionService: AgentChatSessionService;
  /** The tab "Lagebuch" of that popup: entries, settings, removal (PAGE-377). */
  readonly agentLogbookAdministration: AgentLogbookAdministration;
  /** The limits of concurrent chat sessions of agents (PAGE-304). */
  readonly agentSessionLimitService: AgentSessionLimitService;
  readonly agentLearningService: AgentLearningService;
  /** Marks chats with agents confidential (PAGE-305). */
  readonly agentChatPrivacyService: AgentChatPrivacyService;
  readonly chatDirectoryService: ChatDirectoryService;
  readonly chatGroupService: ChatGroupService;
  readonly personColorService: PersonColorService;
}

/** What the employee services are built from. */
export interface EmployeeServicesInput {
  readonly database: Database;
  /** The automations whose agent work the agents' sessions deliver (PAGE-297). */
  readonly automations: AutomationService;
  readonly cache: ServerCache;
  /** Pica's ACP path, which agent sessions share; `null` without ACP chat. */
  readonly acp: PicaAcpService | null;
  /** The live processes of the chat sessions (PAGE-376); `null` without ACP chat. */
  readonly pool?: PicaAcpSessionPool | null;
  /** The ticket and wiki attachments the file tools of an agent with host tools use (PAGE-303). */
  readonly hostFiles?: AgentHostFileStores;
  /**
   * Who may see a ticket or a wiki page (PAGE-305); without it a chat with
   * further people gets no knowledge of other chats.
   */
  readonly knowledge?: {
    readonly tickets: Pick<TaskService, "getByKey">;
    readonly wiki: Pick<WikiService, "canView">;
  };
  /** The folder of the chat workspaces, whose files an agent deletion removes (PAGE-321). */
  readonly workspaceRoot: string;
  /** Where the stored conversations keep their audio and announce their changes (PAGE-278). */
  readonly conversations: {
    readonly directory: string;
    readonly events: PagesEventPublisher;
    /** The speech model and the longest recording of `config.toml` (PAGE-277). */
    readonly speech?: SpeechRecognitionSetting;
    /** The origin users reach Pages at; links to it embed (PAGE-298). */
    readonly publicUrl?: string;
  };
  /** Pica's model choice and the ACP path the group observer runs on (PAGE-296). */
  readonly observer: {
    readonly picaSettingsService: Pick<
      PicaSettingsService,
      "resolve" | "requireCurrent"
    >;
    readonly agentPlanExecution: PlanExecution | null;
    /** The decision model of the instance (PAGE-317). */
    readonly chatDecisionSettingsService: Pick<
      ChatDecisionSettingsService,
      "resolve"
    >;
  };
}

/**
 * Starts the nightly dream runs (PAGE-305) where a model can answer them, ACP
 * or the simulation, and the delivery of automation work to the agents, which
 * needs the ACP path of the agents' sessions.
 */
function startBackground(
  input: EmployeeServicesInput,
  parts: {
    readonly store: EmployeeStore;
    readonly learning: AgentLearningService;
    readonly sessions: AgentEmployeeSessions;
    readonly chatPoster: AgentChatService | null;
    readonly hasModel: boolean;
  },
): void {
  if (parts.hasModel)
    new AgentLearningScheduler(parts.store, parts.learning).start();
  if (!input.acp) return;
  startAutomationAgentWorker({
    database: input.database,
    automationService: input.automations,
    sessions: parts.sessions,
    ...(parts.chatPoster ? { chatPoster: parts.chatPoster } : {}),
  });
}

/** The learning service; its runs and the other background work start only in the process that owns it. */
function createLearning(
  input: EmployeeServicesInput,
  parts: {
    readonly dependencies: AgentLearningDependencies;
    readonly sessions: AgentEmployeeSessions;
    readonly chatPoster: AgentChatService | null;
    readonly isBackgroundOwner: boolean;
    readonly hasModel: boolean;
  },
): AgentLearningService {
  const learning = new AgentLearningService(parts.dependencies);
  if (parts.isBackgroundOwner)
    startBackground(input, {
      store: parts.dependencies.store,
      learning,
      sessions: parts.sessions,
      chatPoster: parts.chatPoster,
      hasModel: parts.hasModel,
    });
  return learning;
}

/** What the group observer and the decision model run on, simulated while the simulation is on. */
function groupObserverInput(
  input: Pick<EmployeeServicesInput, "observer" | "workspaceRoot">,
  simulation: AgentSimulationMode,
  isBackgroundOwner: boolean,
): ConversationObserverInput {
  const { observer } = input;
  return {
    pica: observer.picaSettingsService,
    plans: observer.agentPlanExecution,
    simulation: simulation.isActive
      ? new SimulatedConversationObserver(simulation)
      : null,
    decision: observer.chatDecisionSettingsService,
    decisionSimulation: simulation.isActive
      ? new SimulatedConversationDecision(simulation)
      : null,
    isBackgroundOwner,
    directoryRoot: conversationModelRoot(input.workspaceRoot),
  };
}

/**
 * The directory of the chat page with what runs and waits in each chat
 * (PAGE-303, PAGE-304).
 */
function createChatDirectory(parts: {
  readonly database: Database;
  readonly store: EmployeeStore;
  readonly users: UserRepository;
  readonly messages: ChatSessionRepository;
  readonly sessions: AgentEmployeeSessions;
  readonly agentSessions: AgentChatSessionService;
  readonly conversations: ConversationApplicationServices;
}): ChatDirectoryService {
  const { sessions, conversations } = parts;
  const replies = conversations.conversationAgentReplies;
  return new ChatDirectoryService({
    store: parts.store,
    users: parts.users,
    lookups: new WikiLookupRepository(parts.database),
    messages: parts.messages,
    conversations: conversations.conversationReader,
    isWorking: (agent, sessionId) => sessions.isWorking(agent, sessionId),
    toolCalls: (agent, sessionId) => sessions.toolCalls(agent, sessionId),
    workingAgentIds: (conversationId) =>
      replies.workingAgentIds(conversationId),
    oversight: conversations.conversationOversight,
    guard: conversations.conversationAgentGuard,
    queuedMessages: (conversationId) => replies.queuedMessages(conversationId),
    waitingInJob: (agent, sessionId) => sessions.waitingInJob(agent, sessionId),
    queuedAgentMessages: (agentId, personId) =>
      sessions.queuedMessages(agentId, personId),
    agentSessions: parts.agentSessions,
    queuedFor: (conversationId, agentId) =>
      replies.queuedFor(conversationId, agentId),
  });
}

/**
 * The memory of agents (PAGE-305): the rules of sharing, the memory with
 * its archive, the model calls, the recorder that updates `MEMORY.md`
 * after each answer and the confidential mark of chats.
 *
 * @remarks
 * The model calls run in the agent's own sessions, which are built after
 * the memory; `sessions` hands them over once they exist. The simulation
 * answers them without a model provider.
 */
function createMemoryParts(parts: {
  readonly store: EmployeeStore;
  readonly users: UserRepository;
  readonly messages: ChatSessionRepository;
  readonly knowledge: EmployeeServicesInput["knowledge"];
  readonly isSimulated: boolean;
  readonly sessions: () => AgentEmployeeSessions;
}): {
  readonly memory: AgentMemoryService;
  readonly memoryModel: AgentMemoryModel;
  readonly recorder: AgentMemoryRecorder;
  readonly privacy: AgentChatPrivacyService;
} {
  const { store, users, messages, knowledge } = parts;
  const sharing = new AgentMemorySharing({
    store,
    ...(knowledge
      ? {
          visibility: new AgentKnowledgeAccess({
            users,
            tickets: knowledge.tickets,
            wiki: knowledge.wiki,
          }),
        }
      : {}),
  });
  const memory = new AgentMemoryService(store, sharing);
  const memoryModel: AgentMemoryModel = parts.isSimulated
    ? new SimulatedAgentMemoryModel()
    : new AgentSessionMemoryModel({
        sessions: {
          run: (request) => parts.sessions().run(request),
          job: (agent, sessionId, jobId) =>
            parts.sessions().job(agent, sessionId, jobId),
          whenOutOfChats: (agentId) => parts.sessions().whenOutOfChats(agentId),
        },
        messages,
      });
  return {
    memory,
    memoryModel,
    recorder: new AgentMemoryRecorder({
      store,
      messages,
      memory,
      model: memoryModel,
    }),
    privacy: new AgentChatPrivacyService({
      store,
      users,
      createSessionId: () => createChatSessionId(),
    }),
  };
}

/** The simulated agent of conversations; `null` outside the simulation. */
function simulatedAgent(
  simulation: ReturnType<typeof currentAgentSimulationMode>,
): SimulatedConversationAgent | null {
  return simulation.isActive
    ? new SimulatedConversationAgent(simulation)
    : null;
}

function createDeletionFiles(
  input: EmployeeServicesInput,
): NonNullable<AgentDeletionDependencies["files"]> {
  const directory = input.conversations.directory;
  const workspace = new PicaAcpWorkspace(input.workspaceRoot);
  const chatFiles = new WikiFileStore(path.join(directory, "chat-attachments"));
  const planFiles = new WikiFileStore(path.join(directory, "plan-assets"));
  const voiceFiles = new WikiFileStore(
    path.join(directory, "conversation-voice"),
  );
  return {
    remove: async (kind, name) => {
      if (kind === "session") return workspace.remove(name);
      if (kind === "chat") return chatFiles.remove([name]);
      if (kind === "plan") return planFiles.remove([name]);
      return voiceFiles.remove([name]);
    },
  };
}

function createDeletionService(
  input: EmployeeServicesInput,
  authorization: AuthorizationRepository,
): AgentDeletionService {
  return new AgentDeletionService({
    authorization,
    cache: input.cache,
    files: createDeletionFiles(input),
  });
}

/**
 * The gates of the sessions of agents: the host access, read anew so that
 * bubblewrap and the MCP configuration of the CLIs change without a restart
 * (PAGE-303), and one place per running chat session of an agent within the
 * stored limits (PAGE-304).
 */
function createSessionGates(database: Database): {
  readonly accessEnvironment: AgentAccessEnvironmentService;
  readonly sessionSettings: AgentSessionSettingsRepository;
  readonly slots: AgentSessionSlots;
} {
  const sessionSettings = new AgentSessionSettingsRepository(database);
  return {
    accessEnvironment: new AgentAccessEnvironmentService({
      isIsolationAvailable: () => probeBubblewrap(),
      mcp: new CliHostMcpServers(),
    }),
    sessionSettings,
    slots: new AgentSessionSlots(() => sessionSettings.read()),
  };
}

/** What the services of the employee area are assembled from once the sessions and conversations are wired. */
interface EmployeeParts {
  readonly input: EmployeeServicesInput;
  readonly store: EmployeeStore;
  readonly authorization: AuthorizationRepository;
  readonly users: UserRepository;
  readonly messages: ChatSessionRepository;
  readonly models: AgentEmployeeModels;
  readonly languages: UserSettingsRepository;
  readonly memory: AgentMemoryService;
  readonly activity: AgentActivityService;
  readonly accessEnvironment: AgentAccessEnvironmentService;
  readonly sessionSettings: AgentSessionSettingsRepository;
  readonly slots: AgentSessionSlots;
  readonly sessions: AgentEmployeeSessions;
  readonly agentSessions: AgentChatSessionService;
  readonly logbook: AgentLogbookService;
  readonly conversations: ConversationApplicationServices;
  readonly learning: AgentLearningService;
  readonly privacy: AgentChatPrivacyService;
}

/** The tab "Lagebuch": what a viewer sees of the Lagebuch of an agent and what they change. */
function createLogbookAdministration(
  parts: Pick<
    EmployeeParts,
    "input" | "store" | "users" | "models" | "sessionSettings" | "logbook"
  >,
): AgentLogbookAdministration {
  const { input } = parts;
  return new AgentLogbookAdministration({
    store: parts.store,
    users: parts.users,
    logbook: parts.logbook,
    isMember: async (conversationId, userId) =>
      (await new ConversationRepository(input.database).findForMember(
        conversationId,
        userId,
      )) !== null,
    models: (userId) => parts.models.models(userId),
    instanceModel: () => parts.sessionSettings.logbookModel(),
  });
}

function assembleEmployeeServices(
  parts: EmployeeParts,
): EmployeeApplicationServices {
  const { input, store, authorization, models, languages, sessions } = parts;
  return {
    ...parts.conversations,
    agentEmployeeAdministration: new AgentEmployeeAdministration({
      authorization,
      cache: input.cache,
      models,
      memory: parts.memory,
      activity: parts.activity,
      accessEnvironment: parts.accessEnvironment,
    }),
    agentDeletionService: createDeletionService(input, authorization),
    agentTemplateService: new AgentTemplateService({
      store,
      authorization,
      languages,
      defaults: defaultAgentTemplateTexts,
    }),
    agentProfileReadService: new AgentProfileReadService({
      database: input.database,
      models,
    }),
    agentEmployeeSessions: sessions,
    agentChatSessionService: parts.agentSessions,
    agentLogbookAdministration: createLogbookAdministration(parts),
    agentSessionLimitService: new AgentSessionLimitService(
      parts.sessionSettings,
      parts.slots,
      (userId) => models.models(userId),
    ),
    agentLearningService: parts.learning,
    agentChatPrivacyService: parts.privacy,
    chatDirectoryService: createChatDirectory({
      database: input.database,
      store,
      users: parts.users,
      messages: parts.messages,
      sessions,
      agentSessions: parts.agentSessions,
      conversations: parts.conversations,
    }),
    chatGroupService: new ChatGroupService({ store }),
    personColorService: new PersonColorService(authorization, input.cache),
  };
}

/**
 * Wires agents, their sessions and learning runs, the chat directory and
 * person colors on the shared database; the learning scheduler runs only in
 * the process that serves the chat.
 */
export function createEmployeeServices(
  input: EmployeeServicesInput,
): EmployeeApplicationServices {
  const { database } = input;
  const store = new EmployeeStore(database);
  const authorization = new AuthorizationRepository(database);
  const users = new UserRepository(database);
  const messages = new ChatSessionRepository(database);
  const models = new AgentEmployeeModels({
    connections: new AgentConnectionRepository(database),
    authorization,
    groups: new UserGroupRepository(database),
  });
  const languages = new UserSettingsRepository(database);
  const simulation = currentAgentSimulationMode();
  const { memory, memoryModel, recorder, privacy } = createMemoryParts({
    store,
    users,
    messages,
    knowledge: input.knowledge,
    isSimulated: simulation.isActive,
    sessions: () => sessions,
  });
  // The conversations are wired after the sessions, which need their chat tools.
  let agentChat: AgentChatTools | null = null;
  const activity = new AgentActivityService(store);
  // The reader exists once the conversations are wired below.
  let contextReader: ConversationContextReader | null = null;
  const { accessEnvironment, sessionSettings, slots } =
    createSessionGates(database);
  const chatReader = new AgentChatReader({
    messages,
    conversationMessages: new ConversationMessageRepository(database),
    directory: new ConversationDirectory({
      users,
      lookups: new WikiLookupRepository(database),
      jobTitles: () => store.identities().jobTitles(),
    }),
  });
  // The Lagebuch is wired once the dream service exists, which it asks for the compaction.
  let logbook: AgentLogbookService | null = null;
  const lifecycle = new AgentChatSessionLifecycle({
    store,
    messages,
    acp: input.acp,
    pool: input.pool ?? null,
    acpSessions: new ChatAcpSessionRepository(database),
    summaries: () => memoryModel,
  });
  const sessions = new AgentEmployeeSessions({
    store,
    users,
    authorization,
    messages,
    languages,
    models,
    memory,
    acp: input.acp,
    slots,
    accessEnvironment,
    ...(input.hostFiles
      ? { hostFiles: new AgentHostFiles(input.hostFiles) }
      : {}),
    recorder,
    agentChat: () => agentChat,
    createSessionId: () => createChatSessionId(),
    conversationContext: {
      readForAgent: (agentId, request) =>
        contextReader
          ? contextReader.readForAgent(agentId, request)
          : Promise.reject(new ConversationError("not_found")),
    },
    lifecycle: () => lifecycle,
    chatReader,
    toolGuard: new AgentChatToolGuard({ store }),
    logbook: () => logbook,
  });
  const isBackgroundOwner = !isLocalSessionOwner() && !isPagesRunsProcess();
  const conversations = createConversationServices({
    database,
    ...input.conversations,
    observer: groupObserverInput(input, simulation, isBackgroundOwner),
    runner: new AgentConversationAnswers({
      store,
      users,
      sessions,
      messages,
      simulation: simulatedAgent(simulation),
      recorder,
    }),
  });
  contextReader = conversations.conversationContextReader;
  agentChat = conversations.agentChatService;
  const learning = createLearning(input, {
    dependencies: { store, users, memory, model: memoryModel, activity },
    sessions,
    chatPoster: conversations.agentChatService,
    isBackgroundOwner,
    hasModel: input.acp !== null || simulation.isActive,
  });
  const hasModel = input.acp !== null || simulation.isActive;
  const logbookService = new AgentLogbookService({
    store,
    compaction: hasModel ? (agentId) => learning.run(agentId) : null,
  });
  logbook = logbookService;
  if (isBackgroundOwner && hasModel)
    new AgentLogbookScheduler({
      store,
      summarizer: new AgentLogbookSummarizer({
        store,
        users,
        reader: chatReader,
        model: () => memoryModel,
        logbook: logbookService,
        instanceModel: () => sessionSettings.logbookModel(),
      }),
      isWorking: (agentId) => sessions.isWorkingInChat(agentId),
    }).start();
  const agentSessions = new AgentChatSessionService({
    store,
    users,
    lifecycle,
    pool: input.pool ?? null,
    isWorking: (agent, sessionId) => sessions.isWorking(agent, sessionId),
    waitingMessages: async (agent, session) =>
      session.kind === "direct"
        ? (await sessions.waitingInJob(agent, session.sessionId)).size +
          sessions.queuedMessages(agent.id, session.chatId).length
        : conversations.conversationAgentReplies.queuedFor(
            session.chatId,
            agent.id,
          ),
    isMember: async (conversationId, userId) =>
      (await new ConversationRepository(database).findForMember(
        conversationId,
        userId,
      )) !== null,
    defaultIdleMinutes: async () => (await sessionSettings.read()).idleMinutes,
  });
  return assembleEmployeeServices({
    input,
    store,
    authorization,
    users,
    messages,
    models,
    languages,
    memory,
    activity,
    accessEnvironment,
    sessionSettings,
    slots,
    sessions,
    agentSessions,
    logbook: logbookService,
    conversations,
    learning,
    privacy,
  });
}
