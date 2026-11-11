import { CONVERSATION_AGENT_REPLY_PREFIX } from "@/definition/Conversation";

import type { ConversationMessage } from "@/definition/Conversation";
import type { ConversationEvents } from "./ConversationEvents";

/**
 * Hears the replies to the messages one agent sends, so `waitForReply` can
 * hand the reply back (PAGE-311).
 *
 * @remarks
 * It listens from its creation on, so a reply that is posted before the
 * sender asks for it is kept. Close it when the wait is over.
 */
export class AgentChatReplyWatch {
  private readonly replies = new Map<string, ConversationMessage>();
  private readonly waiters = new Map<
    string,
    (reply: ConversationMessage) => void
  >();
  private readonly stop: () => void;

  /**
   * Starts listening in a conversation.
   *
   * @param events - The in-process channel of committed messages.
   * @param conversationId - The conversation the message goes to.
   */
  public constructor(
    events: Pick<ConversationEvents, "subscribe">,
    conversationId: string,
  ) {
    this.stop = events.subscribe((event) => {
      if (event.kind !== "message") return;
      const { message } = event;
      if (message.conversationId !== conversationId) return;
      if (!message.clientMessageId.startsWith(CONVERSATION_AGENT_REPLY_PREFIX))
        return;
      const answered = message.clientMessageId.slice(
        CONVERSATION_AGENT_REPLY_PREFIX.length,
      );
      if (this.replies.has(answered)) return;
      this.replies.set(answered, message);
      this.waiters.get(answered)?.(message);
    });
  }

  /**
   * Waits for the reply to a message.
   *
   * @param messageId - The sent message.
   * @param limit - The longest wait in milliseconds and the signal that ends it.
   * @returns The reply, or `null` when none came in time or the wait was aborted.
   */
  public next(
    messageId: string,
    limit: { readonly milliseconds: number; readonly signal: AbortSignal },
  ): Promise<ConversationMessage | null> {
    const known = this.replies.get(messageId);
    if (known) return Promise.resolve(known);
    if (limit.signal.aborted) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = (reply: ConversationMessage | null): void => {
        clearTimeout(timer);
        limit.signal.removeEventListener("abort", onAbort);
        this.waiters.delete(messageId);
        resolve(reply);
      };
      const onAbort = (): void => {
        finish(null);
      };
      const timer = setTimeout(() => {
        finish(null);
      }, limit.milliseconds);
      timer.unref();
      limit.signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(messageId, finish);
    });
  }

  /** Stops listening. */
  public close(): void {
    this.stop();
    this.waiters.clear();
    this.replies.clear();
  }
}
