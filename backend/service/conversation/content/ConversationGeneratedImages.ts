import { CONVERSATION_ATTACHMENT_MAXIMUM_COUNT } from "@/definition/ConversationContent";

/**
 * The images an agent generated during its answer in a conversation, until
 * the answer is stored (PAGE-382).
 *
 * @remarks
 * The tool `bilder_erzeugen` stores each image as an attachment without a
 * message and notes it here; storing the answer takes the notes and binds
 * the images to it, so the agent never writes a path. An answer that is never
 * stored leaves its images to the sweep of unbound uploads. The notes live in
 * the process that runs the agent's answer, which is the one that stores it.
 */
export class ConversationGeneratedImages {
  private readonly pending = new Map<string, string[]>();

  /**
   * Notes generated images for the next answer of an agent in a conversation.
   *
   * @param target - The agent and the conversation.
   * @param attachmentIds - The stored images in their order.
   * @returns The IDs beyond the most attachments one message carries; they are not noted.
   */
  public add(
    target: { readonly agentId: string; readonly conversationId: string },
    attachmentIds: readonly string[],
  ): string[] {
    const key = keyOf(target);
    const known = this.pending.get(key) ?? [];
    const room = Math.max(
      0,
      CONVERSATION_ATTACHMENT_MAXIMUM_COUNT - known.length,
    );
    this.pending.set(key, [...known, ...attachmentIds.slice(0, room)]);
    return attachmentIds.slice(room);
  }

  /** How many images wait for the answer of an agent in a conversation. */
  public count(target: {
    readonly agentId: string;
    readonly conversationId: string;
  }): number {
    return this.pending.get(keyOf(target))?.length ?? 0;
  }

  /** Takes the noted images of an agent in a conversation; a second call returns none. */
  public take(target: {
    readonly agentId: string;
    readonly conversationId: string;
  }): string[] {
    const key = keyOf(target);
    const taken = this.pending.get(key) ?? [];
    this.pending.delete(key);
    return taken;
  }
}

function keyOf(target: {
  readonly agentId: string;
  readonly conversationId: string;
}): string {
  return `${target.agentId}\u0000${target.conversationId}`;
}

declare global {
  var pagesConversationGeneratedImages: ConversationGeneratedImages | undefined;
}

/** The notes of generated images every wiring of the process shares. */
export function sharedConversationGeneratedImages(): ConversationGeneratedImages {
  globalThis.pagesConversationGeneratedImages ??=
    new ConversationGeneratedImages();
  return globalThis.pagesConversationGeneratedImages;
}
