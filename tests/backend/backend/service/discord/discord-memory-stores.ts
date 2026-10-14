import type {
  DiscordAttemptRecord,
  DiscordAttemptStore,
  NewDiscordAttempt,
} from "@/backend/database/repositories/discord/DiscordAttemptRepository";
import type {
  DiscordConnectionStore,
  NewDiscordConnection,
  StoredDiscordConnection,
} from "@/backend/database/repositories/discord/DiscordConnectionRepository";
import type {
  DiscordDeliveryRecord,
  DiscordDeliveryRetry,
  DiscordDeliveryStore,
  NewDiscordDelivery,
} from "@/backend/database/repositories/discord/DiscordDeliveryRepository";
import type {
  DiscordAttemptFailure,
  DiscordDeliverySummary,
  DiscordEventSelection,
  DiscordEventType,
  DiscordProblem,
} from "@/definition/Discord";

/** A mutable row of the outbox, as the table holds it. */
export interface StoredDelivery {
  id: string;
  projectId: string;
  eventType: DiscordEventType;
  subjectKey: string;
  contentJson: string;
  status: "pending" | "sending" | "sent" | "failed";
  attempts: number;
  nextAttemptAt: string;
  lockedUntil: string | null;
  lastProblem: DiscordProblem | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
}

/**
 * Connection attempts in memory, with the claiming rules of the SQL statements.
 *
 * @remarks
 * Only the storage is simulated. The OAuth state, the expiry and the
 * ownership checks are the real service logic.
 */
export class MemoryAttemptStore implements DiscordAttemptStore {
  public readonly rows = new Map<string, DiscordAttemptRecord>();

  /** Mirrors `insertAttempt` of the real repository. */
  public async insertAttempt(attempt: NewDiscordAttempt): Promise<void> {
    for (const row of this.rows.values()) {
      if (
        row.projectId === attempt.projectId &&
        row.userId === attempt.userId &&
        (row.status === "pending" || row.status === "authorized")
      ) {
        this.rows.set(row.id, { ...row, status: "cancelled" });
      }
    }

    this.rows.set(attempt.id, {
      ...attempt,
      consumedAt: null,
      failure: null,
      guildId: null,
      guildName: null,
      status: "pending",
    });
  }

  /** Mirrors `findAttempt` of the real repository. */
  public async findAttempt(id: string): Promise<DiscordAttemptRecord | null> {
    return this.rows.get(id) ?? null;
  }

  /** Mirrors `findAttemptByStateHash` of the real repository. */
  public async findAttemptByStateHash(
    stateHash: string,
  ): Promise<DiscordAttemptRecord | null> {
    return (
      [...this.rows.values()].find((row) => row.stateHash === stateHash) ?? null
    );
  }

  /** Mirrors `findLatestAttempt` of the real repository. */
  public async findLatestAttempt(
    projectId: string,
    userId: string,
  ): Promise<DiscordAttemptRecord | null> {
    const own = [...this.rows.values()]
      .reverse()
      .filter((row) => row.projectId === projectId && row.userId === userId)
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt));

    return own[0] ?? null;
  }

  /** Mirrors `claimByStateHash` of the real repository. */
  public async claimByStateHash(
    stateHash: string,
    now: string,
  ): Promise<DiscordAttemptRecord | null> {
    const row = await this.findAttemptByStateHash(stateHash);

    if (
      !row ||
      row.status !== "pending" ||
      row.consumedAt !== null ||
      row.expiresAt <= now
    ) {
      return null;
    }

    const claimed = { ...row, consumedAt: now };

    this.rows.set(row.id, claimed);

    return claimed;
  }

  /** Mirrors `recordAuthorization` of the real repository. */
  public async recordAuthorization(
    id: string,
    guild: { readonly id: string; readonly name: string },
  ): Promise<boolean> {
    return this.update(id, {
      guildId: guild.id,
      guildName: guild.name,
      status: "authorized",
    });
  }

  /** Mirrors `recordFailure` of the real repository. */
  public async recordFailure(
    id: string,
    failure: DiscordAttemptFailure,
  ): Promise<boolean> {
    return this.update(id, { failure, status: "failed" });
  }

  /** Mirrors `confirm` of the real repository. */
  public async confirm(id: string, now: string): Promise<boolean> {
    const row = this.rows.get(id);

    if (!row || row.status !== "authorized" || row.expiresAt <= now) {
      return false;
    }

    this.rows.set(id, { ...row, status: "confirmed" });

    return true;
  }

  /** Mirrors `cancel` of the real repository. */
  public async cancel(id: string): Promise<void> {
    const row = this.rows.get(id);

    if (row && (row.status === "pending" || row.status === "authorized")) {
      this.rows.set(id, { ...row, status: "cancelled" });
    }
  }

  /** Mirrors `deleteExpired` of the real repository. */
  public async deleteExpired(before: string): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.expiresAt < before) {
        this.rows.delete(row.id);
      }
    }
  }

  /** Changes a claimed, still pending attempt, as the guarded statements do. */
  private update(id: string, changes: Partial<DiscordAttemptRecord>): boolean {
    const row = this.rows.get(id);

    if (!row || row.status !== "pending" || row.consumedAt === null) {
      return false;
    }

    this.rows.set(id, { ...row, ...changes });

    return true;
  }
}

/** The outbox in memory, with the lock and retry rules of the SQL statements. */
export class MemoryDeliveryStore implements DiscordDeliveryStore {
  public readonly rows = new Map<string, StoredDelivery>();

  /** Mirrors `enqueueDelivery` of the real repository, including the merge into a waiting message. */
  public async enqueueDelivery(delivery: NewDiscordDelivery): Promise<void> {
    const waiting = [...this.rows.values()]
      .filter(
        (row) =>
          row.projectId === delivery.projectId &&
          row.subjectKey === delivery.subjectKey &&
          row.status === "pending",
      )
      .sort((first, second) =>
        first.createdAt.localeCompare(second.createdAt),
      )[0];

    if (
      waiting &&
      (waiting.eventType === delivery.eventType ||
        delivery.eventType.endsWith(".updated"))
    ) {
      waiting.contentJson = delivery.contentJson;
      waiting.updatedAt = delivery.now;

      return;
    }

    this.rows.set(delivery.id, {
      attempts: 0,
      contentJson: delivery.contentJson,
      createdAt: delivery.now,
      eventType: delivery.eventType,
      id: delivery.id,
      lastProblem: null,
      lockedUntil: null,
      nextAttemptAt: delivery.now,
      projectId: delivery.projectId,
      sentAt: null,
      status: "pending",
      subjectKey: delivery.subjectKey,
      updatedAt: delivery.now,
    });
  }

  /** Mirrors `claimDue` of the real repository. */
  public async claimDue(
    now: string,
    lockedUntil: string,
    limit: number,
  ): Promise<readonly DiscordDeliveryRecord[]> {
    const due = [...this.rows.values()]
      .filter((row) => row.status === "pending" && row.nextAttemptAt <= now)
      .sort((first, second) => first.createdAt.localeCompare(second.createdAt))
      .slice(0, limit);

    for (const row of due) {
      row.status = "sending";
      row.lockedUntil = lockedUntil;
      row.updatedAt = now;
    }

    return due.map((row) => ({
      attempts: row.attempts,
      contentJson: row.contentJson,
      createdAt: row.createdAt,
      eventType: row.eventType,
      id: row.id,
      projectId: row.projectId,
    }));
  }

  /** Mirrors `releaseExpiredLocks` of the real repository. */
  public async releaseExpiredLocks(now: string): Promise<void> {
    for (const row of this.rows.values()) {
      if (
        row.status === "sending" &&
        row.lockedUntil !== null &&
        row.lockedUntil < now
      ) {
        row.status = "pending";
        row.lockedUntil = null;
      }
    }
  }

  /** Mirrors `markSent` of the real repository. */
  public async markSent(id: string, now: string): Promise<void> {
    const row = this.rows.get(id);

    if (row) {
      Object.assign(row, {
        lastProblem: null,
        lockedUntil: null,
        sentAt: now,
        status: "sent",
        updatedAt: now,
      });
    }
  }

  /** Mirrors `discard` of the real repository. */
  public async discard(id: string): Promise<void> {
    this.rows.delete(id);
  }

  /** Mirrors `reschedule` of the real repository. */
  public async reschedule(
    id: string,
    retry: DiscordDeliveryRetry,
  ): Promise<void> {
    const row = this.rows.get(id);

    if (row) {
      Object.assign(row, {
        attempts: retry.attempts,
        lastProblem: retry.problem,
        lockedUntil: null,
        nextAttemptAt: retry.nextAttemptAt,
        status: "pending",
        updatedAt: retry.now,
      });
    }
  }

  /** Mirrors `markFailed` of the real repository. */
  public async markFailed(
    id: string,
    failure: {
      readonly attempts: number;
      readonly problem: DiscordProblem;
      readonly now: string;
    },
  ): Promise<void> {
    const row = this.rows.get(id);

    if (row) {
      Object.assign(row, {
        attempts: failure.attempts,
        lastProblem: failure.problem,
        lockedUntil: null,
        status: "failed",
        updatedAt: failure.now,
      });
    }
  }

  /** Mirrors `summarize` of the real repository. */
  public async summarize(projectId: string): Promise<DiscordDeliverySummary> {
    const own = [...this.rows.values()].filter(
      (row) => row.projectId === projectId,
    );
    const sent = own
      .map((row) => row.sentAt)
      .filter((time): time is string => time !== null)
      .sort();
    const lastSentAt = sent.at(-1) ?? null;
    const problem = own
      .filter(
        (row) =>
          row.lastProblem !== null &&
          (row.status === "pending" || row.status === "failed") &&
          row.updatedAt > (lastSentAt ?? ""),
      )
      .sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));

    return {
      failed: own.filter((row) => row.status === "failed").length,
      lastProblem: problem[0]?.lastProblem ?? null,
      lastSentAt,
      pending: own.filter(
        (row) => row.status === "pending" || row.status === "sending",
      ).length,
    };
  }

  /** Mirrors `purge` of the real repository. */
  public async purge(cutoffs: {
    readonly sentBefore: string;
    readonly failedBefore: string;
  }): Promise<void> {
    for (const row of this.rows.values()) {
      if (
        (row.status === "sent" && row.updatedAt < cutoffs.sentBefore) ||
        (row.status === "failed" && row.updatedAt < cutoffs.failedBefore)
      ) {
        this.rows.delete(row.id);
      }
    }
  }

  /** Removes every stored message of a project, as the disconnect does. */
  public dropAll(projectId: string): void {
    for (const row of this.rows.values()) {
      if (row.projectId === projectId) {
        this.rows.delete(row.id);
      }
    }
  }
}

/** The connections of projects in memory; a disconnect also drops every stored message. */
export class MemoryConnectionStore implements DiscordConnectionStore {
  public readonly rows = new Map<string, StoredDiscordConnection>();
  private readonly deliveries: MemoryDeliveryStore;

  /** Mirrors `constructor` of the real repository. */
  public constructor(deliveries: MemoryDeliveryStore) {
    this.deliveries = deliveries;
  }

  /** Mirrors `findConnection` of the real repository. */
  public async findConnection(
    projectId: string,
  ): Promise<StoredDiscordConnection | null> {
    return this.rows.get(projectId) ?? null;
  }

  /** Mirrors `saveConnection` of the real repository. */
  public async saveConnection(connection: NewDiscordConnection): Promise<void> {
    const existing = this.rows.get(connection.projectId);

    this.rows.set(connection.projectId, {
      baseUrl: connection.baseUrl,
      channelId: connection.channelId,
      channelName: connection.channelName,
      connectedAt: existing?.connectedAt ?? connection.now,
      connectedBy: connection.connectedBy,
      events: connection.events,
      guildId: connection.guildId,
      guildName: connection.guildName,
      projectId: connection.projectId,
      updatedAt: connection.now,
    });
  }

  /** Mirrors `updateChannel` of the real repository. */
  public async updateChannel(
    projectId: string,
    channel: { readonly id: string; readonly name: string },
    now: string,
  ): Promise<void> {
    const row = this.rows.get(projectId);

    if (row) {
      this.rows.set(projectId, {
        ...row,
        channelId: channel.id,
        channelName: channel.name,
        updatedAt: now,
      });
    }
  }

  /** Mirrors `updateEvents` of the real repository. */
  public async updateEvents(
    projectId: string,
    events: DiscordEventSelection,
    now: string,
  ): Promise<void> {
    const row = this.rows.get(projectId);

    if (row) {
      this.rows.set(projectId, { ...row, events, updatedAt: now });
    }
  }

  /** Mirrors `deleteConnection` of the real repository. */
  public async deleteConnection(projectId: string): Promise<boolean> {
    this.deliveries.dropAll(projectId);

    return this.rows.delete(projectId);
  }
}
