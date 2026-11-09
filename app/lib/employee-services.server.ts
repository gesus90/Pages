import { isLocalSessionOwner } from "@/backend/agents/local/LocalSessionMode";
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
import { AgentEmployeeAdministration } from "@/backend/service/employee/AgentEmployeeAdministration";
import { AgentEmployeeModels } from "@/backend/service/employee/AgentEmployeeModels";
import { AgentEmployeeSessions } from "@/backend/service/employee/AgentEmployeeSessions";
import { AgentLearningScheduler } from "@/backend/service/employee/AgentLearningScheduler";
import { AgentLearningService } from "@/backend/service/employee/AgentLearningService";
import { AgentMemoryService } from "@/backend/service/employee/AgentMemoryService";
import { ChatDirectoryService } from "@/backend/service/employee/ChatDirectoryService";
import { ChatGroupService } from "@/backend/service/employee/ChatGroupService";
import { PersonColorService } from "@/backend/service/employee/PersonColorService";

import type { ServerCache } from "@/backend/cache/ServerCache";
import type { Database } from "@/backend/database/Database";
import type { PicaAcpService } from "@/backend/service/chat/acp/PicaAcpService";

/** Agents as employees, the chat directory and person colors (PAGE-266). */
export interface EmployeeApplicationServices {
  readonly agentEmployeeAdministration: AgentEmployeeAdministration;
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
  const memory = new AgentMemoryService(store);
  const activity = new AgentActivityService(store);
  const sessions = new AgentEmployeeSessions({
    store,
    users,
    authorization,
    messages,
    languages: new UserSettingsRepository(database),
    models,
    activity,
    memory,
    acp: input.acp,
    createSessionId: () => createChatSessionId(),
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
    agentEmployeeAdministration: new AgentEmployeeAdministration({
      authorization,
      cache: input.cache,
      models,
      memory,
      activity,
    }),
    agentEmployeeSessions: sessions,
    agentLearningService: learning,
    chatDirectoryService: new ChatDirectoryService({
      store,
      users,
      lookups: new WikiLookupRepository(database),
      messages,
      isWorking: (agent, sessionId) => sessions.isWorking(agent, sessionId),
    }),
    chatGroupService: new ChatGroupService({ store }),
    personColorService: new PersonColorService(authorization, input.cache),
  };
}
