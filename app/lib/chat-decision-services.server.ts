import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";
import { OpenRouterDecisionsClient } from "@/backend/service/conversation/OpenRouterDecisionsClient";

import type { Database } from "@/backend/database/Database";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** The decision model and the default thresholds of the instance (PAGE-317, PAGE-379). */
export interface ChatDecisionApplicationServices {
  readonly chatDecisionSettingsService: ChatDecisionSettingsService;
  /** Asks the chosen OpenRouter decision model with the key of its connection. */
  readonly chatDecisionModel: ConversationDecisionModel;
}

/**
 * Wires the decision model setting with the stored connections.
 *
 * @param input - The database, the connections with the cipher of their keys
 * and the groups of accounts.
 * @returns The setting service and the model it chooses, which calls the
 * decisions interface of OpenRouter with the key of the stored connection.
 */
export function createChatDecisionServices(input: {
  readonly database: Database;
  readonly connections: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
}): ChatDecisionApplicationServices {
  const simulation = currentAgentSimulationMode();
  const chatDecisionSettingsService = new ChatDecisionSettingsService({
    settings: new ChatDecisionSettingsRepository(input.database),
    connections: input.connections,
    groups: input.groups,
    isSimulation: simulation.isActive,
  });
  return {
    chatDecisionSettingsService,
    chatDecisionModel: new ConversationDecisionModel({
      settings: chatDecisionSettingsService,
      connections: input.connections,
      cipher: input.cipher,
      client: new OpenRouterDecisionsClient(),
      simulation: simulation.isActive
        ? new SimulatedConversationDecision(simulation)
        : null,
    }),
  };
}
