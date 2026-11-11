import type { StoredConversationMessage } from "@/backend/database/repositories/conversation/ConversationMessageRepository";
import type {
  ConversationAttachment,
  ConversationLink,
} from "@/definition/ConversationContent";
import type { ConversationAttachments } from "./ConversationAttachments";
import type { ConversationLinks } from "./ConversationLinks";

/** The attachments and links of one message. */
export interface MessageContent {
  readonly attachments: readonly ConversationAttachment[];
  readonly links: readonly ConversationLink[];
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
 * Reads what a conversation message carries besides its text (PAGE-298):
 * its attachments, and the links that stand alone in a line of it.
 */
export class ConversationMessageContent implements ConversationMessageContentReader {
  private readonly attachments: Pick<ConversationAttachments, "forMessages">;
  private readonly links: Pick<ConversationLinks, "forMessages">;

  /**
   * Creates the reader.
   *
   * @param attachments - The attachments of messages.
   * @param links - The links of messages.
   */
  public constructor(
    attachments: Pick<ConversationAttachments, "forMessages">,
    links: Pick<ConversationLinks, "forMessages">,
  ) {
    this.attachments = attachments;
    this.links = links;
  }

  /**
   * Reads the attachments and links of messages.
   *
   * @param messages - The stored messages.
   * @returns The content by message ID; every message has an entry.
   */
  public async describe(
    messages: readonly StoredConversationMessage[],
  ): Promise<Map<string, MessageContent>> {
    const [attachments, links] = await Promise.all([
      this.attachments.forMessages(messages.map((message) => message.id)),
      // A hint of Pages in an agent's name links nothing.
      this.links.forMessages(
        messages.filter((message) => message.notice === null),
      ),
    ]);
    return new Map(
      messages.map((message) => [
        message.id,
        {
          attachments: attachments.get(message.id) ?? [],
          links: links.get(message.id) ?? [],
        },
      ]),
    );
  }
}
