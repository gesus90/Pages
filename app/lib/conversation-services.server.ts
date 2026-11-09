import path from "node:path";

import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationAgentReplies } from "@/backend/service/conversation/ConversationAgentReplies";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import { ConversationService } from "@/backend/service/conversation/ConversationService";
import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

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
}

/** What the conversation services are built from. */
export interface ConversationServicesInput {
  readonly database: Database;
  /** The data directory; the audio of voice messages lies below it. */
  readonly directory: string;
  readonly events: PagesEventPublisher;
  /** Runs the answers of agents (PAGE-276). */
  readonly runner: ConversationAgentRunner;
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
  const conversationAgentReplies = new ConversationAgentReplies({
    conversations,
    messages,
    directory,
    runner: input.runner,
    events,
    publisher: input.events,
  });
  globalThis.pagesConversationAgentReplies?.();
  globalThis.pagesConversationAgentReplies = conversationAgentReplies.start();
  return {
    conversationReader,
    conversationAgentReplies,
    conversationService: new ConversationService({
      conversations,
      messages,
      reader: conversationReader,
      directory,
      voices: new ConversationVoiceStore(files),
      files,
      transcriber: createConversationTranscriber(),
      events,
      publisher: input.events,
    }),
  };
}
