import { AgentEmployeeError } from "@/backend/error/AgentEmployeeError";
import { logCaughtError } from "@/backend/logging/Logger";
import {
  AGENT_SESSION_DEFAULT_PER_AGENT,
  AGENT_SESSION_DEFAULT_TOTAL,
} from "@/definition/AgentSessionLimits";

/** How many sessions may run at once, per agent and for all agents. */
export interface AgentSessionLimitValues {
  readonly perAgent: number;
  readonly total: number;
}

/** A place among the running sessions; it is released once. */
export interface AgentSessionSlot {
  /** Whether the session waited in the queue before it got its place. */
  readonly hasWaited: boolean;
  /** Frees the place; a second call does nothing. */
  release(): void;
}

/** How a session asks for its place. */
export interface AgentSessionSlotRequest {
  /** Ends the wait; the request then fails with `stopped`. */
  readonly signal?: AbortSignal;
  /** Called once when the session has to wait, before it waits. */
  readonly onQueued?: () => void;
}

interface Waiter {
  readonly agentId: string;
  readonly grant: (slot: AgentSessionSlot) => void;
}

/**
 * The places of the concurrent chat sessions of agents (PAGE-304).
 *
 * @remarks
 * Every chat of an agent runs its own session, so one agent answers in
 * several chats at once. Above the limit per agent or in total a session
 * waits; it is never refused. A freed place goes to the oldest waiting
 * session whose agent is below its limit, so a busy agent does not hold up
 * another one. The limits are read anew before every request; a failed
 * read keeps the last known ones. The places live in this process, like the
 * jobs they count.
 */
export class AgentSessionSlots {
  private readonly perAgent = new Map<string, number>();
  private readonly waiters: Waiter[] = [];
  private readonly readLimits: () => Promise<AgentSessionLimitValues>;
  private limits: AgentSessionLimitValues = {
    perAgent: AGENT_SESSION_DEFAULT_PER_AGENT,
    total: AGENT_SESSION_DEFAULT_TOTAL,
  };
  private total = 0;

  public constructor(readLimits: () => Promise<AgentSessionLimitValues>) {
    this.readLimits = readLimits;
  }

  /** Sessions that hold a place now. */
  public get running(): number {
    return this.total;
  }

  /** Sessions that wait for a place now. */
  public get waiting(): number {
    return this.waiters.length;
  }

  /** Whether a session of the agent would get its place at once. */
  public canStart(agentId: string): boolean {
    return (
      !this.waiters.some((waiter) => waiter.agentId === agentId) &&
      this.hasRoom(agentId)
    );
  }

  /**
   * Takes a place for a session of the agent, waiting while the limits are reached.
   *
   * @throws {AgentEmployeeError} `stopped` when the signal ends the wait.
   */
  public async acquire(
    agentId: string,
    request: AgentSessionSlotRequest = {},
  ): Promise<AgentSessionSlot> {
    const { signal } = request;
    if (signal?.aborted) throw new AgentEmployeeError("stopped");
    await this.refresh();
    if (this.canStart(agentId)) return this.take(agentId, false);
    request.onQueued?.();
    return new Promise<AgentSessionSlot>((resolve, reject) => {
      const waiter: Waiter = {
        agentId,
        grant: (slot) => {
          signal?.removeEventListener("abort", abort);
          resolve(slot);
        },
      };
      const abort = (): void => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new AgentEmployeeError("stopped"));
        // A waiter of the same agent may start now that this one left the queue.
        this.drain();
      };
      signal?.addEventListener("abort", abort, { once: true });
      this.waiters.push(waiter);
    });
  }

  /** Applies changed limits at once: raised limits start waiting sessions. */
  public apply(limits: AgentSessionLimitValues): void {
    this.limits = limits;
    this.drain();
  }

  private async refresh(): Promise<void> {
    try {
      this.limits = await this.readLimits();
    } catch (error: unknown) {
      // The last known limits keep applying; a message is never refused for it.
      logCaughtError("AgentSessionSlots", error);
    }
  }

  private hasRoom(agentId: string): boolean {
    return (
      this.total < this.limits.total &&
      (this.perAgent.get(agentId) ?? 0) < this.limits.perAgent
    );
  }

  private take(agentId: string, hasWaited: boolean): AgentSessionSlot {
    this.total += 1;
    this.perAgent.set(agentId, (this.perAgent.get(agentId) ?? 0) + 1);
    let isReleased = false;
    return {
      hasWaited,
      release: () => {
        if (isReleased) return;
        isReleased = true;
        this.total -= 1;
        const count = (this.perAgent.get(agentId) ?? 1) - 1;
        if (count === 0) this.perAgent.delete(agentId);
        else this.perAgent.set(agentId, count);
        this.drain();
      },
    };
  }

  /** Gives free places to the oldest waiting sessions whose agents are below their limit. */
  private drain(): void {
    let index = 0;
    while (index < this.waiters.length && this.total < this.limits.total) {
      const waiter = this.waiters[index];
      const isBlockedByEarlier = this.waiters
        .slice(0, index)
        .some((earlier) => earlier.agentId === waiter?.agentId);
      if (!waiter || isBlockedByEarlier || !this.hasRoom(waiter.agentId)) {
        index += 1;
        continue;
      }
      this.waiters.splice(index, 1);
      waiter.grant(this.take(waiter.agentId, true));
    }
  }
}
