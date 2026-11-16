/** How long one browser heartbeat keeps a chat visible. */
export const BROWSER_PRESENCE_MILLISECONDS = 45_000;

/** The browser tabs presence holds per account; a new tab beyond it pushes out the longest unrenewed one. */
export const BROWSER_CONNECTIONS_PER_ACCOUNT = 20;

/**
 * Which conversation each Pica Mobile connection and browser tab shows.
 * @remarks
 * A connection opens a conversation by reading its newest messages, sending
 * to it or marking it read, and leaves it by reading the list or closing.
 * Browser tabs renew every 20 seconds and expire after 45 seconds. While a
 * connection or tab shows a conversation, a new message sends no push. Every
 * heartbeat drops the expired tabs of its account, and an account keeps at
 * most {@link BROWSER_CONNECTIONS_PER_ACCOUNT} tabs: a renewed tab moves to
 * the end, so the tab renewed longest ago leaves first.
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
    const now = this.now();
    const connections = this.browser.get(userId) ?? new Map();
    for (const [id, entry] of connections)
      if (entry.expiresAt <= now) connections.delete(id);
    connections.delete(connectionId);
    if (chatKey !== null) {
      for (const oldest of connections.keys()) {
        if (connections.size < BROWSER_CONNECTIONS_PER_ACCOUNT) break;
        connections.delete(oldest);
      }
      connections.set(connectionId, {
        chatKey,
        conversationId,
        expiresAt: now + BROWSER_PRESENCE_MILLISECONDS,
      });
    }
    if (connections.size === 0) this.browser.delete(userId);
    else this.browser.set(userId, connections);
  }

  /** Counts the browser tabs of an account that presence still holds, expired ones included. */
  public browserConnectionCount(userId: string): number {
    return this.browser.get(userId)?.size ?? 0;
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
 * @returns The same presence on every call.
 */
export function sharedPicaMobileConversationPresence(): PicaMobileConversationPresence {
  globalThis.pagesPicaMobileConversationPresence ??=
    new PicaMobileConversationPresence();
  return globalThis.pagesPicaMobileConversationPresence;
}
