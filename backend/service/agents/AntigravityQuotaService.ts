import { visibleAntigravityQuotaGroups } from "@/definition/AntigravityQuota";

import { quotaCardStatus } from "./QuotaCardStatus";
import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { AntigravityQuotaRecord } from "@/backend/database/repositories/agent/AntigravityQuotaRepository";
import type { AntigravityQuotaAccount } from "@/definition/AntigravityQuota";
import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { AntigravityQuotaProbe } from "./AntigravityQuotaProbe";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

interface AntigravityQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks Antigravity anew for the quota of each connection. */
  readonly probe: Pick<AntigravityQuotaProbe, "refresh" | "latestFailure">;
  readonly clock?: () => Date;
}

/** The outcomes of an answer that asked Antigravity about no connection. */
const NO_OUTCOMES: ReadonlyMap<string, QuotaProbeOutcome> = new Map();

/**
 * Answers the quota page for Antigravity: one card per Antigravity connection
 * a person may use.
 * @remarks
 * A card is visible exactly where the connection's usage scope admits the
 * person, read anew with every query, as for the Claude cards; managing a
 * connection is not using it, so administrators get no exception. The stored
 * quota answers at once without asking Antigravity; a query of a card, or of
 * all cards, asks Antigravity for the current quota of exactly the
 * connections the person may use, stores it and answers from the stored
 * quota, so a connection that cannot be asked right now keeps its last
 * figures. Each card carries the outcome of its own query: reported, no
 * windows, failed, skipped while a session holds the sign-in, or signed out.
 * The rights are read before a query starts and again before its answer
 * leaves, so a right withdrawn meanwhile never gives out a card. A person
 * without the right to use a connection reaches neither its card nor its
 * figures, and no query is started for it.
 */
export class AntigravityQuotaService {
  private readonly dependencies: AntigravityQuotaDependencies;
  private readonly access: QuotaConnectionAccess;

  public constructor(dependencies: AntigravityQuotaDependencies) {
    this.dependencies = dependencies;
    this.access = new QuotaConnectionAccess(dependencies);
  }

  /**
   * Reads the cards of a person from the stored quota, without asking Antigravity.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names, each with its
   * last stored figures and the status `stored`; an unknown or inactive
   * account sees none.
   */
  public async listStoredForUser(userId: string): Promise<QuotaSnapshot> {
    return this.snapshot(await this.usableFor(userId), NO_OUTCOMES);
  }

  /**
   * Asks Antigravity about every connection of a person and reads their cards.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names; a failed query
   * is the status of its card, not a failure of the answer.
   * @remarks
   * The connections are queried side by side, so one slow connection delays
   * this answer but no other card's query.
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
   * Asks Antigravity about one connection and reads its card.
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
    return this.access.usableFor(userId, "antigravity", connectionId);
  }

  private async snapshot(
    connections: readonly AgentConnectionRecord[],
    outcomes: ReadonlyMap<string, QuotaProbeOutcome>,
  ): Promise<QuotaSnapshot> {
    // The time is taken before the read, so a later answer never carries
    // older figures than an earlier one.
    const now = this.now();
    if (connections.length === 0)
      return { accounts: [], readAt: now.toISOString() };
    const records = await this.dependencies.connections
      .antigravityQuotas()
      .list();
    const accounts = connections
      .map((connection) =>
        this.account(
          connection,
          {
            outcome:
              outcomes.get(connection.id) ??
              this.dependencies.probe.latestFailure(connection.id),
            record: records.get(connection.id) ?? null,
          },
          now,
        ),
      )
      .sort((first, second) => first.name.localeCompare(second.name));
    return { accounts, readAt: now.toISOString() };
  }

  /**
   * The card of a connection.
   * @remarks
   * A connection without a sign-in has no account Antigravity could vouch
   * for, so its card shows no groups.
   */
  private account(
    connection: AgentConnectionRecord,
    query: {
      readonly outcome: QuotaProbeOutcome | null;
      readonly record: AntigravityQuotaRecord | null;
    },
    now: Date,
  ): AntigravityQuotaAccount {
    const { outcome, record } = query;
    const groups = visibleAntigravityQuotaGroups(record?.groups ?? [], now);
    const status = quotaCardStatus(outcome, {
      at: record?.reportedAt ?? null,
      hasWindows: groups.length > 0,
    });
    return {
      provider: "antigravity",
      connectionId: connection.id,
      name: connection.name,
      groups: status.kind === "signed_out" ? [] : groups,
      status,
    };
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
