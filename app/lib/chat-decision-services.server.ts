import { ChatDecisionSettingsRepository } from "@/backend/database/repositories/chat/ChatDecisionSettingsRepository";
import { ChatDecisionSettingsService } from "@/backend/service/chat/ChatDecisionSettingsService";

import type { Database } from "@/backend/database/Database";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";

/** The decision model of the instance (PAGE-317). */
export interface ChatDecisionApplicationServices {
  readonly chatDecisionSettingsService: ChatDecisionSettingsService;
}

/**
 * Wires the decision model setting with the stored connections.
 *
 * @param input - The database, the connections and the groups of accounts.
 * @returns The setting service, which also resolves the model that decides.
 */
export function createChatDecisionServices(input: {
  readonly database: Database;
  readonly connections: AgentConnectionRepository;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
}): ChatDecisionApplicationServices {
  return {
    chatDecisionSettingsService: new ChatDecisionSettingsService({
      settings: new ChatDecisionSettingsRepository(input.database),
      connections: input.connections,
      groups: input.groups,
    }),
  };
}
