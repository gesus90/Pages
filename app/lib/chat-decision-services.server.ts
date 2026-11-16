import { currentAgentSimulationMode } from "@/backend/agents/simulation/AgentSimulationMode";
import { SimulatedConversationDecision } from "@/backend/agents/simulation/SimulatedConversationDecision";
import { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";
import { DecisionModelCalls } from "@/backend/service/chat/DecisionModelCalls";
import { ConversationDecisionModel } from "@/backend/service/conversation/ConversationDecisionModel";
import { OpenRouterDecisionsClient } from "@/backend/service/conversation/OpenRouterDecisionsClient";

import type { Database } from "@/backend/database/Database";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { InstanceSecretCipher } from "@/backend/security/InstanceSecretCipher";

/** The decision model and the default thresholds of the instance. */
export interface ChatDecisionApplicationServices {
  readonly chatDecisionSettingsService: ChatDecisionSettingsService;
  /** Asks the chosen OpenRouter decision model with the key of its connection. */
  readonly chatDecisionModel: ConversationDecisionModel;
  /** Calls a decision model of a stored OpenRouter connection, for chats and plans. */
  readonly decisionModelCalls: DecisionModelCalls;
}

/** What the decision services are built from. */
interface ChatDecisionInput {
  readonly database: Database;
  readonly connections: AgentConnectionRepository;
  readonly cipher: InstanceSecretCipher;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
}

/**
 * Wires the calls of decision models with the stored keys.
 * @param input - The connections with the cipher of their keys.
 * @returns The calls, which reach the decisions interface of OpenRouter directly.
 */
export function createDecisionModelCalls(
  input: Pick<ChatDecisionInput, "connections" | "cipher">,
): DecisionModelCalls {
  return new DecisionModelCalls({
    connections: input.connections,
    cipher: input.cipher,
    client: new OpenRouterDecisionsClient(),
  });
}

/**
 * Wires the decision model setting of the instance.
 * @param input - The database, the connections and the groups of accounts.
 * @returns The setting service, which the chats and the plans read.
 */
export function createChatDecisionSettings(
  input: Omit<ChatDecisionInput, "cipher">,
): ChatDecisionSettingsService {
  return new ChatDecisionSettingsService({
    settings: new ChatDecisionSettingsRepository(input.database),
    connections: input.connections,
    groups: input.groups,
    isSimulation: currentAgentSimulationMode().isActive,
  });
}

/**
 * Wires the decision model setting with the stored connections.
 * @param input - The database, the connections with the cipher of their keys
 * and the groups of accounts.
 * @returns The setting service, the model it chooses, which calls the
 * decisions interface of OpenRouter with the key of the stored connection,
 * and the calls themselves.
 */
export function createChatDecisionServices(
  input: ChatDecisionInput,
): ChatDecisionApplicationServices {
  const simulation = currentAgentSimulationMode();
  const chatDecisionSettingsService = createChatDecisionSettings(input);
  const decisionModelCalls = createDecisionModelCalls(input);
  return {
    chatDecisionSettingsService,
    chatDecisionModel: new ConversationDecisionModel({
      settings: chatDecisionSettingsService,
      calls: decisionModelCalls,
      simulation: simulation.isActive
        ? new SimulatedConversationDecision(simulation)
        : null,
    }),
    decisionModelCalls,
  };
}
