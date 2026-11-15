/**
 * Which conversation each Pica Mobile connection and browser tab shows.
 *
 * @remarks
 * A connection opens a conversation by reading its newest messages, sending
 * to it or marking it read, and leaves it by reading the list or closing.
 * Browser tabs renew every 20 seconds and expire after 45 seconds. While a
 * connection or tab shows a conversation, a new message sends no push.
 */
export class PicaMobileConversationPresence {
  private readonly open = new Map<string, Map<string, string>>();
  private readonly browser = new Map<
    string,
    Map<
      string,
      {
        readonly chatKey: string;
        readonly conversationId: string | null;
        readonly expiresAt: number;
      }
    >
  >();
  private readonly now: () => number;

  /** Creates presence with a clock that tests can advance. */
  public constructor(now: () => number = Date.now) {
    this.now = now;
  }

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
    return this.visibleChats(userId).conversationIds.includes(conversationId);
  }

  /** Renews one visible browser tab, or removes its presence when hidden. */
  public setBrowser(
    userId: string,
    connectionId: string,
    chatKey: string | null,
    conversationId: string | null,
  ): void {
    const connections = this.browser.get(userId) ?? new Map();
    if (chatKey === null) connections.delete(connectionId);
    else
      connections.set(connectionId, {
        chatKey,
        conversationId,
        expiresAt: this.now() + 45_000,
      });
    if (connections.size === 0) this.browser.delete(userId);
    else this.browser.set(userId, connections);
  }

  /** Lists visible chats across browser tabs and mobile connections. */
  public visibleChats(userId: string): {
    readonly chatKeys: readonly string[];
    readonly conversationIds: readonly string[];
  } {
    const connections = this.browser.get(userId);
    const chatKeys: string[] = [];
    const conversationIds = [...(this.open.get(userId)?.values() ?? [])];
    for (const [connectionId, entry] of connections ?? []) {
      if (entry.expiresAt <= this.now()) {
        connections?.delete(connectionId);
        continue;
      }
      chatKeys.push(entry.chatKey);
      if (entry.conversationId !== null)
        conversationIds.push(entry.conversationId);
    }
    if (connections?.size === 0) this.browser.delete(userId);
    return { chatKeys, conversationIds };
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
