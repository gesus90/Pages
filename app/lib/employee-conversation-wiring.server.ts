import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
import { isPagesRunsProcess } from "@/backend/runtime/RunsMode";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { AgentChatSessionService } from "@/backend/service/employee/AgentChatSessionService";
import { AgentConversationAnswers } from "@/backend/service/employee/AgentConversationAnswers";
import { AgentLogbookService } from "@/backend/service/employee/AgentLogbookService";
import { AgentLogbookSummarizer } from "@/backend/service/employee/AgentLogbookSummarizer";
import { AgentLogbookScheduler } from "@/backend/service/employee/AgentLogbookScheduler";
import {
  createChatTasks,
  createLearning,
  groupObserverInput,
  simulatedAgent,
} from "./employee-service-factories.server";
import { createConversationServices } from "./conversation-services.server";

import type { ConversationApplicationServices } from "./conversation-services.server";
import type { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import type {
  EmployeeBase,
  EmployeeParts,
  EmployeeServicesInput,
  LateServices,
} from "./employee-services.server";

function createAgentSessions(
  input: EmployeeServicesInput,
  base: EmployeeBase,
  sessions: AgentEmployeeSessions,
  conversations: ConversationApplicationServices,
): AgentChatSessionService {
  const { database } = input;
  const { store, users, lifecycle, sessionSettings } = base;
  return new AgentChatSessionService({
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
}

/** Wires conversation, learning and session services for agents. */
export function wireEmployeeConversations(
  input: EmployeeServicesInput,
  base: EmployeeBase,
  sessions: AgentEmployeeSessions,
  late: LateServices,
): Pick<
  EmployeeParts,
  "agentSessions" | "conversations" | "learning" | "logbook" | "chatTasks"
> {
  const { store, users, messages, memory, memoryModel, recorder } = base;
  const { simulation, activity, sessionSettings, chatReader } = base;
  const { database } = input;
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
      isWaitingForPerson: (agentId, conversationId) =>
        late.chatQuestions?.isWaiting(agentId, conversationId) === true,
    }),
  });
  late.contextReader = conversations.conversationContextReader;
  late.agentChat = conversations.agentChatService;
  late.attachments = conversations.conversationAttachments;
  late.library = conversations.conversationAttachmentLibrary;
  late.chatQuestions = conversations.agentChatQuestions;
  const chatTasks = createChatTasks(input, { users, conversations });
  late.chatTasks = chatTasks;
  const learning = createLearning(input, {
    dependencies: {
      store,
      users,
      memory,
      model: memoryModel,
      activity,
      isWorkingInChat: (agentId) => sessions.isWorkingInChat(agentId),
    },
    sessions,
    chatPoster: conversations.agentChatService,
    isBackgroundOwner,
    hasModel: input.acp !== null || simulation.isActive,
  });
  const hasModel = input.acp !== null || simulation.isActive;
  const logbookService = new AgentLogbookService({
    store,
    compaction: hasModel
      ? (agentId) => learning.run(agentId, { trigger: "logbook" })
      : null,
  });
  late.logbook = logbookService;
  const summarizer = new AgentLogbookSummarizer({
    store,
    users,
    reader: chatReader,
    model: () => memoryModel,
    logbook: logbookService,
    instanceModel: () => sessionSettings.logbookModel(),
  });
  // A closed session records its state as at rest; a confidential one is never pending.
  if (hasModel)
    late.logbookClose = async (sessionId) => {
      const pending = (await store.logbookSessions().pending()).find(
        (session) => session.sessionId === sessionId,
      );
      if (pending) await summarizer.summarize(pending);
    };
  if (isBackgroundOwner && hasModel)
    new AgentLogbookScheduler({
      store,
      summarizer,
      isWorking: (agentId) => sessions.isWorkingInChat(agentId),
    }).start();
  const agentSessions = createAgentSessions(
    input,
    base,
    sessions,
    conversations,
  );
  return {
    agentSessions,
    conversations,
    learning,
    logbook: logbookService,
    chatTasks,
  };
}
