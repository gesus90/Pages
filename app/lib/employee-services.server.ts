import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import {
  GoogleImageClient,
  OpenRouterImageClient,
} from "@/backend/agents/providers/ProviderImageClients";
import { ConversationAgentFiles } from "@/backend/service/conversation/content/ConversationAgentFiles";
import { sharedConversationGeneratedImages } from "@/backend/service/conversation/content/ConversationGeneratedImages";
import { AgentImageGeneration } from "@/backend/service/employee/AgentImageGeneration";
import { AgentMediaGeneration } from "@/backend/service/employee/AgentMediaGeneration";
import {
  GoogleMediaClient,
  OpenRouterMediaClient,
} from "@/backend/agents/providers/ProviderMediaClients";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ChatAcpSessionRepository } from "@/backend/database/repositories/chat/ChatAcpSessionRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { AgentChatHistoryRepository } from "@/backend/database/repositories/conversation/AgentChatHistoryRepository";
import { ChatAnswerModelRepository } from "@/backend/database/repositories/conversation/ChatAnswerModelRepository";
import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { sharedConversationAnswerStream } from "@/backend/service/conversation/ConversationAnswerStream";

import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";
import type { ConversationAttachments } from "@/backend/service/conversation/content/ConversationAttachments";
import type { ConversationAttachmentLibrary } from "@/backend/service/conversation/content/ConversationAttachmentLibrary";
import type { AgentImageToolDependencies } from "@/backend/service/employee/AgentImageTool";
import type { ConversationAnswerFileDependencies } from "@/backend/service/conversation/content/ConversationAnswerFiles";
import type { AgentMediaToolDependencies } from "@/backend/service/employee/AgentMediaTool";
import type { AgentChatQuestionService } from "@/backend/service/conversation/AgentChatQuestionService";
import type { AgentChatTaskService } from "@/backend/service/employee/AgentChatTaskService";
import type { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationError } from "@/backend/error/ConversationError";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { AgentChatHistoryService } from "@/backend/service/conversation/AgentChatHistoryService";
import { createChatSessionId } from "@/backend/service/chat/ChatSessionWords";
import type { AgentAccessEnvironmentService } from "@/backend/service/employee/AgentAccessEnvironmentService";
import type { AgentChatPrivacyService } from "@/backend/service/employee/AgentChatPrivacyService";
import type { ChatAttachmentService } from "@/backend/service/chat/ChatAttachmentService";
import type { AgentChatAttachments } from "@/backend/service/employee/AgentChatAttachments";
import { AgentChatReader } from "@/backend/service/employee/AgentChatReader";
import { AgentChatSessionLifecycle } from "@/backend/service/employee/AgentChatSessionLifecycle";
import type { AgentChatSessionService } from "@/backend/service/employee/AgentChatSessionService";
import { AgentChatToolGuard } from "@/backend/service/employee/AgentChatToolGuard";
import { AgentHostFiles } from "@/backend/service/employee/AgentHostFiles";
import { AgentDreamingAdministration } from "@/backend/service/employee/AgentDreamingAdministration";
import { AgentLessonsAdministration } from "@/backend/service/employee/AgentLessonsAdministration";
import { AgentLogbookAdministration } from "@/backend/service/employee/AgentLogbookAdministration";
import type { AgentLogbookService } from "@/backend/service/employee/AgentLogbookService";
import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";
import type { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
import { AgentProfileReadService } from "@/backend/service/employee/profile/AgentProfileReadService";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import type { AgentLearningService } from "@/backend/service/employee/AgentLearningService";
import { AgentRecipeService } from "@/backend/service/employee/AgentRecipeService";
import type { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";
import { AgentSessionLimitService } from "@/backend/service/employee/AgentSessionLimitService";
import type { AgentSessionSlots } from "@/backend/service/employee/AgentSessionSlots";
import { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";
import type { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";
import { ChatGroupService } from "@/backend/service/employee/ChatGroupService";
import { PersonColorService } from "@/backend/service/employee/PersonColorService";
import {
  createAgentChatAttachments,
  createChatDirectory,
  createDeletionService,
  createMemoryParts,
  createSessionGates,
} from "./employee-service-factories.server";

import { createAgentChatControl } from "./agent-chat-control-services.server";
import { wireEmployeeConversations } from "./employee-conversation-wiring.server";
import { defaultAgentTemplateTexts } from "./agent-template-texts.server";
import { isSafeSvg } from "./settings-actions/svg-safety.server";

import type { AgentChatTools } from "@/definition/AgentChat";
import type { ChatCallSetting } from "@/backend/config/ChatCallConfig";
import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AutomationService } from "@/backend/service/automation/AutomationService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { AgentHostFileStores } from "@/backend/service/employee/AgentHostFiles";
import type { TaskService } from "@/backend/service/TaskService";
import type { WikiService } from "@/backend/service/WikiService";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { PicaAcpSessionPool } from "@/backend/service/chat/acp/PicaAcpSessionPool";
import type { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import type { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationApplicationServices } from "./conversation-services.server";
import type { AgentChatControlServices } from "./agent-chat-control-services.server";

/**
 * Agents as employees, the chat directory and person colors, with
 * the stored conversations the chat page shows.
 */
export interface EmployeeApplicationServices
  extends ConversationApplicationServices, AgentChatControlServices {
  readonly agentEmployeeAdministration: AgentEmployeeAdministration;
  readonly agentDeletionService: AgentDeletionService;
  /** The templates of `AGENT.md`. */
  readonly agentTemplateService: AgentTemplateService;
  /** The readable profiles of agents for administrators and leaders. */
  readonly agentProfileReadService: AgentProfileReadService;
  readonly agentEmployeeSessions: AgentEmployeeSessions;
  /** The files a person sends in the direct chat with an agent. */
  readonly agentChatAttachments: AgentChatAttachments;
  /** The chat sessions of agents: the popup "Agent-Einstellungen" and the head of a chat. */
  readonly agentChatSessionService: AgentChatSessionService;
  /** The tab "Lagebuch" of that popup: entries, settings, removal. */
  readonly agentLogbookAdministration: AgentLogbookAdministration;
  /** The tab "Dreaming": schedule, last and next run, the files and "Jetzt träumen". */
  readonly agentDreamingAdministration: AgentDreamingAdministration;
  /** The tab "Lektionen & Rezepte": lessons and recipes to view, edit, switch off and delete. */
  readonly agentLessonsAdministration: AgentLessonsAdministration;
  /** The limits of concurrent chat sessions of agents. */
  readonly agentSessionLimitService: AgentSessionLimitService;
  readonly agentLearningService: AgentLearningService;
  /** Marks chats with agents confidential. */
  readonly agentChatPrivacyService: AgentChatPrivacyService;
  /** The scheduled tasks of chats: the entry "Geplante Aufgaben" of the chat menu. */
  readonly agentChatTaskService: AgentChatTaskService;
  readonly chatDirectoryService: ChatDirectoryService;
  readonly chatGroupService: ChatGroupService;
  readonly personColorService: PersonColorService;
}

/** What the employee services are built from. */
export interface EmployeeServicesInput {
  readonly database: Database;
  /** The automations whose agent work the agents' sessions deliver. */
  readonly automations: AutomationService;
  readonly cache: ServerCache;
  /** Pica's ACP path, which agent sessions share; `null` without ACP chat. */
  readonly acp: PicaAcpService | null;
  /** The files of chat sessions, in which a person's files for an agent are stored. */
  readonly chatAttachments: Pick<
    ChatAttachmentService,
    "upload" | "discard" | "open"
  >;
  /** The live processes of the chat sessions; `null` without ACP chat. */
  readonly pool?: PicaAcpSessionPool | null;
  /** The ticket and wiki attachments the file tools of an agent with host tools use. */
  readonly hostFiles?: AgentHostFileStores;
  /**
   * Folders the isolation of the toolkit's shell hides from agent commands,
   * such as the data folder.
   */
  readonly toolkitHiddenDirectories?: readonly string[];
  /**
   * Who may see a ticket or a wiki page; without it a chat with
   * further people gets no knowledge of other chats.
   */
  readonly knowledge?: {
    readonly tickets: Pick<TaskService, "getByKey">;
    readonly wiki: Pick<WikiService, "canView">;
  };
  /** The folder of the chat workspaces, whose files an agent deletion removes. */
  readonly workspaceRoot: string;
  /**
   * Decrypts the stored keys of connections, for the images an agent
   * generates with its own model; without it no agent generates images.
   */
  readonly cipher?: InstanceSecretCipher;
  /** Where the stored conversations keep their audio and announce their changes. */
  readonly conversations: {
    readonly directory: string;
    readonly events: PagesEventPublisher;
    /** The speech model and the longest recording of `config.toml`. */
    readonly speech?: SpeechRecognitionSetting;
    /** The STUN and TURN servers of audio calls of `config.toml`. */
    readonly chatCalls?: ChatCallSetting;
    /** The origin users reach Pages at; links to it embed. */
    readonly publicUrl?: string;
    /** The origin of the players of web export packages, apart from Pages. */
    readonly chatPlayerOrigin?: string;
  };
  /** Pica's model choice and the ACP path the group observer runs on. */
  readonly observer: {
    readonly picaSettingsService: Pick<
      PicaSettingsService,
      "resolve" | "requireCurrent"
    >;
    readonly agentPlanExecution: PlanExecution | null;
    /** The decision model of the instance and its default rules. */
    readonly chatDecisionSettingsService: Pick<
      ChatDecisionSettingsService,
      "rules" | "modelView"
    >;
    /** The decision model that gives the probabilities. */
    readonly chatDecisionModel: Pick<ConversationDecisionModel, "ask">;
  };
}

export interface EmployeeParts {
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
  readonly lifecycle: AgentChatSessionLifecycle;
  readonly chatTasks: AgentChatTaskService;
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

/** The tabs "Dreaming" and "Lektionen & Rezepte": what a viewer sees of the dreams of an agent and what an administrator changes. */
function createDreamingAdministration(
  parts: Pick<
    EmployeeParts,
    "store" | "users" | "models" | "learning" | "memory" | "sessions"
  > & { readonly hasModel: boolean },
): {
  readonly dreaming: AgentDreamingAdministration;
  readonly lessons: AgentLessonsAdministration;
} {
  return {
    dreaming: new AgentDreamingAdministration({
      store: parts.store,
      users: parts.users,
      learning: parts.hasModel ? parts.learning : null,
      isWorkingInChat: (agentId) => parts.sessions.isWorkingInChat(agentId),
      models: (userId) => parts.models.models(userId),
    }),
    lessons: new AgentLessonsAdministration({
      store: parts.store,
      users: parts.users,
      memory: parts.memory,
    }),
  };
}

function assembleEmployeeServices(
  parts: EmployeeParts,
): EmployeeApplicationServices {
  const { input, store, authorization, models, languages, sessions } = parts;
  const agentChatAttachments = createAgentChatAttachments(parts);
  const dreams = createDreamingAdministration({
    ...parts,
    hasModel: input.acp !== null || currentAgentSimulationMode().isActive,
  });
  return {
    ...parts.conversations,
    ...createAgentChatControl({
      database: input.database,
      store,
      users: parts.users,
      models,
      lifecycle: parts.lifecycle,
      conversationService: parts.conversations.conversationService,
      replies: parts.conversations.conversationAgentReplies,
    }),
    agentEmployeeAdministration: new AgentEmployeeAdministration({
      authorization,
      cache: input.cache,
      models,
      memory: parts.memory,
      activity: parts.activity,
      accessEnvironment: parts.accessEnvironment,
      ...(input.pool ? { sessions: input.pool } : {}),
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
    agentChatAttachments,
    agentChatSessionService: parts.agentSessions,
    agentLogbookAdministration: createLogbookAdministration(parts),
    agentDreamingAdministration: dreams.dreaming,
    agentLessonsAdministration: dreams.lessons,
    agentSessionLimitService: new AgentSessionLimitService(
      parts.sessionSettings,
      parts.slots,
      (userId) => models.models(userId),
    ),
    agentLearningService: parts.learning,
    agentChatPrivacyService: parts.privacy,
    agentChatTaskService: parts.chatTasks,
    chatDirectoryService: createChatDirectory({
      database: input.database,
      store,
      users: parts.users,
      messages: parts.messages,
      sessions,
      agentSessions: parts.agentSessions,
      agentAttachments: agentChatAttachments,
      conversations: parts.conversations,
      models,
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
/** Services that refer to each other; each is set once it exists and read lazily. */
export interface LateServices {
  sessions: AgentEmployeeSessions | null;
  agentChat: AgentChatTools | null;
  chatQuestions: AgentChatQuestionService | null;
  chatTasks: AgentChatTaskService | null;
  contextReader: ConversationContextReader | null;
  logbook: AgentLogbookService | null;
  /** Writes the state of a chat into the Lagebuch before its session closes. */
  logbookClose: ((sessionId: string) => Promise<void>) | null;
  /** Stores the images agents generate in conversations. */
  attachments: ConversationAttachments | null;
  /** Lets agents search and read the attachments of their chats. */
  library: ConversationAttachmentLibrary | null;
}

function optionalImages(images: AgentImageToolDependencies | undefined): {
  readonly images?: AgentImageToolDependencies;
} {
  return images ? { images } : {};
}

function lateAttachments(late: LateServices): ConversationAttachments {
  if (late.attachments === null)
    throw new Error(
      "The conversation attachments are used before they are wired.",
    );
  return late.attachments;
}

/**
 * The generation of images with an agent's own model in conversations;
 * without a cipher for the stored keys there is none.
 */
function createImageTool(
  input: EmployeeServicesInput,
  base: EmployeeBase,
  late: LateServices,
): AgentImageToolDependencies | undefined {
  if (!input.cipher) return undefined;
  return {
    generation: new AgentImageGeneration({
      connections: new AgentConnectionRepository(input.database),
      cipher: input.cipher,
      models: base.models,
      store: base.store,
      clients: {
        openrouter: new OpenRouterImageClient(),
        google_ai_studio: new GoogleImageClient(),
      },
    }),
    attachments: {
      stage: (target, file) => lateAttachments(late).stage(target, file),
      release: (senderId, attachmentIds) =>
        lateAttachments(late).release(senderId, attachmentIds),
    },
    pending: sharedConversationGeneratedImages(),
    files: new ConversationAgentFiles(),
  };
}

/**
 * The files an agent attaches to its answer in a conversation: stored as
 * attachments of the conversation and bound to the stored answer, as the
 * generated images are.
 */
function createAnswerFiles(
  late: LateServices,
): ConversationAnswerFileDependencies {
  return {
    attachments: {
      stage: (target, file) => lateAttachments(late).stage(target, file),
      release: (senderId, attachmentIds) =>
        lateAttachments(late).release(senderId, attachmentIds),
    },
    // Answer files wait for the same answer as the generated images.
    pending: sharedConversationGeneratedImages(),
    isSafeSvg,
  };
}

/**
 * The generation of videos and sounds with an agent's own model in
 * conversations; without a cipher for the stored keys there is none.
 */
function createMediaTool(
  input: EmployeeServicesInput,
  base: EmployeeBase,
  late: LateServices,
): { readonly media?: AgentMediaToolDependencies } {
  if (!input.cipher) return {};
  return {
    media: {
      generation: new AgentMediaGeneration({
        connections: new AgentConnectionRepository(input.database),
        cipher: input.cipher,
        models: base.models,
        store: base.store,
        clients: {
          openrouter: new OpenRouterMediaClient(),
          google_ai_studio: new GoogleMediaClient(),
        },
      }),
      attachments: {
        stage: (target, file) => lateAttachments(late).stage(target, file),
        release: (senderId, attachmentIds) =>
          lateAttachments(late).release(senderId, attachmentIds),
      },
      // Images, videos and sounds wait for the same answer.
      pending: sharedConversationGeneratedImages(),
    },
  };
}

function lateSessions(late: LateServices): AgentEmployeeSessions {
  if (late.sessions === null)
    throw new Error("The agent sessions are used before they are wired.");
  return late.sessions;
}

/** Creates the stores, the memory and the gates that every part of the wiring uses. */
function createEmployeeBase(
  input: EmployeeServicesInput,
  late: LateServices,
): EmployeeBase {
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
    sessions: () => lateSessions(late),
  });
  const activity = new AgentActivityService(store);
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
  const lifecycle = new AgentChatSessionLifecycle({
    store,
    messages,
    acp: input.acp,
    pool: input.pool ?? null,
    acpSessions: new ChatAcpSessionRepository(database),
    summaries: () => memoryModel,
    logbook: async (sessionId) => {
      await late.logbookClose?.(sessionId);
    },
  });
  return {
    store,
    authorization,
    users,
    messages,
    models,
    languages,
    simulation,
    memory,
    memoryModel,
    recorder,
    privacy,
    activity,
    accessEnvironment,
    sessionSettings,
    slots,
    chatReader,
    lifecycle,
  };
}

type MemoryParts = ReturnType<typeof createMemoryParts>;

/** The services every part of the employee wiring shares. */
export interface EmployeeBase {
  readonly store: EmployeeStore;
  readonly authorization: AuthorizationRepository;
  readonly users: UserRepository;
  readonly messages: ChatSessionRepository;
  readonly models: AgentEmployeeModels;
  readonly languages: UserSettingsRepository;
  readonly simulation: ReturnType<typeof currentAgentSimulationMode>;
  readonly memory: MemoryParts["memory"];
  readonly memoryModel: MemoryParts["memoryModel"];
  readonly recorder: MemoryParts["recorder"];
  readonly privacy: MemoryParts["privacy"];
  readonly activity: AgentActivityService;
  readonly accessEnvironment: AgentAccessEnvironmentService;
  readonly sessionSettings: AgentSessionSettingsRepository;
  readonly slots: AgentSessionSlots;
  readonly chatReader: AgentChatReader;
  readonly lifecycle: AgentChatSessionLifecycle;
}

function createEmployeeSessions(
  input: EmployeeServicesInput,
  base: EmployeeBase,
  late: LateServices,
): AgentEmployeeSessions {
  return new AgentEmployeeSessions({
    store: base.store,
    users: base.users,
    authorization: base.authorization,
    messages: base.messages,
    languages: base.languages,
    models: base.models,
    memory: base.memory,
    acp: input.acp,
    slots: base.slots,
    accessEnvironment: base.accessEnvironment,
    ...(input.hostFiles
      ? { hostFiles: new AgentHostFiles(input.hostFiles) }
      : {}),
    ...(input.toolkitHiddenDirectories
      ? { toolkitHiddenDirectories: input.toolkitHiddenDirectories }
      : {}),
    recorder: base.recorder,
    agentChat: () => late.agentChat,
    ...optionalImages(createImageTool(input, base, late)),
    ...createMediaTool(input, base, late),
    answerFiles: createAnswerFiles(late),
    attachments: () => (late.library ? { library: late.library } : null),
    chatQuestions: () => late.chatQuestions,
    chatTasks: () => late.chatTasks,
    chatHistory: new AgentChatHistoryService({
      history: new AgentChatHistoryRepository(input.database),
    }),
    createSessionId: () => createChatSessionId(),
    conversationContext: {
      readForAgent: (agentId, request) =>
        late.contextReader
          ? late.contextReader.readForAgent(agentId, request)
          : Promise.reject(new ConversationError("not_found")),
    },
    lifecycle: () => base.lifecycle,
    chatReader: base.chatReader,
    toolGuard: new AgentChatToolGuard({ store: base.store }),
    logbook: () => late.logbook,
    recipes: new AgentRecipeService({ store: base.store }),
    answers: {
      open: (target) =>
        sharedConversationAnswerStream().open({
          ...target,
          recordModel: (messageId, model) =>
            new ChatAnswerModelRepository(input.database).record(
              messageId,
              model,
            ),
        }),
    },
  });
}

/**
 */
export function createEmployeeServices(
  input: EmployeeServicesInput,
): EmployeeApplicationServices {
  const late: LateServices = {
    sessions: null,
    agentChat: null,
    chatQuestions: null,
    chatTasks: null,
    contextReader: null,
    logbook: null,
    logbookClose: null,
    attachments: null,
    library: null,
  };
  const base = createEmployeeBase(input, late);
  const sessions = createEmployeeSessions(input, base, late);
  late.sessions = sessions;
  const wired = wireEmployeeConversations(input, base, sessions, late);
  return assembleEmployeeServices({
    input,
    ...base,
    sessions,
    ...wired,
  });
}
