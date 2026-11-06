import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";

import type { Database } from "@/backend/database/Database";
import type {
  AgentSessionAttemptRecord,
  NewAgentSessionEvent,
} from "@/backend/service/agents/sessions/AgentSessionStore";
import type {
  AgentSessionEvent,
  AgentSessionTurnUsage,
} from "@/definition/AgentSessionJournal";
import type { LocalSessionJournal } from "./LocalSessionJournal";

/** The real recorder writes to durable custody before the web process imports its public projection. */
export class LocalSessionOutbox extends AgentSessionRepository {
  private readonly journal: LocalSessionJournal;

  public constructor(database: Database, journal: LocalSessionJournal) {
    super(database);
    this.journal = journal;
  }

  /** Persists the complete attempt mutation before releasing recorder backpressure. */
  public override async saveAttempt(
    attempt: AgentSessionAttemptRecord,
  ): Promise<void> {
    await this.journal.append({ kind: "attempt", attempt });
  }

  /** Custody is durable here; only the importer publishes public events, so none are published twice. */
  public override async appendEvents(
    attemptId: string,
    events: readonly NewAgentSessionEvent[],
    retain: number,
  ): Promise<readonly AgentSessionEvent[]> {
    await this.journal.append({
      kind: "events",
      attemptId,
      events: [...events],
      retain,
    });
    return [];
  }

  /** A replay replaces a turn's usage; it never adds the same tokens twice. */
  public override async saveTurnUsage(
    usage: AgentSessionTurnUsage,
  ): Promise<void> {
    await this.journal.append({ kind: "usage", usage });
  }
}
