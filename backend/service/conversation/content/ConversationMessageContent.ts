import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationAttachment,
  ConversationAttachmentReference,
  ConversationLink,
} from "@/definition/ConversationContent";
import type { ConversationAttachmentReferences } from "./ConversationAttachmentReferences";
import type { ConversationAttachments } from "./ConversationAttachments";
import type { ConversationLinks } from "./ConversationLinks";

/** The attachments and links of one message. */
export interface MessageContent {
  readonly attachments: readonly ConversationAttachment[];
  readonly links: readonly ConversationLink[];
  /** Earlier attachments of the chat the message shows again; missing without any. */
  readonly references?: readonly ConversationAttachmentReference[];
}

/** Reads the content of stored messages by message ID. */
export interface ConversationMessageContentReader {
  describe(
    messages: readonly StoredConversationMessage[],
  ): Promise<Map<string, MessageContent>>;
}

/** A message without files and links. */
export const EMPTY_MESSAGE_CONTENT: MessageContent = {
  attachments: [],
  links: [],
};

/**
 * Reads what a conversation message carries besides its text:
 * its attachments, and the links that stand alone in a line of it.
 */
export class ConversationMessageContent implements ConversationMessageContentReader {
  private readonly attachments: Pick<ConversationAttachments, "forMessages">;
  private readonly links: Pick<ConversationLinks, "forMessages">;
  private readonly references: Pick<
    ConversationAttachmentReferences,
    "forMessages"
  > | null;

  /**
   * Creates the reader.
   * @param attachments - The attachments of messages.
   * @param links - The links of messages.
   * @param references - The earlier attachments messages show again; none without it.
   */
  public constructor(
    attachments: Pick<ConversationAttachments, "forMessages">,
    links: Pick<ConversationLinks, "forMessages">,
    references: Pick<
      ConversationAttachmentReferences,
      "forMessages"
    > | null = null,
  ) {
    this.attachments = attachments;
    this.links = links;
    this.references = references;
  }

  /**
   * Reads the attachments and links of messages.
   * @param messages - The stored messages.
   * @returns The content by message ID; every message has an entry.
   */
  public async describe(
    messages: readonly StoredConversationMessage[],
  ): Promise<Map<string, MessageContent>> {
    const ids = messages.map((message) => message.id);
    const [attachments, links, references] = await Promise.all([
      this.attachments.forMessages(ids),
      // A hint of Pages in an agent's name links nothing.
      this.links.forMessages(
        messages.filter((message) => message.notice === null),
      ),
      this.references?.forMessages(ids) ??
        new Map<string, ConversationAttachmentReference[]>(),
    ]);
    return new Map(
      messages.map((message) => {
        const shown = references.get(message.id) ?? [];
        return [
          message.id,
          {
            attachments: attachments.get(message.id) ?? [],
            links: links.get(message.id) ?? [],
            ...(shown.length > 0 ? { references: shown } : {}),
          },
        ];
      }),
    );
  }
}
