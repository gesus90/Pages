import { visibleClaudeQuotaWindows } from "@/definition/ClaudeQuota";

import { quotaCardStatus } from "./QuotaCardStatus";
import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { ClaudeQuotaRecord } from "@/backend/database/repositories/agent/ClaudeQuotaRepository";
import type {
  ClaudeQuotaAccount,
  ClaudeQuotaSnapshot,
} from "@/definition/ClaudeQuota";
import type {
  ClaudeQuotaProbe,
  ClaudeQuotaProbeOutcome,
} from "./ClaudeQuotaProbe";

interface ClaudeQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks Claude anew for the usage of each connection. */
  readonly probe: Pick<ClaudeQuotaProbe, "refresh" | "latestFailure">;
  readonly clock?: () => Date;
}

const EMPTY_RECORD: ClaudeQuotaRecord = {
  plan: null,
  windows: [],
  reportedAt: null,
};

/** The outcomes of an answer that asked Claude about no connection. */
const NO_OUTCOMES: ReadonlyMap<string, ClaudeQuotaProbeOutcome> = new Map();

/**
 * Answers the quota page: one card per Claude connection a person may use.
 * @remarks
 * A card is visible exactly where the connection's usage scope admits the
 * person, read anew with every query: an active account, and for a
 * restricted scope a named person, group or department membership.
 * Administrators get no exception, because managing a connection is not
 * using it. Only active Claude Code connections have cards. The stored
 * figures answer at once, without waiting for Claude; a query of a card, or
 * of all cards, asks Claude for the current usage of exactly the connections
 * the person may use, stores it and answers from the stored figures, so a
 * connection Claude cannot be asked about right now keeps its last figures.
 * Each card carries the outcome of its own query: reported, no windows,
 * failed, or signed out; a running session of the connection never makes a
 * query skip. A failed query leaves the last windows with the time of the
 * last answer, and a successful one sets that time anew even when every
 * percentage is unchanged. The
 * rights are read before a query starts and again before its answer leaves,
 * so a right withdrawn meanwhile never gives out a card.
 */
export class ClaudeQuotaService {
  private readonly dependencies: ClaudeQuotaDependencies;
  private readonly access: QuotaConnectionAccess;

  public constructor(dependencies: ClaudeQuotaDependencies) {
    this.dependencies = dependencies;
    this.access = new QuotaConnectionAccess(dependencies);
  }

  /**
   * Reads the cards of a person from the stored figures, without asking Claude.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names, each with its
   * last stored figures and the status `stored`; an unknown or inactive
   * account sees none.
   */
  public async listStoredForUser(userId: string): Promise<ClaudeQuotaSnapshot> {
    return this.snapshot(await this.usableFor(userId), NO_OUTCOMES);
  }

  /**
   * Asks Claude about every connection of a person and reads their cards.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names; an unknown or
   * inactive account sees none. A failed usage query is the status of its
   * card, not a failure of the answer.
   * @remarks
   * The connections are queried side by side, so one slow connection delays
   * this answer but no other card's query.
   */
  public async listForUser(userId: string): Promise<ClaudeQuotaSnapshot> {
    const outcomes = await this.refresh(await this.usableFor(userId));
    return this.snapshot(await this.usableFor(userId), outcomes);
  }

  /**
   * Asks Claude about one connection and reads its card.
   * @param userId - The person reading the page.
   * @param connectionId - The connection of the card.
   * @returns A snapshot with the card, or without an account when the person
   * may not use the connection (any more) or it does not exist.
   */
  public async refreshForUser(
    userId: string,
    connectionId: string,
  ): Promise<ClaudeQuotaSnapshot> {
    const [connection] = await this.usableFor(userId, connectionId);
    if (!connection) return this.snapshot([], NO_OUTCOMES);
    const outcome = await this.dependencies.probe.refresh(connection);
    return this.snapshot(
      await this.usableFor(userId, connectionId),
      new Map([[connection.id, outcome]]),
    );
  }

  /**
   * Queries the connections side by side.
   * @returns The outcome of each connection's query by connection id.
   */
  private async refresh(
    connections: readonly AgentConnectionRecord[],
  ): Promise<ReadonlyMap<string, ClaudeQuotaProbeOutcome>> {
    const outcomes = await Promise.all(
      connections.map(
        async (connection) =>
          [
            connection.id,
            await this.dependencies.probe.refresh(connection),
          ] as const,
      ),
    );
    return new Map(outcomes);
  }

  /**
   * The cards of connections from the stored figures.
   * @param connections - The connections the person may use.
   * @param outcomes - The outcome of each connection's query by connection
   * id; a connection without one is answered from the stored figures.
   */
  private async snapshot(
    connections: readonly AgentConnectionRecord[],
    outcomes: ReadonlyMap<string, ClaudeQuotaProbeOutcome>,
  ): Promise<ClaudeQuotaSnapshot> {
    // The time is taken before the read, so a later answer never carries
    // older figures than an earlier one.
    const now = this.now();
    if (connections.length === 0)
      return { accounts: [], readAt: now.toISOString() };
    const records = await this.dependencies.connections.quotas().list();
    const accounts = connections
      .map((connection) =>
        this.account(
          connection,
          {
            outcome:
              outcomes.get(connection.id) ??
              this.dependencies.probe.latestFailure(connection.id),
            record: records.get(connection.id) ?? EMPTY_RECORD,
          },
          now,
        ),
      )
      .sort((first, second) => first.name.localeCompare(second.name));
    return { accounts, readAt: now.toISOString() };
  }

  /**
   * The Claude connections a person may use right now.
   * @param userId - The person.
   * @param connectionId - Limits the answer to this connection.
   */
  private usableFor(
    userId: string,
    connectionId?: string,
  ): Promise<AgentConnectionRecord[]> {
    return this.access.usableFor(userId, "claude_code", connectionId);
  }

  /**
   * The card of a connection.
   * @remarks
   * A connection without a sign-in has no plan Claude could vouch for, so its
   * card shows neither a plan nor windows.
   */
  private account(
    connection: AgentConnectionRecord,
    query: {
      readonly outcome: ClaudeQuotaProbeOutcome | null;
      readonly record: ClaudeQuotaRecord;
    },
    now: Date,
  ): ClaudeQuotaAccount {
    const { outcome, record } = query;
    const windows = visibleClaudeQuotaWindows(record.windows, now);
    const status = quotaCardStatus(outcome, {
      at: record.reportedAt,
      hasWindows: windows.length > 0,
    });
    const isSignedOut = status.kind === "signed_out";
    return {
      provider: "claude_code",
      connectionId: connection.id,
      executionLocation: "local",
      name: connection.name,
      plan: isSignedOut ? null : record.plan,
      windows: isSignedOut ? [] : windows,
      status,
    };
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
