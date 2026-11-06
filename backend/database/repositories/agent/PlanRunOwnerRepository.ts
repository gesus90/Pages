import { PostgresSessionLock } from "@/backend/database/postgres/PostgresSessionLock";

const ACQUIRE_OWNER = "SELECT pg_try_advisory_lock(1346455365, 226) AS owned;";

/** Exclusive process roles for the scheduler and API runner bridge. */
export class PlanRunOwnerRepository {
  private readonly session: PostgresSessionLock;
  private readonly statement: string;

  public constructor(
    databaseUrl: string,
    lost: () => void,
    role: "engine" | "api" = "engine",
  ) {
    this.statement =
      role === "engine"
        ? ACQUIRE_OWNER
        : "SELECT pg_try_advisory_lock(1346455365, 22601) AS owned;";
    this.session = new PostgresSessionLock(
      databaseUrl,
      lost,
      role === "engine" ? "pages-runs-owner" : "pages-runs-api-owner",
    );
  }

  /** Keeps ownership until process exit; loss must stop dispatch immediately. */
  public acquire(): Promise<boolean> {
    return this.session.acquire(this.statement);
  }
}
