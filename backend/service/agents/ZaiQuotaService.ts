import { visibleZaiQuotaWindows, zaiQuotaAbsence } from "@/definition/ZaiQuota";

import { quotaCardStatus } from "./QuotaCardStatus";
import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { ZaiQuotaAccount } from "@/definition/ZaiQuota";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";
import type { ZaiQuotaProbe, ZaiStoredReading } from "./ZaiQuotaProbe";

interface ZaiQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks the usage monitor of Z.AI anew for the quota of each connection. */
  readonly probe: Pick<ZaiQuotaProbe, "refresh" | "stored">;
  readonly clock?: () => Date;
}

/** The outcomes of an answer that asked Z.AI about no connection. */
const NO_OUTCOMES: ReadonlyMap<string, QuotaProbeOutcome> = new Map();

/**
 * Answers the quota page for Z.AI: one card per direct Z.AI connection a
 * person may use.
 * @remarks
 * A card is visible exactly where the connection's usage scope admits the
 * person, read anew with every query; managing a connection is not using it,
 * so administrators get no exception. The stored answer comes at once without
 * asking Z.AI; a query of a card, or of all cards, asks the usage monitor for
 * exactly the connections the person may use, stores the answer and answers
 * from it, so a connection that cannot be asked right now keeps its last
 * figures with the time of the last answer. The key never leaves the server:
 * a card carries the figures, the status and the saved account type only. The
 * rights are read before a query starts and again before its answer leaves,
 * so a right withdrawn meanwhile never gives out a card.
 */
export class ZaiQuotaService {
  private readonly dependencies: ZaiQuotaDependencies;
  private readonly access: QuotaConnectionAccess;

  public constructor(dependencies: ZaiQuotaDependencies) {
    this.dependencies = dependencies;
    this.access = new QuotaConnectionAccess(dependencies);
  }

  /**
   * Reads the cards of a person from the stored answers, without asking Z.AI.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names, each with its
   * last stored figures and the status `stored`; an unknown or inactive
   * account sees none.
   */
  public async listStoredForUser(userId: string): Promise<QuotaSnapshot> {
    return this.snapshot(await this.usableFor(userId), NO_OUTCOMES);
  }

  /**
   * Asks the usage monitor about every connection of a person and reads their cards.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names; a failed query
   * is the status of its card, not a failure of the answer.
   */
  public async listForUser(userId: string): Promise<QuotaSnapshot> {
    const connections = await this.usableFor(userId);
    const outcomes = await Promise.all(
      connections.map(
        async (connection) =>
          [
            connection.id,
            await this.dependencies.probe.refresh(connection),
          ] as const,
      ),
    );
    return this.snapshot(await this.usableFor(userId), new Map(outcomes));
  }

  /**
   * Asks the usage monitor about one connection and reads its card.
   * @param userId - The person reading the page.
   * @param connectionId - The connection of the card.
   * @returns A snapshot with the card, or without an account when the person
   * may not use the connection (any more) or it does not exist.
   */
  public async refreshForUser(
    userId: string,
    connectionId: string,
  ): Promise<QuotaSnapshot> {
    const [connection] = await this.usableFor(userId, connectionId);
    if (!connection) return this.snapshot([], NO_OUTCOMES);
    const outcome = await this.dependencies.probe.refresh(connection);
    return this.snapshot(
      await this.usableFor(userId, connectionId),
      new Map([[connection.id, outcome]]),
    );
  }

  private usableFor(
    userId: string,
    connectionId?: string,
  ): Promise<AgentConnectionRecord[]> {
    return this.access.usableFor(userId, "zai", connectionId);
  }

  private async snapshot(
    connections: readonly AgentConnectionRecord[],
    outcomes: ReadonlyMap<string, QuotaProbeOutcome>,
  ): Promise<QuotaSnapshot> {
    // The time is taken before the read, so a later answer never carries
    // older figures than an earlier one.
    const now = this.now();
    const accounts = await Promise.all(
      connections.map(async (connection) =>
        this.account(
          connection,
          {
            outcome: outcomes.get(connection.id) ?? null,
            reading: await this.dependencies.probe.stored(connection.id),
          },
          now,
        ),
      ),
    );
    accounts.sort((first, second) => first.name.localeCompare(second.name));
    return { accounts, readAt: now.toISOString() };
  }

  /**
   * The card of a connection.
   * @remarks
   * A connection without a usable key has no allowance Z.AI could vouch for,
   * so its card shows neither a plan nor figures. A card whose answer leaves
   * no entry to show names why: Z.AI delivered none, delivered none the card
   * can read, or delivered only entries whose reset has passed.
   */
  private account(
    connection: AgentConnectionRecord,
    query: {
      readonly outcome: QuotaProbeOutcome | null;
      readonly reading: ZaiStoredReading | null;
    },
    now: Date,
  ): ZaiQuotaAccount {
    const { outcome, reading } = query;
    const windows = visibleZaiQuotaWindows(reading?.windows ?? [], now);
    const status = quotaCardStatus(outcome, {
      at: reading?.at ?? null,
      hasWindows: windows.length > 0,
    });
    const isSignedOut = status.kind === "signed_out";
    return {
      provider: "zai",
      connectionId: connection.id,
      name: connection.name,
      accountType: connection.zaiAccountType ?? "api",
      plan: isSignedOut ? null : (reading?.plan ?? null),
      windows: isSignedOut ? [] : windows,
      absence: isSignedOut
        ? null
        : zaiQuotaAbsence(reading?.tally ?? null, windows.length),
      status,
    };
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
