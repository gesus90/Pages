import { z } from "zod";

import { accountClaudeUsage } from "@/backend/service/agents/sessions/ClaudeUsageAccounting";
import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { AgentSessionRepository } from "@/backend/database/repositories/agent/AgentSessionRepository";
import { LocalSessionRepository } from "@/backend/database/repositories/agent/LocalSessionRepository";
import { requireAgentFiles } from "@/backend/storage/AgentPayloadFileStore";

import { localMutationSchema } from "./LocalSessionContracts";

import type { Database } from "@/backend/database/Database";
import type { LocalSessionEntry } from "@/backend/database/repositories/agent/LocalSessionRepository";
import type {
  LocalJournalRecord,
  LocalSessionMutation,
} from "./LocalSessionContracts";
import type { LocalSessionJournal } from "./LocalSessionJournal";

const checkpointSchema = z.array(localMutationSchema).max(16);

/** Replays file custody into the existing public session storage before acknowledging it. */
export class LocalSessionImport {
  private readonly database: Database;
  private readonly owners: LocalSessionRepository;
  private readonly journal: LocalSessionJournal;
  private readonly token: string;
  private entry: LocalSessionEntry;
  private checkpoint: LocalSessionMutation[] = [];
  private readonly writes = new SerialQueue();

  public constructor(input: {
    readonly database: Database;
    readonly owners: LocalSessionRepository;
    readonly entry: LocalSessionEntry;
    readonly journal: LocalSessionJournal;
    readonly token: string;
  }) {
    this.database = input.database;
    this.owners = input.owners;
    this.entry = input.entry;
    this.journal = input.journal;
    this.token = input.token;
  }

  /** Restores native milestones/results without reissuing any protocol request. */
  public async restore(): Promise<readonly LocalSessionMutation[]> {
    return this.writes.run(() => this.restoreOnce());
  }

  /** Rechecks an uncertain cursor commit; published events are deduplicated before replay. */
  public async refresh(): Promise<readonly LocalSessionMutation[]> {
    return this.writes.run(async () => {
      const current = (await this.owners.list(this.entry.instanceKey)).find(
        (entry) => entry.instanceId === this.entry.instanceId,
      );
      if (!current) throw new Error("Local owner metadata disappeared");
      const checkpoint = await this.readCheckpoint(current);
      this.entry = current;
      this.checkpoint = checkpoint;
      return checkpoint;
    });
  }

  /** The database cursor, rather than an in-memory or lost transport ACK, controls replay. */
  public get cursor(): number {
    return this.entry.acknowledgedSequence;
  }

  /** Repeats the committed acknowledgement after a transport loss without replaying its public effects. */
  public get acknowledgement(): {
    readonly sequence: number;
    readonly digest: string;
  } {
    return {
      sequence: this.entry.acknowledgedSequence,
      digest: this.entry.acknowledgedDigest,
    };
  }

  /** Imports one consecutive record. Every operation is idempotent across a commit/ACK crash. */
  public async take(record: LocalJournalRecord): Promise<LocalSessionMutation> {
    return this.writes.run(() => this.takeOnce(record));
  }

  private async restoreOnce(): Promise<readonly LocalSessionMutation[]> {
    this.checkpoint = await this.readCheckpoint(this.entry);
    return this.checkpoint;
  }

  private async readCheckpoint(
    entry: LocalSessionEntry,
  ): Promise<LocalSessionMutation[]> {
    if (!entry.checkpointFile) return [];
    return checkpointSchema.parse(
      JSON.parse(
        await requireAgentFiles(this.database).read(entry.checkpointFile),
      ),
    );
  }

  private async takeOnce(
    record: LocalJournalRecord,
  ): Promise<LocalSessionMutation> {
    if (
      record.sequence !== this.entry.acknowledgedSequence + 1 ||
      record.previousDigest !== this.entry.acknowledgedDigest
    )
      throw new Error("Local session import sequence mismatch");
    const mutation = await this.journal.body(record);
    const checkpoint = ["attempt", "events", "usage", "frame"].includes(
      mutation.kind,
    )
      ? this.checkpoint
      : [
          ...this.checkpoint.filter((entry) => entry.kind !== mutation.kind),
          mutation,
        ];
    const run = await this.database.query(
      "SELECT plan_id FROM agent_plan_runs WHERE id = $run_id;",
      { run_id: this.entry.runId },
    );
    const planId = run[0]?.[0];
    if (typeof planId !== "string")
      throw new Error("Local session run is missing");
    const checkpointFile = await requireAgentFiles(this.database).write(
      planId,
      JSON.stringify(checkpoint),
    );
    await this.database.transaction(async (transaction) => {
      const owners = new LocalSessionRepository(transaction);
      await owners.requireImporter(this.entry, this.token);
      const sessions = new AgentSessionRepository({
        ...transaction,
        transaction: (work) => work(transaction),
      });
      if (
        mutation.kind === "usage" &&
        mutation.usage.provider === "claude_code"
      ) {
        await this.requireAttempt(mutation.usage.attemptId, sessions);
        await accountClaudeUsage(
          { ...transaction, transaction: (work) => work(transaction) },
          mutation.usage,
        );
      } else await this.persist(mutation, record.sequence, sessions);
      if (mutation.kind === "turn")
        await owners.saveResult(
          this.entry.instanceId,
          mutation.turnId,
          record.payload,
        );
      await owners.acknowledge(this.entry, {
        sequence: record.sequence,
        digest: record.digest,
        checkpointFile,
        token: this.token,
      });
    });
    this.checkpoint = checkpoint;
    this.entry = {
      ...this.entry,
      acknowledgedSequence: record.sequence,
      acknowledgedDigest: record.digest,
      checkpointFile,
    };
    return mutation;
  }

  private async persist(
    mutation: LocalSessionMutation,
    sequence: number,
    sessions: AgentSessionRepository,
  ): Promise<void> {
    if (mutation.kind === "attempt") {
      this.requireBinding(
        mutation.attempt.key.runId,
        mutation.attempt.instanceId,
      );
      await sessions.saveAttempt(mutation.attempt);
    } else if (mutation.kind === "events") {
      await this.requireAttempt(mutation.attemptId, sessions);
      await sessions.appendEvents(
        mutation.attemptId,
        mutation.events.map((event, index) => ({
          ...event,
          dedupeKey:
            event.dedupeKey === null
              ? `local:${this.entry.instanceId}:${sequence}:${index}`
              : `local:${this.entry.instanceId}:${event.dedupeKey}`,
        })),
        mutation.retain,
      );
    } else if (mutation.kind === "usage") {
      await this.requireAttempt(mutation.usage.attemptId, sessions);
      await sessions.saveTurnUsage(mutation.usage);
    } else if (mutation.kind === "turn")
      await this.requireAttempt(mutation.attemptId, sessions);
  }

  private requireBinding(runId: string, instanceId: string): void {
    if (runId !== this.entry.runId || instanceId !== this.entry.instanceId)
      throw new Error("Foreign attempt in local session journal");
  }

  private async requireAttempt(
    attemptId: string,
    sessions: AgentSessionRepository,
  ): Promise<void> {
    const attempt = await sessions.findAttempt(attemptId);
    if (!attempt) throw new Error("Unknown local journal attempt");
    this.requireBinding(attempt.key.runId, attempt.instanceId);
  }
}
