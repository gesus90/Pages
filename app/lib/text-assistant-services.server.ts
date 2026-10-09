import { AssistantConversationRepository } from "@/backend/database/repositories/assistant/AssistantConversationRepository";
import { TextAssistantSettingsRepository } from "@/backend/database/repositories/assistant/TextAssistantSettingsRepository";
import { TaskRepository } from "@/backend/database/repositories/TaskRepository";
import { WikiRepository } from "@/backend/database/repositories/WikiRepository";
import { AssistantHistoryScheduler } from "@/backend/service/assistant/AssistantHistoryScheduler";
import { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import { TextAssistantContextService } from "@/backend/service/assistant/TextAssistantContextService";
import { TextAssistantService } from "@/backend/service/assistant/TextAssistantService";
import { TaskAccessGuard } from "@/backend/service/task/TaskAccessGuard";
import { WikiAccess } from "@/backend/service/wiki/WikiAccess";
import { WikiPageReader } from "@/backend/service/wiki/WikiPageReader";

import type { Database } from "@/backend/database/Database";
import type { PermissionService } from "@/backend/auth/PermissionService";
import type { ProjectService } from "@/backend/service/ProjectService";
import type { AgentApplicationServices } from "./agent-services.server";

/** Text generation and private-history lifecycle, built from existing access policies. */
export interface TextAssistantApplicationServices {
  readonly textAssistantService: TextAssistantService;
  readonly assistantHistoryScheduler: AssistantHistoryScheduler;
}

/** Does not execute a provider request or create a conversation at initialization. */
export function createTextAssistantServices(input: {
  readonly database: Database;
  readonly projectService: ProjectService;
  readonly permissions: PermissionService;
  readonly agents: AgentApplicationServices;
}): TextAssistantApplicationServices {
  const { database, projectService, permissions, agents } = input;
  const conversations = new AssistantConversationRepository(database);
  return {
    assistantHistoryScheduler: new AssistantHistoryScheduler(conversations),
    textAssistantService: new TextAssistantService({
      roles: agents.textAgentRoleService,
      execution: agents.agentTextExecution,
      requests: new AssistantRequestRegistry(),
      settings: new TextAssistantSettingsRepository(database),
      conversations,
      contexts: new TextAssistantContextService(
        new WikiAccess(projectService, permissions),
        new WikiPageReader(new WikiRepository(database)),
        new TaskAccessGuard(
          new TaskRepository(database),
          projectService,
          permissions,
        ),
      ),
    }),
  };
}
