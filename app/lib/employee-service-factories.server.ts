import path from "node:path";

import { CliHostMcpServers } from "@/backend/agents/cli/CliHostMcpServers";
import { probeBubblewrap } from "@/backend/agents/cli/CliPlanIsolation";
import type { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedAgentMemoryModel } from "@/backend/agents/simulation/SimulatedAgentMemoryModel";
import { SimulatedConversationAgent } from "@/backend/agents/simulation/SimulatedConversationAgent";
import { SimulatedConversationObserver } from "@/backend/agents/simulation/SimulatedConversationObserver";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ConversationReplySettingsRepository } from "@/backend/database/repositories/conversation/ConversationReplySettingsRepository";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { AgentSessionSettingsRepository } from "@/backend/database/repositories/employee/AgentSessionSettingsRepository";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { createChatSessionId } from "@/backend/service/chat/ChatSessionWords";
import { AgentAccessEnvironmentService } from "@/backend/service/employee/AgentAccessEnvironmentService";
import { AgentChatPrivacyService } from "@/backend/service/employee/AgentChatPrivacyService";
import type { AgentChatSessionService } from "@/backend/service/employee/AgentChatSessionService";
import { AgentDeletionService } from "@/backend/service/employee/AgentDeletionService";
import type { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import { AgentLearningScheduler } from "@/backend/service/employee/AgentLearningScheduler";
import { AgentLearningService } from "@/backend/service/employee/AgentLearningService";
import { AgentSessionMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import { AgentMemoryRecorder } from "@/backend/service/employee/AgentMemoryRecorder";
import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";
import {
  AgentKnowledgeAccess,
  AgentMemorySharing,
} from "@/backend/service/employee/AgentMemorySharing";
import { AgentSessionSlots } from "@/backend/service/employee/AgentSessionSlots";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";
import { PicaAcpWorkspace } from "@/backend/service/chat/acp/PicaAcpWorkspace";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { startAutomationAgentWorker } from "./automation-services.server";

import { conversationModelRoot } from "@/backend/service/conversation/ConversationModelDirectory";

import type { AgentDeletionDependencies } from "@/backend/service/employee/AgentDeletionService";
import type { AgentLearningDependencies } from "@/backend/service/employee/AgentLearningService";
import type { Database } from "@/backend/database/Database";
import type { AgentMemoryModel } from "@/backend/service/employee/AgentMemoryModel";
import type { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import type { AgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import type {
  ConversationApplicationServices,
  ConversationObserverInput,
} from "./conversation-services.server";

/**
 * Agents as employees, the chat directory and person colors (PAGE-266), with
 * the stored conversations the chat page shows (PAGE-278).
 */
import type { EmployeeServicesInput } from "./employee-services.server";

/**
 * Starts the nightly dream runs (PAGE-305) where a model can answer them, ACP
 * or the simulation, and the delivery of automation work to the agents, which
 * needs the ACP path of the agents' sessions.
 */
export function startBackground(
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
export function createLearning(
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
export function groupObserverInput(
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
    decision: {
      model: observer.chatDecisionModel,
      settings: observer.chatDecisionSettingsService,
    },
    isBackgroundOwner,
    directoryRoot: conversationModelRoot(input.workspaceRoot),
  };
}

/**
 * The directory of the chat page with what runs and waits in each chat
 * (PAGE-303, PAGE-304).
 */
export function createChatDirectory(parts: {
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
    replyModes: (conversationIds) =>
      new ConversationReplySettingsRepository(parts.database).modes(
        conversationIds,
      ),
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
export function createMemoryParts(parts: {
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
export function simulatedAgent(
  simulation: ReturnType<typeof currentAgentSimulationMode>,
): SimulatedConversationAgent | null {
  return simulation.isActive
    ? new SimulatedConversationAgent(simulation)
    : null;
}

/**
 *
 */
export function createDeletionFiles(
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

/**
 *
 */
export function createDeletionService(
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
export function createSessionGates(database: Database): {
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
