import { logCaughtError } from "@/backend/logging/Logger";
import { PLAN_MAXIMUM_RETRIES } from "@/definition/AgentPlanRetry";

import type { RemoteSessionView } from "@/definition/RemoteConnection";
import type { RemoteSession } from "./RemoteSession";

const IDLE_VIEW: RemoteSessionView = {
  status: "idle",
  attempts: 0,
  maximumAttempts: PLAN_MAXIMUM_RETRIES,
  nextAttemptAt: null,
  cause: null,
  connectedAt: null,
};

/**
 * Holds one logical connection per remote connection of this server process.
 *
 * @remarks
 * A series on one connection never affects another, so a blocked machine
 * does not stop runs on other machines.
 */
export class RemoteSessionRegistry {
  private readonly sessions = new Map<string, RemoteSession>();
  private readonly create: (connectionId: string) => RemoteSession;

  public constructor(create: (connectionId: string) => RemoteSession) {
    this.create = create;
  }

  /** Returns the logical connection of a remote connection, creating it closed. */
  public session(connectionId: string): RemoteSession {
    const existing = this.sessions.get(connectionId);
    if (existing) return existing;
    const created = this.create(connectionId);
    this.sessions.set(connectionId, created);
    return created;
  }

  /** The live state without opening anything. */
  public view(connectionId: string): RemoteSessionView {
    return this.sessions.get(connectionId)?.view() ?? IDLE_VIEW;
  }

  /** Closes and forgets a connection's logical connection, after a change or removal. */
  public async reset(connectionId: string): Promise<void> {
    const session = this.sessions.get(connectionId);
    this.sessions.delete(connectionId);
    await session?.close();
  }

  /** Closes every logical connection; called when the server stops. */
  public async shutdown(): Promise<void> {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    const results = await Promise.allSettled(
      sessions.map((session) => session.close()),
    );
    for (const result of results)
      if (result.status === "rejected")
        logCaughtError("RemoteSessionRegistry", result.reason);
  }
}
