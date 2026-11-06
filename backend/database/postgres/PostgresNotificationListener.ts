import { Client } from "pg";

import { logEvent } from "@/backend/logging/Logger";
import { registerLogSecret } from "@/backend/logging/LogRedaction";

const FIRST_RECONNECT_MILLISECONDS = 2000;
const MAXIMUM_RECONNECT_MILLISECONDS = 60_000;

/** What one listening session reports. */
export interface PostgresNotificationHandlers {
  /** One `NOTIFY` payload of the channel. */
  readonly onMessage: (payload: string) => void;
  /**
   * The session listens, the first time or again after a loss or a failed
   * attempt; notifications sent before it are gone.
   */
  readonly onListening: () => void;
}

/**
 * One dedicated PostgreSQL session that `LISTEN`s on a channel and comes back after a loss.
 *
 * @remarks
 * PostgreSQL does not keep notifications for a session that is gone or not
 * yet listening, so every successful `LISTEN` is reported, the first one
 * included, and the receiver catches up on its own.
 */
export class PostgresNotificationListener {
  private readonly databaseUrl: string;
  private readonly channel: string;
  private readonly handlers: PostgresNotificationHandlers;
  private client: Client | null = null;
  private timer: NodeJS.Timeout | null = null;
  private wait = FIRST_RECONNECT_MILLISECONDS;
  private isStopped = false;

  /**
   * Creates the listener without connecting.
   *
   * @param databaseUrl - The instance's PostgreSQL URL.
   * @param channel - A fixed channel name owned by the caller, never input.
   * @param handlers - Receive payloads and reconnects.
   */
  public constructor(
    databaseUrl: string,
    channel: string,
    handlers: PostgresNotificationHandlers,
  ) {
    registerLogSecret(databaseUrl);
    const password = new URL(databaseUrl).password;
    registerLogSecret(password);
    registerLogSecret(decodeURIComponent(password));
    this.databaseUrl = databaseUrl;
    this.channel = channel;
    this.handlers = handlers;
  }

  /** Connects and listens; a failure is retried after a growing wait. */
  public start(): void {
    void this.connect();
  }

  /** Ends the session and stops reconnecting. */
  public async stop(): Promise<void> {
    this.isStopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    const client = this.client;
    this.client = null;
    await client?.end().catch(() => undefined);
  }

  private async connect(): Promise<void> {
    if (this.isStopped) return;
    const client = new Client({
      connectionString: this.databaseUrl,
      connectionTimeoutMillis: 10_000,
      keepAlive: true,
      application_name: "pages-live-changes",
    });
    let isLost = false;
    const lose = (): void => {
      if (isLost) return;
      isLost = true;
      if (this.client === client) this.client = null;
      void client.end().catch(() => undefined);
      this.retry();
    };
    client.on("error", lose);
    client.on("end", lose);
    client.on("notification", (message) => {
      if (message.channel === this.channel && message.payload !== undefined)
        this.handlers.onMessage(message.payload);
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${this.channel};`);
    } catch {
      lose();
      return;
    }
    if (this.isStopped || isLost) {
      // Stopped while connecting: the session must not outlive the stop.
      isLost = true;
      await client.end().catch(() => undefined);
      return;
    }
    this.client = client;
    this.wait = FIRST_RECONNECT_MILLISECONDS;
    this.handlers.onListening();
  }

  private retry(): void {
    if (this.isStopped || this.timer !== null) return;
    logEvent({
      level: "warn",
      event: "live_changes.listener_lost",
      component: "PostgresNotificationListener",
      message: "The live change session was lost; it connects again",
    });
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, this.wait);
    this.timer.unref();
    this.wait = Math.min(this.wait * 2, MAXIMUM_RECONNECT_MILLISECONDS);
  }
}
