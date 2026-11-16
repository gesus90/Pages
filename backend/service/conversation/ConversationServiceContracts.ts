import type { ConversationMessageRepository } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { PagesEvent } from "@/backend/service/events/PagesEventPublisher";
import type { WikiFileStore } from "@/backend/storage/WikiFileStore";
import type { ConversationKind } from "@/definition/Conversation";
import type { ConversationDelivery } from "@/definition/ConversationLiveAnswer";
import type { ConversationAttachments } from "./content/ConversationAttachments";
import type { ConversationDirectory } from "./ConversationDirectory";
import type { ConversationEvents } from "./ConversationEvents";
import type { ConversationReader } from "./ConversationReader";
import type { ConversationTranscriber } from "./ConversationTranscriber";
import type {
  ConversationVoiceIntent,
  ConversationVoiceStore,
} from "./ConversationVoiceStore";

/** What the writes of conversations use. */
export interface ConversationServiceDependencies {
  readonly conversations: ConversationRepository;
  readonly messages: ConversationMessageRepository;
  readonly reader: Pick<
    ConversationReader,
    "summary" | "readState" | "memberIds" | "messages"
  >;
  /** The files of messages. */
  readonly attachments: Pick<
    ConversationAttachments,
    "bind" | "collect" | "collectConversation"
  >;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly voices: ConversationVoiceStore;
  /** Opens stored audio for the recognition and removes the audio of a deleted conversation. */
  readonly files: Pick<WikiFileStore, "open" | "remove">;
  readonly transcriber: ConversationTranscriber;
  /** The in-process channel the Pica Mobile connections and the push follow. */
  readonly events: Pick<ConversationEvents, "publish">;
  /** Tells the live view of this process about a committed change. */
  readonly publisher: { publish(event: PagesEvent): void };
  readonly now?: () => Date;
  readonly createId?: () => string;
}

/** Who caused a change; the Pica Mobile connection receives its own answer instead of the event. */
export interface ConversationChangeOptions {
  readonly originId?: string;
  /**
   * How a person sent a message while agents answered: into their
   * running answers or after them; absent starts its round as before.
   */
  readonly delivery?: ConversationDelivery;
}

/** The raw input of a new conversation. */
export interface ConversationCreation {
  readonly kind: ConversationKind;
  readonly participantIds: readonly string[];
  readonly name?: string | null;
}

/** The raw input of a message. */
export interface ConversationSending {
  readonly conversationId: string;
  readonly clientMessageId: unknown;
  readonly text: unknown;
  /** The uploaded attachments the message carries, in their order. */
  readonly attachmentIds?: unknown;
}

/** A voice message announced for a conversation, whose audio has yet to arrive. */
export interface ConversationVoiceTicket {
  readonly conversationId: string;
  readonly clientMessageId: string;
  readonly intent: ConversationVoiceIntent;
}

/** A group of the web chat page that becomes a shared conversation. */
export interface ConversationGroupAdoption {
  readonly id: string;
  readonly name: string;
  readonly memberIds: readonly string[];
}
