import { PostgresSessionLock } from "@/backend/database/postgres/PostgresSessionLock";

// One owner per database, shared by both configured modes and GitHub and FCM consumers.
const ACQUIRE_OWNER = "SELECT pg_try_advisory_lock(1346455365, 225) AS owned;";

/** Holds delivery ownership until clean drain or PostgreSQL observes process death. */
export class IntegrationOwnerRepository {
  private readonly session: PostgresSessionLock;

  /** The loss callback must terminate dispatch; a disconnected owner cannot keep sending. */
  public constructor(databaseUrl: string, lost: () => void) {
    this.session = new PostgresSessionLock(databaseUrl, lost);
  }

  /** Attempts exclusive ownership without blocking the UI server. */
  public acquire(): Promise<boolean> {
    return this.session.acquire(ACQUIRE_OWNER);
  }
}
