import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";
import { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationError } from "@/backend/error/ConversationError";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { createChatSessionId } from "@/backend/service/chat/ChatSessionWords";
import { AgentActivityService } from "@/backend/service/employee/AgentActivityService";
import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";
import { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import { AgentLearningScheduler } from "@/backend/service/employee/AgentLearningScheduler";
import { AgentLearningService } from "@/backend/service/employee/AgentLearningService";
import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";
import { AgentTemplateService } from "@/backend/service/employee/AgentTemplateService";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";
import { ChatGroupService } from "@/backend/service/employee/ChatGroupService";
import { PersonColorService } from "@/backend/service/employee/PersonColorService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { startAutomationAgentWorker } from "./automation-services.server";
import { createConversationServices } from "./conversation-services.server";
import { defaultAgentTemplateTexts } from "./agent-template-texts.server";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { ServerCache } from "@/backend/cache/ServerCache";
import type { AutomationService } from "@/backend/service/automation/AutomationService";
import type { AgentDeletionDependencies } from "@/backend/service/employee/AgentDeletionService";
import type { Database } from "@/backend/database/Database";
import type { PlanExecution } from "@/backend/agents/AgentPlanExecution";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";
import type { PicaSettingsService } from "@/backend/service/chat/PicaSettingsService";
import type { ConversationContextReader } from "@/backend/service/conversation/ConversationContextReader";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { ConversationApplicationServices } from "./conversation-services.server";

/**
 * Agents as employees, the chat directory and person colors (PAGE-266), with
 * the stored conversations the chat page shows (PAGE-278).
 */
export interface EmployeeApplicationServices extends ConversationApplicationServices {
  readonly agentEmployeeAdministration: AgentEmployeeAdministration;
  readonly agentDeletionService: AgentDeletionService;
  /** The templates of `AGENT.md` (PAGE-283). */
  readonly agentTemplateService: AgentTemplateService;
  readonly agentEmployeeSessions: AgentEmployeeSessions;
  readonly agentLearningService: AgentLearningService;
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
  readonly workspaceRoot: string;
  /** Where the stored conversations keep their audio and announce their changes (PAGE-278). */
  readonly conversations: {
    readonly directory: string;
    readonly events: PagesEventPublisher;
    /** The speech model and the longest recording of `config.toml` (PAGE-277). */
    readonly speech?: SpeechRecognitionSetting;
  };
  /** Pica's model choice and the ACP path the group observer runs on (PAGE-296). */
  readonly observer: {
    readonly picaSettingsService: Pick<
      PicaSettingsService,
      "resolve" | "requireCurrent"
    >;
    readonly agentPlanExecution: PlanExecution | null;
  };
}

/**
 * Starts the learning runs of agents and the delivery of automation work to
 * them; both need the ACP path of the agents' sessions.
 */
function startBackground(
  input: EmployeeServicesInput,
  parts: {
    readonly store: EmployeeStore;
    readonly learning: AgentLearningService;
    readonly sessions: AgentEmployeeSessions;
  },
): void {
  if (!input.acp) return;
  new AgentLearningScheduler(parts.store, parts.learning).start();
  startAutomationAgentWorker({
    database: input.database,
    automationService: input.automations,
    sessions: parts.sessions,
  });
}

/**
 * Wires agents, their sessions and learning runs, the chat directory and
 * person colors on the shared database; the learning scheduler runs only in
 * the process that serves the chat.
 */
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

/** Builds the user and agent employee services for one database. */
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
  // The reader exists once the conversations are wired below.
  let contextReader: ConversationContextReader | null = null;
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
    conversationContext: {
      readForAgent: (agentId, request) =>
        contextReader
          ? contextReader.readForAgent(agentId, request)
          : Promise.reject(new ConversationError("not_found")),
    },
  });
  const simulation = currentAgentSimulationMode();
  const isBackgroundOwner = !isLocalSessionOwner() && !isPagesRunsProcess();
  const conversations = createConversationServices({
    database,
    ...input.conversations,
    observer: {
      pica: input.observer.picaSettingsService,
      plans: input.observer.agentPlanExecution,
      simulation: simulation.isActive
        ? new SimulatedConversationObserver(simulation)
        : null,
      isBackgroundOwner,
    },
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
  contextReader = conversations.conversationContextReader;
  const learning = new AgentLearningService({
    store,
    users,
    messages,
    sessions,
    memory,
    activity,
  });
  if (isBackgroundOwner) startBackground(input, { store, learning, sessions });
  return {
    ...conversations,
    agentEmployeeAdministration: new AgentEmployeeAdministration({
      authorization,
      cache: input.cache,
      models,
      memory,
      activity,
    }),
    agentDeletionService: createDeletionService(input, authorization),
    agentTemplateService: new AgentTemplateService({
      store,
      authorization,
      languages,
      defaults: defaultAgentTemplateTexts,
    }),
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
import path from "node:path";
