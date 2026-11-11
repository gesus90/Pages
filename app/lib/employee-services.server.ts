import { CliHostMcpServers } from "@/backend/agents/cli/CliHostMcpServers";
import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";
import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedAgentMemoryModel } from "@/backend/agents/simulation/SimulatedAgentMemoryModel";
import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { createChatSessionId } from "@/backend/service/chat/ChatSessionWords";
import { AgentAccessEnvironmentService } from "@/backend/service/employee/AgentAccessEnvironmentService";
import { AgentChatPrivacyService } from "@/backend/service/employee/AgentChatPrivacyService";
import { AgentHostFiles } from "@/backend/service/employee/AgentHostFiles";
import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";
import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
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

import { createConversationServices } from "./conversation-services.server";
import { defaultAgentTemplateTexts } from "./agent-template-texts.server";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { AgentHostFileStores } from "@/backend/service/employee/AgentHostFiles";
import type { AgentLearningDependencies } from "@/backend/service/employee/AgentLearningService";
import type { AgentMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import type { TaskService } from "@/backend/service/TaskService";
import type { WikiService } from "@/backend/service/WikiService";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationApplicationServices } from "./conversation-services.server";

/**
 * Agents as employees, the chat directory and person colors (PAGE-266), with
 * the stored conversations the chat page shows (PAGE-278).
 */
export interface EmployeeApplicationServices extends ConversationApplicationServices {
  readonly agentEmployeeAdministration: AgentEmployeeAdministration;
  /** The templates of `AGENT.md` (PAGE-283). */
  readonly agentTemplateService: AgentTemplateService;
  readonly agentEmployeeSessions: AgentEmployeeSessions;
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
  readonly cache: ServerCache;
  /** Pica's ACP path, which agent sessions share; `null` without ACP chat. */
  readonly acp: PicaAcpService | null;
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
  /** Where the stored conversations keep their audio and announce their changes (PAGE-278). */
  readonly conversations: {
    readonly directory: string;
    readonly events: PagesEventPublisher;
    /** The speech model and the longest recording of `config.toml` (PAGE-277). */
    readonly speech?: SpeechRecognitionSetting;
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
    queuedMessages: (conversationId) => replies.queuedMessages(conversationId),
    waitingInJob: (agent, sessionId) => sessions.waitingInJob(agent, sessionId),
    queuedAgentMessages: (agentId, personId) =>
      sessions.queuedMessages(agentId, personId),
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

/**
 * Starts the nightly dream runs (PAGE-305) where a model can answer them,
 * ACP or the simulation, and only in the process that serves the chat.
 */
function startDreamRuns(
  dependencies: AgentLearningDependencies,
  hasModel: boolean,
): AgentLearningService {
  const service = new AgentLearningService(dependencies);
  if (hasModel && !isLocalSessionOwner() && !isPagesRunsProcess())
    new AgentLearningScheduler(dependencies.store, service).start();
  return service;
}

/** The simulated agent of conversations; `null` outside the simulation. */
function simulatedAgent(
  simulation: ReturnType<typeof currentAgentSimulationMode>,
): SimulatedConversationAgent | null {
  return simulation.isActive
    ? new SimulatedConversationAgent(simulation)
    : null;
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
  const activity = new AgentActivityService(store);
  // Bubblewrap and the MCP configuration of the CLIs are read anew, so they
  // change without a restart (PAGE-303).
  const accessEnvironment = new AgentAccessEnvironmentService({
    isIsolationAvailable: () => probeBubblewrap(),
    mcp: new CliHostMcpServers(),
  });
  // One place per running chat session of an agent, within the stored limits (PAGE-304).
  const sessionSettings = new AgentSessionSettingsRepository(database);
  const slots = new AgentSessionSlots(() => sessionSettings.read());
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
    createSessionId: () => createChatSessionId(),
  });
  const conversations = createConversationServices({
    database,
    ...input.conversations,
    runner: new AgentConversationAnswers({
      store,
      users,
      sessions,
      messages,
      simulation: simulatedAgent(simulation),
      recorder,
    }),
  });
  const learning = startDreamRuns(
    { store, users, memory, model: memoryModel, activity },
    input.acp !== null || simulation.isActive,
  );
  return {
    ...conversations,
    agentEmployeeAdministration: new AgentEmployeeAdministration({
      authorization,
      cache: input.cache,
      models,
      memory,
      activity,
      accessEnvironment,
    }),
    agentTemplateService: new AgentTemplateService({
      store,
      authorization,
      languages,
      defaults: defaultAgentTemplateTexts,
    }),
    agentEmployeeSessions: sessions,
    agentSessionLimitService: new AgentSessionLimitService(
      sessionSettings,
      slots,
    ),
    agentLearningService: learning,
    agentChatPrivacyService: privacy,
    chatDirectoryService: createChatDirectory({
      database,
      store,
      users,
      messages,
      sessions,
      conversations,
    }),
    chatGroupService: new ChatGroupService({ store }),
    personColorService: new PersonColorService(authorization, input.cache),
  };
}
