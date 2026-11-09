import path from "node:path";

import { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import { UserRepository } from "@/backend/database/repositories/UserRepository";
import { WikiLookupRepository } from "@/backend/database/repositories/wiki/WikiLookupRepository";
import { ConversationDirectory } from "@/backend/service/conversation/ConversationDirectory";
import { sharedConversationEvents } from "@/backend/service/conversation/ConversationEvents";
import { ConversationReader } from "@/backend/service/conversation/ConversationReader";
import { ConversationService } from "@/backend/service/conversation/ConversationService";
import { createConversationTranscriber } from "@/backend/service/conversation/ConversationTranscriber";
import { ConversationVoiceStore } from "@/backend/service/conversation/ConversationVoiceStore";
import { WikiFileStore } from "@/backend/storage/WikiFileStore";

import type { Database } from "@/backend/database/Database";
import type { PagesEventPublisher } from "@/backend/service/events/PagesEventPublisher";
import type { User } from "@/definition/User";

/** The stored conversations of the chat page and Pica Mobile (PAGE-278). */
export interface ConversationApplicationServices {
  readonly conversationReader: ConversationReader;
  readonly conversationService: ConversationService;
}

/** What the conversation services are built from. */
export interface ConversationServicesInput {
  readonly database: Database;
  /** The data directory; the audio of voice messages lies below it. */
  readonly directory: string;
  readonly events: PagesEventPublisher;
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
 * the audio of voice messages in the file store and the recognition of their
 * text.
 *
 * @param input - Database, data directory and the publisher of the live view.
 * @returns The reader and the writing service.
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
  return {
    conversationReader,
    conversationService: new ConversationService({
      conversations,
      messages,
      reader: conversationReader,
      directory,
      voices: new ConversationVoiceStore(files),
      files,
      transcriber: createConversationTranscriber(),
      events: sharedConversationEvents(),
      publisher: input.events,
    }),
  };
}
