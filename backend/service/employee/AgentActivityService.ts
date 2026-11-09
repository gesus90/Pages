import { randomUUID } from "node:crypto";

import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";

import {
  databaseTimeToIso,
  monthStart,
  toDatabaseTime,
} from "./AgentEmployeeText";

import type { EmployeeStore } from "@/backend/database/repositories/employee/EmployeeStore";
import type { StoredAgentEmployee } from "@/backend/database/repositories/employee/AgentEmployeeRepository";
import type {
  AgentActivityEntry,
  AgentCostState,
  AgentLearningResult,
} from "@/definition/AgentEmployee";

/** Entries of each kind the activity lists at most. */
const ACTIVITY_ENTRIES = 60;

/** What a refused start names as its cause. */
export type AgentLimitCause = "session" | "learning";

/**
 * The cost limit and the activity of agent employees (PAGE-266).
 *
 * @remarks
 * The limit applies per calendar month (UTC) in US dollars to the known
 * costs of the agent's sessions and learning runs. Without a limit nothing is
 * refused. A model that reports no cost leaves its sessions unknown; they are
 * counted and shown, never guessed.
 */
export class AgentActivityService {
  private readonly store: EmployeeStore;
  private readonly now: () => Date;

  public constructor(store: EmployeeStore, now: () => Date = () => new Date()) {
    this.store = store;
    this.now = now;
  }

  /** What the agent spent this month and whether its limit is reached. */
  public async cost(agent: StoredAgentEmployee): Promise<AgentCostState> {
    const now = this.now();
    const period = await this.store
      .activity()
      .costSince(agent.userId, monthStart(now));
    const limit = agent.monthlyCostLimit;
    return {
      limit,
      spent: period.known,
      unknownSessions: period.unknownSessions,
      isReached: limit !== null && period.known >= limit,
      month: now.toISOString().slice(0, 7),
    };
  }

  /**
   * Refuses a new session or learning run once the monthly limit is reached
   * and records the refusal once per day, so the activity names the cause.
   *
   * @throws {AgentEmployeeError} `costLimitReached`.
   */
  public async requireBelowLimit(
    agent: StoredAgentEmployee,
    cause: AgentLimitCause,
  ): Promise<void> {
    if (agent.monthlyCostLimit === null) return;
    const cost = await this.cost(agent);
    if (!cost.isReached) return;
    const today = `${toDatabaseTime(this.now()).slice(0, 10)} 00:00:00`;
    const activity = this.store.activity();
    if (!(await activity.hasLimitEventSince(agent.userId, today)))
      await activity.record(agent.userId, {
        id: randomUUID(),
        kind: "limit",
        detail: JSON.stringify({
          cause,
          limit: agent.monthlyCostLimit,
          spent: cost.spent,
        }),
        cost: { state: "none", amount: null, isEstimated: false },
      });
    throw new AgentEmployeeError("costLimitReached");
  }

  /** Records the outcome of a learning run. */
  public async recordLearning(
    agentId: string,
    result: AgentLearningResult,
  ): Promise<void> {
    await this.store.activity().record(agentId, {
      id: randomUUID(),
      kind: "learning",
      detail: JSON.stringify(result),
      cost: { state: "none", amount: null, isEstimated: false },
    });
  }

  /** Everything the agent did, the newest first. */
  public async list(agentId: string): Promise<readonly AgentActivityEntry[]> {
    const activity = this.store.activity();
    const [sessions, events, changes] = await Promise.all([
      activity.sessions(agentId, ACTIVITY_ENTRIES),
      activity.events(agentId, ACTIVITY_ENTRIES),
      activity.changes(agentId, ACTIVITY_ENTRIES),
    ]);
    const entries: AgentActivityEntry[] = [
      ...sessions.map((session) => ({
        id: `session:${session.id}`,
        kind:
          session.purpose === "learning"
            ? ("learning" as const)
            : ("session" as const),
        at: databaseTimeToIso(session.createdAt) ?? session.createdAt,
        detail: JSON.stringify({
          state: session.state,
          person: session.personName,
          isModelRun: true,
        }),
        link: null,
        cost: session.cost,
      })),
      ...events.map((event) => ({
        id: `event:${event.id}`,
        kind: event.kind,
        at: databaseTimeToIso(event.createdAt) ?? event.createdAt,
        detail: event.detail,
        link: null,
        cost: event.cost,
      })),
      ...changes.map((change) => ({
        id: `change:${change.id}`,
        kind: change.kind,
        at: databaseTimeToIso(change.createdAt) ?? change.createdAt,
        detail: JSON.stringify({
          message: change.message,
          key: change.workItemKey,
        }),
        link:
          change.kind === "ticket" && change.workItemKey
            ? `/tasks/${encodeURIComponent(change.workItemKey)}`
            : null,
        cost: { state: "none" as const, amount: null, isEstimated: false },
      })),
    ];
    return entries.sort((left, right) => right.at.localeCompare(left.at));
  }
}
