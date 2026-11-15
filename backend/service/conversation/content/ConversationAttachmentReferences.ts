import { CONVERSATION_ATTACHMENT_MAXIMUM_COUNT } from "@/definition/ConversationContent";

import {
  isConversationAttachmentExpired,
  toConversationAttachment,
} from "./ConversationAttachments";

import type {
  ConversationAttachmentLibraryRepository,
  StoredAttachmentReference,
  StoredLibraryAttachment,
} from "@/backend/database/repositories/conversation/ConversationAttachmentLibraryRepository";
import type { ConversationRepository } from "@/backend/database/repositories/conversation/ConversationRepository";
import type { ConversationAttachmentReference } from "@/definition/ConversationContent";
import type { ConversationDirectory } from "../ConversationDirectory";

/** A line that shows an earlier attachment again: `![description](anhang:<id>)`. */
const REFERENCE_LINE =
  /^\s*!\[[^\]\n]{0,500}\]\(anhang:([a-zA-Z0-9-]{1,100})\)\s*$/u;
const FENCE = /^\s*(```|~~~)/u;

/** Why a reference line was not shown, as the message says it. */
const REFUSALS = {
  missing: "in diesem Chat nicht vorhanden",
  tooMany: "höchstens 10 Verweise je Nachricht",
} as const;

/** A reference an answer will carry once it is stored. */
export interface PendingAttachmentReference {
  readonly attachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sourceMessageId: string;
  readonly sourceSenderId: string;
}

/** An answer without its reference lines, and the references they named. */
export interface AttachmentReferenceSelection {
  readonly text: string;
  readonly references: readonly PendingAttachmentReference[];
}

/** What the references use. */
export interface ConversationAttachmentReferencesDependencies {
  readonly library: Pick<
    ConversationAttachmentLibraryRepository,
    "attachment" | "insertReferences" | "referencesForMessages" | "findMany"
  >;
  readonly conversations: Pick<ConversationRepository, "findForMember">;
  readonly directory: Pick<ConversationDirectory, "read">;
  readonly now?: () => Date;
}

/**
 * The references of answers to earlier attachments of the same chat (PAGE-386).
 *
 * @remarks
 * An agent shows an earlier attachment again with a line
 * `![description](anhang:<id>)`, the identifier as the tool
 * `anhaenge_suchen` names it. Pages takes the line only when the agent is a
 * member of the chat now and the attachment belongs to a sent message of the
 * same chat; it never copies the file. The card shows the original with its
 * remaining time; an original that expired or was deleted with its message
 * shows the placeholder `abgelaufen` or `gelöscht`. A line that names no
 * attachment of the chat stays in the text with the reason. Lines inside code
 * blocks are text.
 */
export class ConversationAttachmentReferences {
  private readonly dependencies: ConversationAttachmentReferencesDependencies;

  public constructor(
    dependencies: ConversationAttachmentReferencesDependencies,
  ) {
    this.dependencies = dependencies;
  }

  /**
   * Reads the reference lines of an answer.
   *
   * @param conversationId - The chat the answer goes to.
   * @param agentId - The agent that writes it.
   * @param text - The answer.
   * @returns The text without the accepted lines and the references in their order.
   */
  public async select(
    conversationId: string,
    agentId: string,
    text: string,
  ): Promise<AttachmentReferenceSelection> {
    if (!text.includes("anhang:")) return { text, references: [] };
    const isMember =
      (await this.dependencies.conversations.findForMember(
        conversationId,
        agentId,
      )) !== null;
    const lines: string[] = [];
    const references: PendingAttachmentReference[] = [];
    let isCode = false;
    for (const line of text.split("\n")) {
      if (FENCE.test(line)) isCode = !isCode;
      const id = isCode ? null : (REFERENCE_LINE.exec(line)?.[1] ?? null);
      if (id === null) {
        lines.push(line);
        continue;
      }
      if (references.length >= CONVERSATION_ATTACHMENT_MAXIMUM_COUNT) {
        lines.push(
          `${line.trimEnd()} (Anhang nicht gezeigt: ${REFUSALS.tooMany})`,
        );
        continue;
      }
      const original = isMember
        ? await this.dependencies.library.attachment(conversationId, id)
        : null;
      if (!original) {
        lines.push(
          `${line.trimEnd()} (Anhang nicht gezeigt: ${REFUSALS.missing})`,
        );
        continue;
      }
      references.push(pendingOf(original));
    }
    return { text: lines.join("\n").trim(), references };
  }

  /**
   * Stores the references of a stored answer.
   *
   * @param message - The answer and its chat.
   * @param references - What {@link ConversationAttachmentReferences.select} returned.
   */
  public async bind(
    message: { readonly id: string; readonly conversationId: string },
    references: readonly PendingAttachmentReference[],
  ): Promise<void> {
    if (references.length === 0) return;
    const createdAt = (this.dependencies.now?.() ?? new Date()).toISOString();
    await this.dependencies.library.insertReferences(
      references.map((reference, position) => ({
        ...reference,
        messageId: message.id,
        conversationId: message.conversationId,
        position,
        createdAt,
      })),
    );
  }

  /**
   * The references of messages as every client sees them, by message ID.
   *
   * @param messageIds - The messages.
   */
  public async forMessages(
    messageIds: readonly string[],
  ): Promise<Map<string, ConversationAttachmentReference[]>> {
    const stored =
      await this.dependencies.library.referencesForMessages(messageIds);
    const result = new Map<string, ConversationAttachmentReference[]>();
    if (stored.size === 0) return result;
    const all = [...stored.values()].flat();
    const [originals, accounts] = await Promise.all([
      this.dependencies.library.findMany([
        ...new Set(all.map((entry) => entry.attachmentId)),
      ]),
      this.dependencies.directory.read(),
    ]);
    const now = this.dependencies.now?.() ?? new Date();
    for (const [messageId, references] of stored)
      result.set(
        messageId,
        references.map((reference) =>
          viewOf(reference, originals.get(reference.attachmentId), {
            now,
            senderName: (id) => accounts.participant(id).name,
          }),
        ),
      );
    return result;
  }
}

function pendingOf(
  original: StoredLibraryAttachment,
): PendingAttachmentReference {
  return {
    attachmentId: original.attachment.id,
    name: original.attachment.name,
    mimeType: original.attachment.mimeType,
    sourceMessageId: original.messageId,
    sourceSenderId: original.senderId,
  };
}

/** One stored reference as a client sees it, with the state of its original. */
function viewOf(
  reference: StoredAttachmentReference,
  original: StoredLibraryAttachment | undefined,
  context: { readonly now: Date; readonly senderName: (id: string) => string },
): ConversationAttachmentReference {
  // An original of another chat counts as deleted: references never cross chats.
  const isPresent =
    original !== undefined &&
    original.attachment.conversationId === reference.conversationId;
  const base = {
    attachmentId: reference.attachmentId,
    name: reference.name,
    sourceMessageId: reference.sourceMessageId,
    senderName: context.senderName(reference.sourceSenderId),
  };
  if (!isPresent) return { ...base, state: "deleted" };
  const attachment = toConversationAttachment(original.attachment);
  const isExpired = isConversationAttachmentExpired(
    original.attachment,
    context.now,
  );
  return {
    ...base,
    state: isExpired ? "expired" : "available",
    attachment:
      isExpired && attachment.expiredAt === undefined
        ? { ...attachment, expiredAt: context.now.toISOString() }
        : attachment,
    sentAt: original.sentAt,
  };
}
