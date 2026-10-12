import path from "node:path";

import { ChatAttachmentRepository } from "@/backend/database/repositories/chat/ChatAttachmentRepository";
import { ChatSessionRepository } from "@/backend/database/repositories/chat/ChatSessionRepository";
import { ChatSettingsRepository } from "@/backend/database/repositories/chat/ChatSettingsRepository";
import { UserSettingsRepository } from "@/backend/database/repositories/UserSettingsRepository";
import { ChatAttachmentService } from "@/backend/service/chat/ChatAttachmentService";
import { ChatService } from "@/backend/service/chat/ChatService";
import { ChatSessionService } from "@/backend/service/chat/ChatSessionService";
import { ChatSettingsService } from "@/backend/service/chat/ChatSettingsService";
import { ChatToolExecutor } from "@/backend/service/chat/ChatToolExecutor";
import { AgentIdentityService } from "@/backend/service/mcp/AgentIdentityService";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import { isSafeSvg } from "./settings-actions/svg-safety.server";

import type { Database } from "@/backend/database/Database";
import type { AdministrationService } from "@/backend/service/AdministrationService";
import type { UserService } from "@/backend/service/UserService";
import type { AgentOperationRouter } from "@/backend/service/agents/AgentOperationRouter";
import type { TextExecution } from "@/backend/agents/TextExecution";
import type { AssistantRequestRegistry } from "@/backend/service/assistant/AssistantRequestRegistry";
import type { AgentProfileService } from "@/backend/service/agents/AgentProfileService";

/** The global chat agent Pica: sessions, attachments, settings and turns (A11.4). */
export interface ChatApplicationServices {
  readonly chatService: ChatService;
  readonly chatSessionService: ChatSessionService;
  readonly chatAttachmentService: ChatAttachmentService;
  readonly chatSettingsService: ChatSettingsService;
}

/** Wires the chat on the shared database; nothing runs until a person sends a message. */
export function createChatServices(input: {
  readonly database: Database;
  /** Directory next to the database; attachments live in its `chat-attachments`. */
  readonly directory: string;
  readonly accounts: {
    readonly users: Pick<UserService, "getById">;
    readonly administration: Pick<AdministrationService, "getContext">;
  };
  readonly agents: {
    readonly agentProfileService: Pick<AgentProfileService, "resolve">;
    readonly agentChatExecution: TextExecution;
    readonly chatRequests: AssistantRequestRegistry;
  };
  readonly router: AgentOperationRouter;
}): ChatApplicationServices {
  const { database } = input;
  const sessions = new ChatSessionRepository(database);
  const attachments = new ChatAttachmentRepository(database);
  const languages = new UserSettingsRepository(database);
  const files = new WikiFileStore(
    path.join(input.directory, "chat-attachments"),
  );
  const chatSettingsService = new ChatSettingsService(
    new ChatSettingsRepository(database),
    input.accounts.administration,
  );
  const chatSessionService = new ChatSessionService({
    sessions,
    attachments,
    settings: chatSettingsService,
    languages,
    files,
  });
  const chatAttachmentService = new ChatAttachmentService({
    sessions,
    attachments,
    settings: chatSettingsService,
    files,
    isSafeSvg,
  });
  return {
    chatSessionService,
    chatAttachmentService,
    chatSettingsService,
    chatService: new ChatService({
      sessions: chatSessionService,
      messages: sessions,
      attachments: chatAttachmentService,
      settings: chatSettingsService,
      agents: input.agents.agentProfileService,
      execution: input.agents.agentChatExecution,
      tools: new ChatToolExecutor({
        router: input.router,
        identities: new AgentIdentityService(
          input.accounts.users,
          input.accounts.administration,
        ),
      }),
      requests: input.agents.chatRequests,
      languages,
    }),
  };
}
