import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { AgentChatAccess } from "@/backend/service/employee/AgentChatAccess";
import { AgentChatCommandService } from "@/backend/service/employee/AgentChatCommandService";
import { AgentChatControlService } from "@/backend/service/employee/AgentChatControlService";
import { AgentChatModelChoices } from "@/backend/service/employee/AgentChatModelChoices";
import { ChatGroupMembershipService } from "@/backend/service/employee/ChatGroupMembershipService";

import type { Database } from "@/backend/database/Database";
import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { UserRepository } from "@/backend/database/repositories/UserRepository";
import type { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import type { ConversationService } from "@/backend/service/conversation/ConversationService";
import type { AgentChatSessionLifecycle } from "@/backend/service/employee/AgentChatSessionLifecycle";
import type { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";

/** The control of agents in single chats and the members of groups (PAGE-380). */
export interface AgentChatControlServices {
  /** The model of an agent per chat, `/new` and `/compact` from the menu of the agent. */
  readonly agentChatControlService: AgentChatControlService;
  /** The chat commands `/model`, `/new` and `/compact`. */
  readonly agentChatCommandService: AgentChatCommandService;
  /** Removing members, dissolving groups and who steers their agents. */
  readonly chatGroupMembershipService: ChatGroupMembershipService;
}

/** What the control is built from. */
export interface AgentChatControlInput {
  readonly database: Database;
  readonly store: EmployeeStore;
  readonly users: UserRepository;
  readonly models: AgentEmployeeModels;
  readonly lifecycle: AgentChatSessionLifecycle;
  readonly conversationService: ConversationService;
  readonly replies: Pick<ConversationAgentReplies, "stop">;
}

/**
 * Wires the control of agents in single chats (PAGE-380): who may steer an
 * agent, the model choice, the commands and the members of groups.
 *
 * @param input - The shared stores and services of the employee wiring.
 */
export function createAgentChatControl(
  input: AgentChatControlInput,
): AgentChatControlServices {
  const { store, users, conversationService } = input;
  const access = new AgentChatAccess({
    store,
    users,
    conversations: new ConversationRepository(input.database),
  });
  const control = new AgentChatControlService({
    store,
    access,
    choices: new AgentChatModelChoices({ models: input.models }),
    lifecycle: input.lifecycle,
    systemLine: async (person, line) => {
      // A direct chat with an agent keeps its system lines in the direct conversation with it.
      const conversationId =
        line.kind === "group"
          ? line.chatId
          : (await conversationService.openDirect(person, line.agentId)).id;
      await conversationService.postSystemLine(person, {
        conversationId,
        text: line.text,
      });
    },
  });
  return {
    agentChatControlService: control,
    agentChatCommandService: new AgentChatCommandService({
      users,
      access,
      control,
    }),
    chatGroupMembershipService: new ChatGroupMembershipService({
      store,
      users,
      access,
      conversations: conversationService,
      lifecycle: input.lifecycle,
      models: input.models,
      stopAnswer: async (person, conversationId, agentId) => {
        await input.replies.stop(person, conversationId, agentId);
      },
    }),
  };
}
