import path from "node:path";

import { AgentChatSettingsRepository } from "@/backend/database/repositories/conversation/AgentChatSettingsRepository";
import { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import { ConversationAgentChatRepository } from "@/backend/database/repositories/conversation/ConversationAgentChatRepository";
import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { AgentChatService } from "@/backend/service/conversation/AgentChatService";
import { AgentChatSettingsService } from "@/backend/service/conversation/AgentChatSettingsService";
import { ConversationAgentGuard } from "@/backend/service/conversation/ConversationAgentGuard";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { ConversationOversight } from "@/backend/service/conversation/ConversationOversight";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import { ConversationService } from "@/backend/service/conversation/ConversationService";
import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";
import { voiceMaximumDurationMs } from "@/backend/config/SpeechRecognitionConfig";

import type { SpeechRecognitionSetting } from "@/backend/config/SpeechRecognitionConfig";
import type { Database } from "@/backend/database/Database";
import type { ConversationAgentRunner } from "@/backend/service/conversation/ConversationAgentReplies";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { User } from "@/definition/User";

/** The stored conversations of the chat page and Pica Mobile (PAGE-278). */
export interface ConversationApplicationServices {
  readonly conversationReader: ConversationReader;
  readonly conversationService: ConversationService;
  /** The answers of agents in conversations (PAGE-276). */
  readonly conversationAgentReplies: ConversationAgentReplies;
  /** The longest voice message Pages takes, in milliseconds (PAGE-277). */
  readonly conversationVoiceMaximumMs: number;
  /** The Pages tools with which agents read chats and send messages (PAGE-311). */
  readonly agentChatService: AgentChatService;
  /** The chain and hourly limits of the chat of agents, and the release of a paused one (PAGE-311). */
  readonly conversationAgentGuard: ConversationAgentGuard;
  /** Who reads the conversations that only agents take part in (PAGE-311). */
  readonly conversationOversight: ConversationOversight;
  /** The hourly limit under Settings → Agents (PAGE-311). */
  readonly agentChatSettingsService: AgentChatSettingsService;
}

/** What the conversation services are built from. */
export interface ConversationServicesInput {
  readonly database: Database;
  /** The data directory; the audio of voice messages lies below it. */
  readonly directory: string;
  readonly events: PagesEventPublisher;
  /** Runs the answers of agents (PAGE-276). */
  readonly runner: ConversationAgentRunner;
  /** The speech model and the longest recording of `config.toml` (PAGE-277). */
  readonly speech?: SpeechRecognitionSetting;
}

declare global {
  var pagesConversationAgentReplies: (() => void) | undefined;
}

/**
 * Tells the live view whether an account is a member of a conversation.
 *
 * @param database - The open database.
 * @returns The membership check of the live view.
 */
export function conversationMembership(database: Database): {
  isMember(actor: User, conversationId: string): Promise<boolean>;
} {
  const conversations = new ConversationRepository(database);
  return {
    isMember: async (actor, conversationId) =>
      (await conversations.findForMember(conversationId, actor.id)) !== null,
  };
}

/**
 * Wires the conversations on the shared database: their reads and writes,
 * the audio of voice messages in the file store, the recognition of their
 * text and the answers of agents, which follow the committed messages of the
 * process from now on; a second wiring replaces the first.
 *
 * @param input - Database, data directory, the publisher of the live view
 * and the runner of agent answers.
 * @returns The reader, the writing service and the agent answers.
 */
export function createConversationServices(
  input: ConversationServicesInput,
): ConversationApplicationServices {
  const { database } = input;
  const conversations = new ConversationRepository(database);
  const messages = new ConversationMessageRepository(database);
  const files = new WikiFileStore(
    path.join(input.directory, "conversation-voice"),
  );
  const store = new EmployeeStore(database);
  const directory = new ConversationDirectory({
    users: new UserRepository(database),
    lookups: new WikiLookupRepository(database),
    jobTitles: () => store.identities().jobTitles(),
  });
  const conversationReader = new ConversationReader({
    conversations,
    messages,
    directory,
    files,
  });
  const events = sharedConversationEvents();
  const agentChat = new ConversationAgentChatRepository(database);
  const agentChatSettings = new AgentChatSettingsRepository(database);
  const conversationOversight = new ConversationOversight({
    authorization: new AuthorizationRepository(database),
    chat: agentChat,
    reader: conversationReader,
  });
  const conversationAgentGuard = new ConversationAgentGuard({
    chat: agentChat,
    settings: agentChatSettings,
    members: conversationReader,
    oversight: conversationOversight,
    publisher: input.events,
  });
  const conversationAgentReplies = new ConversationAgentReplies({
    conversations,
    messages,
    directory,
    runner: input.runner,
    events,
    publisher: input.events,
    guard: conversationAgentGuard,
  });
  globalThis.pagesConversationAgentReplies?.();
  globalThis.pagesConversationAgentReplies = conversationAgentReplies.start();
  const conversationVoiceMaximumMs = voiceMaximumDurationMs(input.speech);
  const conversationService = new ConversationService({
    conversations,
    messages,
    reader: conversationReader,
    directory,
    voices: new ConversationVoiceStore(files, conversationVoiceMaximumMs),
    files,
    transcriber: createConversationTranscriber({ speech: input.speech }),
    events,
    publisher: input.events,
  });
  return {
    conversationReader,
    conversationAgentReplies,
    conversationVoiceMaximumMs,
    conversationService,
    conversationAgentGuard,
    agentChatSettingsService: new AgentChatSettingsService(agentChatSettings),
    conversationOversight,
    agentChatService: new AgentChatService({
      users: new UserRepository(database),
      groups: new UserGroupRepository(database),
      conversations,
      reader: conversationReader,
      service: conversationService,
      directory,
      guard: conversationAgentGuard,
      events,
    }),
  };
}
