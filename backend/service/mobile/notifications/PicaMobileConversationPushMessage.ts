import type {
  PicaMobileNotificationLocale,
  PicaMobileNotificationPreview,
} from "@/definition/PicaMobileNotifications";
import type { PicaMobilePushMessage } from "./PicaMobilePushSender";

/** What the push of a new conversation message is built from. */
export interface PicaMobileConversationPushInput {
  readonly token: string;
  readonly instanceId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly messageId: string;
  /** ISO 8601 moment the message was stored. */
  readonly createdAt: string;
  readonly locale: PicaMobileNotificationLocale;
  /** `hidden` names nobody; `details` names sender and conversation. */
  readonly preview: PicaMobileNotificationPreview;
  readonly senderName: string;
  /** The group name, or `null` for a direct conversation, which the sender names. */
  readonly groupName: string | null;
  readonly isVoice: boolean;
  readonly ttlSeconds: number;
}

interface ConversationTexts {
  readonly hiddenTitle: string;
  readonly hiddenBody: string;
  readonly message: (sender: string) => string;
  readonly voice: (sender: string) => string;
}

const TEXTS: Readonly<Record<PicaMobileNotificationLocale, ConversationTexts>> =
  {
    de: {
      hiddenTitle: "Neue Nachricht",
      hiddenBody: "Zum Anzeigen der Details entsperren.",
      message: (sender) => `Nachricht von ${sender}`,
      voice: (sender) => `Sprachnachricht von ${sender}`,
    },
    en: {
      hiddenTitle: "New message",
      hiddenBody: "Unlock to view details.",
      message: (sender) => `Message from ${sender}`,
      voice: (sender) => `Voice message from ${sender}`,
    },
  };

const MAXIMUM_NAME_LENGTH = 80;
const ELLIPSIS = "…";

/** Collapses white space, drops control characters and shortens to whole characters. */
function clean(text: string): string {
  const collapsed = text
    .replace(/[\p{C}\p{Zl}\p{Zp}]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const characters = Array.from(collapsed);
  return characters.length <= MAXIMUM_NAME_LENGTH
    ? collapsed
    : `${characters.slice(0, MAXIMUM_NAME_LENGTH - 1).join("")}${ELLIPSIS}`;
}

/**
 * Builds the push of a new message of a conversation for one device (PAGE-278).
 *
 * @param input - Message identity, names, language and the device's choice.
 * @returns The message. With `details` the title names the conversation, the
 * group or the sender of a direct conversation, and the body the sender; with
 * `hidden` both are generic. The text of the message never enters a push.
 *
 * @remarks
 * The `data` part holds only identifiers, so the app opens the conversation
 * from it. The tag is the conversation, so a newer push of the same
 * conversation replaces the older one on the device.
 */
export function buildPicaMobileConversationPushMessage(
  input: PicaMobileConversationPushInput,
): PicaMobilePushMessage {
  const texts = TEXTS[input.locale];
  const sender = clean(input.senderName);
  const hasDetails = input.preview === "details" && sender !== "";
  const tag = `conversation:${input.conversationId}`;
  const describe = input.isVoice ? texts.voice : texts.message;

  return {
    token: input.token,
    title: hasDetails ? clean(input.groupName ?? sender) : texts.hiddenTitle,
    body: hasDetails ? describe(sender) : texts.hiddenBody,
    data: {
      pica_v: "1",
      pica_type: "conversation_message",
      pica_instance: input.instanceId,
      pica_account: input.accountId,
      pica_conversation: input.conversationId,
      pica_message: input.messageId,
      pica_at: input.createdAt,
      tag,
    },
    channelId: "pica-conversation-messages",
    tag,
    ttlSeconds: input.ttlSeconds,
  };
}
