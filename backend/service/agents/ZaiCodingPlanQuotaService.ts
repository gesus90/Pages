import { ZAI_CODING_PLAN_PROVIDER } from "@/definition/AgentConnection";
import { visibleZaiQuotaWindows } from "@/definition/ZaiCodingPlanQuota";

import { quotaCardStatus, quotaWindowsAt } from "./QuotaCardStatus";
import { QuotaConnectionAccess } from "./QuotaConnectionAccess";

import type { AgentConnectionRepository } from "@/backend/database/repositories/AgentConnectionRepository";
import type { AuthorizationRepository } from "@/backend/database/repositories/AuthorizationRepository";
import type { UserGroupRepository } from "@/backend/database/repositories/UserGroupRepository";
import type { AgentConnectionRecord } from "@/backend/database/repositories/agent/AgentConnectionRows";
import type { QuotaSnapshot } from "@/definition/AgentQuota";
import type { ClaudeQuotaStatus } from "@/definition/ClaudeQuota";
import type { ZaiCodingPlanQuotaAccount } from "@/definition/ZaiCodingPlanQuota";
import type { QuotaProbeOutcome } from "./ProviderQuotaProbe";
import type { ZaiCodingPlanQuotaProbe } from "./ZaiCodingPlanQuotaProbe";

interface ZaiCodingPlanQuotaDependencies {
  readonly connections: AgentConnectionRepository;
  readonly authorization: Pick<AuthorizationRepository, "snapshot">;
  readonly groups: Pick<UserGroupRepository, "findIdsByMember">;
  /** Asks Z.AI anew for the quota of each connection and keeps its answer. */
  readonly probe: Pick<
    ZaiCodingPlanQuotaProbe,
    "refresh" | "latestFailure" | "latest"
  >;
  readonly clock?: () => Date;
}

/** The outcomes of an answer that asked Z.AI about no connection. */
const NO_OUTCOMES: ReadonlyMap<string, QuotaProbeOutcome> = new Map();

/**
 * Answers the quota page for the Z.AI Coding Plan: one card per OpenCode
 * connection that stores a Coding Plan key and that a person may use.
 * @remarks
 * The card belongs to the managed OpenCode connection itself and uses its
 * stored key, the one OpenCode ACP runs with; OpenCode Zen and OpenRouter
 * keys of other OpenCode connections get no card here. A card is visible
 * exactly where the connection's usage scope admits the person, read anew
 * with every query and again before its answer leaves, so a right withdrawn
 * meanwhile hides the card and its kept figures; administrators get no
 * exception. A person without the right reaches neither card nor figures,
 * and no query is started for the connection. A failed query keeps the last
 * answer for the same key with its time.
 */
export class ZaiCodingPlanQuotaService {
  private readonly dependencies: ZaiCodingPlanQuotaDependencies;
  private readonly access: QuotaConnectionAccess;

  public constructor(dependencies: ZaiCodingPlanQuotaDependencies) {
    this.dependencies = dependencies;
    this.access = new QuotaConnectionAccess(dependencies);
  }

  /**
   * Reads the cards of a person from the kept figures, without asking Z.AI.
   * @param userId - The person reading the page.
   * @returns The cards in the order of the connection names, each with the
   * status `stored`.
   */
  public async listStoredForUser(userId: string): Promise<QuotaSnapshot> {
    return this.snapshot(await this.usableFor(userId), NO_OUTCOMES);
  }

  /**
   * Asks Z.AI about every Coding Plan connection of a person and reads the cards.
   * @param userId - The person reading the page.
   * @returns The cards; a failed query is the status of its card.
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
   * Asks Z.AI about one connection and reads its card.
   * @param userId - The person reading the page.
   * @param connectionId - The connection of the card.
   * @returns A snapshot with the card, or without an account when the person
   * may not use the connection (any more), it does not exist or it holds no
   * Coding Plan key.
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

  private async usableFor(
    userId: string,
    connectionId?: string,
  ): Promise<AgentConnectionRecord[]> {
    const connections = await this.access.usableFor(
      userId,
      "opencode",
      connectionId,
    );
    return connections.filter(
      (connection) => connection.cliAccountLabel === ZAI_CODING_PLAN_PROVIDER,
    );
  }

  private snapshot(
    connections: readonly AgentConnectionRecord[],
    outcomes: ReadonlyMap<string, QuotaProbeOutcome>,
  ): QuotaSnapshot {
    const now = this.now();
    const accounts = connections
      .map((connection) =>
        this.account(
          connection,
          outcomes.get(connection.id) ??
            this.dependencies.probe.latestFailure(connection.id),
          now,
        ),
      )
      .sort((first, second) => first.name.localeCompare(second.name));
    return { accounts, readAt: now.toISOString() };
  }

  /**
   * The card of a connection.
   * @remarks
   * A connection without a confirmed key has no subscription Z.AI could
   * vouch for, so its card shows neither a plan nor windows. The card gets
   * every window of the last answer, also those whose reset has passed since,
   * so it can tell expired windows from an empty answer; the status counts
   * only the windows it still shows.
   */
  private account(
    connection: AgentConnectionRecord,
    outcome: QuotaProbeOutcome | null,
    now: Date,
  ): ZaiCodingPlanQuotaAccount {
    const reading = this.dependencies.probe.latest(connection);
    const reportedAt = reading?.reportedAt ?? null;
    const windows = reading?.usage.windows ?? [];
    const visible = visibleZaiQuotaWindows(windows, {
      now: quotaWindowsAt(outcome, reportedAt, now),
      answeredAt: reportedAt,
    });
    const status: ClaudeQuotaStatus =
      connection.cliLoggedInAt === null
        ? { kind: "signed_out" }
        : quotaCardStatus(outcome, {
            at: reportedAt,
            hasWindows: visible.length > 0,
          });
    const isSignedOut = status.kind === "signed_out";
    return {
      provider: "zai_coding_plan",
      connectionId: connection.id,
      executionLocation: "local",
      name: connection.name,
      plan: isSignedOut ? null : (reading?.usage.plan ?? null),
      windows: isSignedOut ? [] : windows,
      unreadableCount: isSignedOut ? 0 : (reading?.usage.unreadableCount ?? 0),
      status,
    };
  }

  private now(): Date {
    return (this.dependencies.clock ?? (() => new Date()))();
  }
}
