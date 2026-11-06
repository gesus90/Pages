import type { Database } from "@/backend/database/Database";

/** The PostgreSQL channel of committed Pages events between processes. */
export const LIVE_CHANGE_CHANNEL = "pages_live_changes";

/** Sends committed Pages events to the other processes of the instance. */
export class LiveChangeNotificationRepository {
  private readonly database: Database;

  /**
   * Creates the repository.
   *
   * @param database - The open database.
   */
  public constructor(database: Database) {
    this.database = database;
  }

  /**
   * Notifies every listening session; PostgreSQL drops it when nobody listens.
   *
   * @param payload - Event type, id and audience as JSON, never content.
   */
  public async notify(payload: string): Promise<void> {
    await this.database.execute(
      `
        SELECT pg_notify($channel, $payload);
      `,
      { channel: LIVE_CHANGE_CHANNEL, payload },
    );
  }
}
