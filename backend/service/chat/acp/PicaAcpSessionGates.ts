import { SerialQueue } from "@/backend/concurrency/SerialQueue";

/** How long the gate of a conversation without work stays in memory. */
export const PICA_SESSION_IDLE_MILLISECONDS = 10 * 60_000;
/** How often the idle gates are looked for at most. */
const SWEEP_MILLISECONDS = 60_000;

interface SessionGate {
  readonly queue: SerialQueue;
  /** Tasks submitted and not yet settled. */
  pending: number;
  /** When the last task settled or was submitted. */
  usedAt: number;
}

/**
 * One queue per conversation of the ACP path, released when it rests
 * (PAGE-304).
 *
 * @remarks
 * Every conversation passes its messages, starts and stops through its own
 * queue, so conversations never wait for each other. A conversation without
 * a running job and without a task in its queue for the idle time gives its
 * queue up; its next message creates a new one and continues the stored
 * history. The sweep runs on use, at most once a minute, and needs no timer.
 */
export class PicaAcpSessionGates {
  private readonly gates = new Map<string, SessionGate>();
  private readonly idleMilliseconds: number;
  private readonly now: () => number;
  private sweptAt = 0;

  public constructor(
    options: {
      readonly idleMilliseconds?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.idleMilliseconds =
      options.idleMilliseconds ?? PICA_SESSION_IDLE_MILLISECONDS;
    this.now = options.now ?? Date.now;
  }

  /** How many conversations hold a queue now. */
  public get size(): number {
    return this.gates.size;
  }

  /**
   * Runs a task after the earlier tasks of the same conversation.
   *
   * @param sessionId - The conversation.
   * @param task - The task.
   * @param isBusy - Whether a conversation still runs a job; its gate stays.
   * @returns The result of the task.
   */
  public run<Result>(
    sessionId: string,
    task: () => Promise<Result>,
    isBusy: (sessionId: string) => boolean,
  ): Promise<Result> {
    this.sweep(isBusy);
    let gate = this.gates.get(sessionId);
    if (!gate) {
      gate = { queue: new SerialQueue(), pending: 0, usedAt: this.now() };
      this.gates.set(sessionId, gate);
    }
    const entry = gate;
    entry.pending += 1;
    entry.usedAt = this.now();
    return entry.queue.run(task).finally(() => {
      entry.pending -= 1;
      entry.usedAt = this.now();
    });
  }

  /** Gives the queue of a conversation up, unless a task is still in it. */
  public release(sessionId: string): void {
    if (this.gates.get(sessionId)?.pending === 0) this.gates.delete(sessionId);
  }

  /** Gives up the queues of the conversations that rest longer than the idle time. */
  public sweep(isBusy: (sessionId: string) => boolean): void {
    const now = this.now();
    if (now - this.sweptAt < SWEEP_MILLISECONDS) return;
    this.sweptAt = now;
    for (const [sessionId, gate] of this.gates)
      if (
        gate.pending === 0 &&
        now - gate.usedAt >= this.idleMilliseconds &&
        !isBusy(sessionId)
      )
        this.gates.delete(sessionId);
  }
}
