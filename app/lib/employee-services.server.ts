import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { createChatSessionId } from "@/backend/service/chat/ChatSessionWords";
import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";
import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
import { AgentProfileReadService } from "@/backend/service/employee/profile/AgentProfileReadService";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import { AgentLearningScheduler } from "@/backend/service/employee/AgentLearningScheduler";
import { AgentLearningService } from "@/backend/service/employee/AgentLearningService";
import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";
import { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";
import { ChatGroupService } from "@/backend/service/employee/ChatGroupService";
import { PersonColorService } from "@/backend/service/employee/PersonColorService";

import { createConversationServices } from "./conversation-services.server";
import { defaultAgentTemplateTexts } from "./agent-template-texts.server";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
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
  /** The readable profiles of agents for administrators and leaders (PAGE-308). */
  readonly agentProfileReadService: AgentProfileReadService;
  readonly agentEmployeeSessions: AgentEmployeeSessions;
  readonly agentLearningService: AgentLearningService;
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
  /** Where the stored conversations keep their audio and announce their changes (PAGE-278). */
  readonly conversations: {
    readonly directory: string;
    readonly events: PagesEventPublisher;
    /** The speech model and the longest recording of `config.toml` (PAGE-277). */
    readonly speech?: SpeechRecognitionSetting;
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
  const memory = new AgentMemoryService(store);
  const activity = new AgentActivityService(store);
  const sessions = new AgentEmployeeSessions({
    store,
    users,
    authorization,
    messages,
    languages,
    models,
    memory,
    acp: input.acp,
    createSessionId: () => createChatSessionId(),
  });
  const simulation = currentAgentSimulationMode();
  const conversations = createConversationServices({
    database,
    ...input.conversations,
    runner: new AgentConversationAnswers({
      store,
      users,
      sessions,
      messages,
      simulation: simulation.isActive
        ? new SimulatedConversationAgent(simulation)
        : null,
    }),
  });
  const learning = new AgentLearningService({
    store,
    users,
    messages,
    sessions,
    memory,
    activity,
  });
  if (input.acp && !isLocalSessionOwner() && !isPagesRunsProcess())
    new AgentLearningScheduler(store, learning).start();
  return {
    ...conversations,
    agentEmployeeAdministration: new AgentEmployeeAdministration({
      authorization,
      cache: input.cache,
      models,
      memory,
      activity,
    }),
    agentTemplateService: new AgentTemplateService({
      store,
      authorization,
      languages,
      defaults: defaultAgentTemplateTexts,
    }),
    agentProfileReadService: new AgentProfileReadService({ database, models }),
    agentEmployeeSessions: sessions,
    agentLearningService: learning,
    chatDirectoryService: new ChatDirectoryService({
      store,
      users,
      lookups: new WikiLookupRepository(database),
      messages,
      conversations: conversations.conversationReader,
      isWorking: (agent, sessionId) => sessions.isWorking(agent, sessionId),
      workingAgentIds: (conversationId) =>
        conversations.conversationAgentReplies.workingAgentIds(conversationId),
    }),
    chatGroupService: new ChatGroupService({ store }),
    personColorService: new PersonColorService(authorization, input.cache),
  };
}
