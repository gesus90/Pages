/**
 * Which conversation each Pica Mobile connection has open right now (PAGE-278).
 *
 * @remarks
 * A connection opens a conversation by reading its newest messages, sending
 * to it or marking it read, and leaves it by reading the list or closing.
 * While a conversation is open on a connection of an account, a new message
 * in it sends that account no push.
 */
export class PicaMobileConversationPresence {
  private readonly open = new Map<string, Map<string, string>>();

  /**
   * Notes the conversation a connection shows; `null` when it shows none.
   *
   * @param userId - The account of the connection.
   * @param connectionId - The connection.
   * @param conversationId - The open conversation, or `null`.
   */
  public set(
    userId: string,
    connectionId: string,
    conversationId: string | null,
  ): void {
    const connections = this.open.get(userId) ?? new Map<string, string>();
    if (conversationId === null) connections.delete(connectionId);
    else connections.set(connectionId, conversationId);
    if (connections.size === 0) this.open.delete(userId);
    else this.open.set(userId, connections);
  }

  /** Tells whether a connection of the account shows the conversation right now. */
  public isOpen(userId: string, conversationId: string): boolean {
    for (const open of this.open.get(userId)?.values() ?? [])
      if (open === conversationId) return true;
    return false;
  }
}

declare global {
  var pagesPicaMobileConversationPresence:
    PicaMobileConversationPresence | undefined;
}

/**
 * The one presence of the process, shared by the connections and the push.
 *
 * @returns The same presence on every call.
 */
export function sharedPicaMobileConversationPresence(): PicaMobileConversationPresence {
  globalThis.pagesPicaMobileConversationPresence ??=
    new PicaMobileConversationPresence();
  return globalThis.pagesPicaMobileConversationPresence;
}
