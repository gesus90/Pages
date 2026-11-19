import { visibleCodexQuotaWindows } from "@/definition/CodexQuota";

import { quotaCardStatus } from "./QuotaCardStatus";
import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { CodexQuotaRecord } from "@/backend/database/repositories/agent/CodexQuotaRepository";
import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { CodexQuotaAccount } from "@/definition/CodexQuota";
import type { CodexQuotaProbe } from "./CodexQuotaProbe";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";

interface CodexQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks Codex anew for the quota of each connection. */
  readonly probe: Pick<CodexQuotaProbe, "refresh" | "latestFailure">;
  readonly clock?: () => Date;
}

/** The outcomes of an answer that asked Codex about no connection. */
const NO_OUTCOMES: ReadonlyMap<string, QuotaProbeOutcome> = new Map();

/**
 * Answers the quota page for Codex: one card per Codex connection a person
 * may use.
 * @remarks
 * A card is visible exactly where the connection's usage scope admits the
 * person, read anew with every query, as for the Claude cards; managing a
 * connection is not using it, so administrators get no exception. The stored
 * quota answers at once without asking Codex; a query of a card, or of all
 * cards, asks Codex for the current quota of exactly the connections the
 * person may use, stores it and answers from the stored quota, so a
 * connection that cannot be asked right now keeps its last figures with the
 * time of the last answer. Each card carries the outcome of its own query:
 * reported, no windows, failed, or signed out. A running Codex session never
 * makes a query skip. The rights are read before a query starts and again
 * before its answer leaves, so a right withdrawn meanwhile never gives out a
 * card. A person without the right to use a connection reaches neither its
 * card nor its figures, and no query is started for it.
 */
export class CodexQuotaService {
  private readonly dependencies: CodexQuotaDependencies;
  private readonly access: QuotaConnectionAccess;

  public constructor(dependencies: CodexQuotaDependencies) {
    this.dependencies = dependencies;
    this.access = new QuotaConnectionAccess(dependencies);
  }

  /**
   * Reads the cards of a person from the stored quota, without asking Codex.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names, each with its
   * last stored figures and the status `stored`; an unknown or inactive
   * account sees none.
   */
  public async listStoredForUser(userId: string): Promise<QuotaSnapshot> {
    return this.snapshot(await this.usableFor(userId), NO_OUTCOMES);
  }

  /**
   * Asks Codex about every connection of a person and reads their cards.
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
   * Asks Codex about one connection and reads its card.
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
    return this.access.usableFor(userId, "codex_cli", connectionId);
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
    const records = await this.dependencies.connections.codexQuotas().list();
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
   * A connection without a sign-in has no subscription Codex could vouch
   * for, so its card shows neither a plan nor windows. The limit statement
   * is the stored one; the page names it only for a current answer and never
   * lets it change the figures of a window.
   */
  private account(
    connection: AgentConnectionRecord,
    query: {
      readonly outcome: QuotaProbeOutcome | null;
      readonly record: CodexQuotaRecord | null;
    },
    now: Date,
  ): CodexQuotaAccount {
    const { outcome, record } = query;
    const windows = visibleCodexQuotaWindows(record?.windows ?? [], now);
    const status = quotaCardStatus(outcome, {
      at: record?.reportedAt ?? null,
      hasWindows: windows.length > 0,
    });
    const isSignedOut = status.kind === "signed_out";
    return {
      provider: "codex_cli",
      connectionId: connection.id,
      name: connection.name,
      plan: isSignedOut ? null : (record?.plan ?? null),
      windows: isSignedOut ? [] : windows,
      isLimitReached: !isSignedOut && (record?.isLimitReached ?? false),
      status,
    };
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
