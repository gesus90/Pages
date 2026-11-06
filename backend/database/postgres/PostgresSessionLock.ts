import { Client } from "pg";

import { registerLogSecret } from "@/backend/logging/LogRedaction";

/** Dedicated PostgreSQL session, never returned to a pool while it owns a lock. */
export class PostgresSessionLock {
  private readonly client: Client;
  private readonly lost: () => void;
  private timer: NodeJS.Timeout | null = null;
  private isClosing = false;

  /** Creates a session without connecting or logging connection material. */
  public constructor(
    databaseUrl: string,
    lost: () => void,
    applicationName = "pages-integrations-owner",
  ) {
    registerLogSecret(databaseUrl);
    const password = new URL(databaseUrl).password;
    registerLogSecret(password);
    registerLogSecret(decodeURIComponent(password));
    this.client = new Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 10_000,
      query_timeout: 10_000,
      keepAlive: true,
      application_name: applicationName,
    });
    this.lost = lost;
    this.client.on("error", () => this.onLost());
    this.client.on("end", () => this.onLost());
  }

  /** Acquires the repository's session lock, or closes the unsuccessful session. */
  public async acquire(statement: string): Promise<boolean> {
    try {
      await this.client.connect();
      const result = await this.client.query<{ owned: boolean }>(statement);
      if (result.rows[0]?.owned !== true) {
        await this.close();
        return false;
      }
      this.timer = setInterval(() => {
        void this.client.query("SELECT 1;").catch(() => this.onLost());
      }, 15_000);
      return true;
    } catch {
      await this.close();
      throw new Error("Integration ownership connection failed.");
    }
  }

  /** Releases ownership only after every consumer has drained. */
  public async close(): Promise<void> {
    this.isClosing = true;
    if (this.timer !== null) clearInterval(this.timer);
    await this.client.end();
  }

  private onLost(): void {
    if (!this.isClosing) this.lost();
  }
}
