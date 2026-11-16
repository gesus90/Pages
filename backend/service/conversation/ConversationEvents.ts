import { logCaughtError } from "@/backend/logging/Logger";

import type { ConversationMessage } from "@/definition/Conversation";
import type {
  ConversationDelivery,
  LiveAnswerEventPayload,
} from "@/definition/ConversationLiveAnswer";

/**
 * A committed change of a conversation, as the process tells its listeners.
 * @remarks
 * `recipientIds` names the accounts that may learn of it: every member for a
 * message and a new conversation, the member alone for a read state or a
 * mute. `originId` names the Pica Mobile connection that caused the change,
 * which receives its own answer instead. `typing` tells every member that an
 * agent started or ended an answer; nothing is stored for it.
 * `answer` carries a part of an answer an agent is writing now:
 * its recipients are the members who may see that part, so a thought goes
 * only to the person of a direct chat or the owner of a group. Nothing is
 * stored for it either. `delivery` of a message says how a person sent it
 * while agents answered: into their running answers or after them.
 */
export type ConversationEvent =
  | {
      readonly kind: "message";
      readonly message: ConversationMessage;
      readonly recipientIds: readonly string[];
      readonly originId?: string;
      readonly delivery?: ConversationDelivery;
    }
  | {
      readonly kind: "message_updated";
      readonly message: ConversationMessage;
      readonly recipientIds: readonly string[];
      readonly originId?: string;
    }
  | {
      readonly kind: "conversation";
      readonly conversationId: string;
      readonly recipientIds: readonly string[];
      readonly originId?: string;
    }
  | {
      readonly kind: "typing";
      readonly conversationId: string;
      readonly participantId: string;
      readonly isTyping: boolean;
      readonly recipientIds: readonly string[];
      readonly originId?: string;
    }
  | {
      readonly kind: "answer";
      readonly payload: LiveAnswerEventPayload;
      readonly recipientIds: readonly string[];
      readonly originId?: string;
    }
  | {
      readonly kind: "read";
      readonly conversationId: string;
      readonly upToMessageId: string;
      readonly recipientIds: readonly string[];
      readonly originId?: string;
    };

/** Hears the committed changes of conversations. */
export type ConversationListener = (event: ConversationEvent) => void;

const COMPONENT = "ConversationEvents";

/**
 * The in-process channel of committed conversation changes.
 * @remarks
 * The Pica Mobile connections and the push of new messages listen here; the
 * web hears the same changes as `conversation.changed` through the live view.
 * A failing listener is logged and never undoes or delays the change.
 */
export class ConversationEvents {
  private readonly listeners = new Set<ConversationListener>();

  /**
   * Adds a listener.
   * @param listener - Called after every committed change.
   * @returns Removes the listener again.
   */
  public subscribe(listener: ConversationListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Tells every listener about a committed change.
   * @param event - The change; it has committed already.
   */
  public publish(event: ConversationEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error: unknown) {
        // A listener can start an answer; its failure must show in the log.
        logCaughtError(COMPONENT, error, "error");
      }
    }
  }
}

declare global {
  var pagesConversationEvents: ConversationEvents | undefined;
}

/**
 * The one channel of the process, shared by the services that write
 * conversations and the Pica Mobile gateway that follows them.
 * @returns The same channel on every call.
 */
export function sharedConversationEvents(): ConversationEvents {
  globalThis.pagesConversationEvents ??= new ConversationEvents();
  return globalThis.pagesConversationEvents;
}
