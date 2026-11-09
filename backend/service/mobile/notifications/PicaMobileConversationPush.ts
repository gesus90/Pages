import { withBackgroundDatabaseWork } from "@/backend/database/executor/DatabaseWorkContext";
import { logCaughtError, logEvent } from "@/backend/logging/Logger";

import { buildPicaMobileConversationPushMessage } from "./PicaMobileConversationPushMessage";

import type { PushRegistrationRecord } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type { PicaMobilePushRegistrationRepository } from "@/backend/database/repositories/mobile/PicaMobilePushRegistrationRepository";
import type {
  ConversationEvent,
  ConversationEvents,
} from "@/backend/service/conversation/ConversationEvents";
import type {
  ConversationKind,
  ConversationMessage,
} from "@/definition/Conversation";
import type { PicaMobileConversationPresence } from "../conversations/PicaMobileConversationPresence";
import type { PicaMobileAccountChecks } from "./PicaMobileAccountChecks";
import type { PicaMobilePushSender } from "./PicaMobilePushSender";
import type { PicaMobilePushTokenVault } from "./PicaMobilePushTokenVault";

/** The facts of a conversation a push names. */
export interface PicaMobilePushConversation {
  readonly kind: ConversationKind;
  readonly name: string;
}

/** What the push of new conversation messages is built from. */
export interface PicaMobileConversationPushOptions {
  readonly registrations: Pick<
    PicaMobilePushRegistrationRepository,
    "listActivated"
  >;
  readonly accounts: PicaMobileAccountChecks;
  readonly vault: Pick<PicaMobilePushTokenVault, "decrypt">;
  /** `null` while no sender is configured: nothing is handed over then. */
  readonly sender: PicaMobilePushSender | null;
  readonly instanceId: () => Promise<string>;
  /** The members who muted a conversation. */
  readonly mutedMemberIds: (
    conversationId: string,
  ) => Promise<ReadonlySet<string>>;
  /** Kind and name of a conversation, read as one of its members sees it. */
  readonly conversation: (
    conversationId: string,
    memberId: string,
  ) => Promise<PicaMobilePushConversation | null>;
  readonly presence: Pick<PicaMobileConversationPresence, "isOpen">;
  /** Seconds the push service may still hold a push. */
  readonly ttlSeconds: number;
}

type MessageEvent = Extract<ConversationEvent, { readonly kind: "message" }>;

const COMPONENT = "PicaMobileConversationPush";

/**
 * Sends a push for every new message of a conversation to the registered
 * devices of its other members (PAGE-278).
 *
 * @remarks
 * Nobody receives a push for an own message, for a conversation they muted,
 * or while a Pica Mobile connection of theirs shows the conversation. Before
 * each push the registration's session and account are checked again, as
 * for the pushes of runs. A push service that is missing, slow or failing
 * changes no message; a push that fails is not repeated, because the message
 * waits in the conversation anyway. Every handover is logged without token
 * or text.
 */
export class PicaMobileConversationPush {
  private readonly options: PicaMobileConversationPushOptions;

  /**
   * Creates the push.
   *
   * @param options - Registrations, checks, the sender and the presence.
   */
  public constructor(options: PicaMobileConversationPushOptions) {
    this.options = options;
  }

  /**
   * Follows the new messages of conversations.
   *
   * @param events - The in-process channel of committed conversation changes.
   * @returns Stops following.
   */
  public follow(events: Pick<ConversationEvents, "subscribe">): () => void {
    return events.subscribe((event) => {
      if (event.kind !== "message") return;
      void withBackgroundDatabaseWork("pica_mobile_conversation_push", () =>
        this.deliver(event),
      ).catch((error: unknown) => {
        logCaughtError(COMPONENT, error);
      });
    });
  }

  /**
   * Hands the pushes of one new message to the push service.
   *
   * @param event - The committed message and its members.
   */
  public async deliver(event: MessageEvent): Promise<void> {
    const { message } = event;
    const muted = await this.options.mutedMemberIds(message.conversationId);
    const recipients = event.recipientIds.filter(
      (id) =>
        id !== message.sender.id &&
        !muted.has(id) &&
        !this.options.presence.isOpen(id, message.conversationId),
    );
    if (recipients.length === 0) return;
    const conversation = await this.options.conversation(
      message.conversationId,
      message.sender.id,
    );
    if (conversation === null) return;
    for (const recipientId of recipients)
      await this.deliverTo(recipientId, { message, conversation });
  }

  private async deliverTo(
    recipientId: string,
    push: {
      readonly message: ConversationMessage;
      readonly conversation: PicaMobilePushConversation;
    },
  ): Promise<void> {
    const registrations =
      await this.options.registrations.listActivated(recipientId);
    for (const registration of registrations) {
      if (
        !(await this.options.accounts.isBindingValid(
          recipientId,
          registration.sessionId,
        ))
      )
        continue;
      await this.handOver(registration, push);
    }
  }

  private async handOver(
    registration: PushRegistrationRecord,
    push: {
      readonly message: ConversationMessage;
      readonly conversation: PicaMobilePushConversation;
    },
  ): Promise<void> {
    const { message, conversation } = push;
    const token = this.options.vault.decrypt(
      registration.deviceId,
      registration.tokenEncrypted,
    );
    if (token === null) return;
    const pushMessage = buildPicaMobileConversationPushMessage({
      token,
      instanceId: await this.options.instanceId(),
      accountId: registration.accountId,
      conversationId: message.conversationId,
      messageId: message.id,
      createdAt: message.createdAt,
      locale: registration.locale,
      preview: registration.preview,
      senderName: message.sender.name,
      groupName: conversation.kind === "group" ? conversation.name : null,
      isVoice: message.voice !== undefined,
      ttlSeconds: this.options.ttlSeconds,
    });
    const { sender } = this.options;
    const outcome =
      sender !== null && (await sender.ready())
        ? (await sender.send(pushMessage)).kind
        : "push_unavailable";
    logEvent({
      level: "info",
      event: "pica_mobile.conversation_push.handed_over",
      component: COMPONENT,
      message: "Pica Mobile push of a conversation message handed over",
      metadata: {
        userId: registration.accountId,
        messageId: message.id,
        kind: pushMessage.channelId,
        status: outcome,
      },
    });
  }
}
