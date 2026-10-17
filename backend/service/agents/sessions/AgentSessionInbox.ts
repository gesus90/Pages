import { randomUUID } from "node:crypto";

import { logCaughtError } from "@/backend/logging/Logger";

import type {
  AgentSessionMessage,
  AgentSessionMessageKind,
} from "@/definition/AgentSessionJournal";
import type { AgentSessionJournal } from "./AgentSessionJournal";
import type { AgentSessionStore } from "./AgentSessionStore";

/** The longest instruction a person can send. */
export const MAXIMUM_INSTRUCTION = 20_000;

/** Where an instruction goes: one attempt, inside one native session. */
export interface AgentSessionTarget {
  readonly attemptId: string;
  /** The native session; members of an ACP group share it, so they share its lock. */
  readonly instanceId: string;
  readonly userId: string;
}

/** Writes one instruction into the native session as a turn; resolves when that turn ended. */
export type AgentSessionDelivery = (
  message: AgentSessionMessage,
) => Promise<void>;

/** What `send` did with an instruction. */
export interface AgentSessionSendResult {
  readonly message: AgentSessionMessage;
  /** `queued` while a turn runs; the instruction follows once it ended. */
  readonly delivery: "queued" | "started";
}

/**
 * The queue of additional and repair instructions of PageAgentCLI sessions.
 *
 * @remarks
 * An instruction is stored and shown before anything is written to the
 * agent. While a turn of the native session runs, it waits; afterwards the
 * queue delivers it as a turn of its own. One native session never gets two
 * writes at once: turns, deliveries and every attempt of an ACP group share
 * the session's lock. A delivery is marked `delivering` before the write and
 * moves on only from there, so it happens at most once; one the server lost
 * on the way stays `uncertain` and is never repeated automatically.
 */
export class AgentSessionInbox {
  private readonly store: AgentSessionStore;
  private readonly journal: AgentSessionJournal;
  private readonly clock: () => string;
  /** Native sessions whose turn runs now. */
  private readonly running = new Set<string>();
  /** Native sessions a delivery loop works on now. */
  private readonly draining = new Set<string>();
  /** Attempts with instructions to deliver, per native session, with their delivery. */
  private readonly pending = new Map<
    string,
    Map<string, AgentSessionDelivery>
  >();

  public constructor(
    store: AgentSessionStore,
    journal: AgentSessionJournal,
    clock: () => string = () => new Date().toISOString(),
  ) {
    this.store = store;
    this.journal = journal;
    this.clock = clock;
  }

  /**
   * Stores an instruction and delivers it at once when the native session is free.
   *
   * @param target - The authorized attempt.
   * @param input - The kind and text; the text stays as written, apart from the frozen plan prompt.
   * @param delivery - Writes it into the native session.
   */
  public async send(
    target: AgentSessionTarget,
    input: { readonly kind: AgentSessionMessageKind; readonly text: string },
    delivery: AgentSessionDelivery,
  ): Promise<AgentSessionSendResult> {
    const now = this.clock();
    const message: AgentSessionMessage = {
      id: randomUUID(),
      attemptId: target.attemptId,
      userId: target.userId,
      kind: input.kind,
      text: input.text.slice(0, MAXIMUM_INSTRUCTION),
      status: "queued",
      createdAt: now,
      updatedAt: now,
    };
    await this.store.saveMessage(message);
    await this.journal.append(target.attemptId, [
      {
        turn: null,
        kind:
          input.kind === "repair" ? "repair_instruction" : "user_instruction",
        text: message.text,
        dedupeKey: `message:${message.id}`,
      },
    ]);
    const isBusy =
      this.running.has(target.instanceId) ||
      this.draining.has(target.instanceId);
    this.schedule(target, delivery);
    return { message, delivery: isBusy ? "queued" : "started" };
  }

  /** Marks a turn of the native session as running, so instructions wait for it. */
  public turnStarted(instanceId: string): void {
    this.running.add(instanceId);
  }

  /** Ends a running turn and delivers what waited for it. */
  public turnEnded(instanceId: string): void {
    this.running.delete(instanceId);
    this.wake(instanceId);
  }

  /**
   * Withdraws an instruction that is still waiting.
   *
   * @returns Whether it was withdrawn; a delivered instruction stays delivered.
   */
  public async withdraw(messageId: string): Promise<boolean> {
    return this.store.updateMessage(messageId, ["queued"], "cancelled");
  }

  /**
   * Marks deliveries a stopped server lost on the way; none is repeated.
   *
   * @returns How many messages became `uncertain`.
   */
  public async recover(): Promise<number> {
    return this.store.markUncertainDeliveries();
  }

  private schedule(
    target: AgentSessionTarget,
    delivery: AgentSessionDelivery,
  ): void {
    const attempts =
      this.pending.get(target.instanceId) ??
      new Map<string, AgentSessionDelivery>();
    attempts.set(target.attemptId, delivery);
    this.pending.set(target.instanceId, attempts);
    this.wake(target.instanceId);
  }

  private wake(instanceId: string): void {
    if (this.running.has(instanceId) || this.draining.has(instanceId)) return;
    if (!this.pending.get(instanceId)?.size) return;
    this.draining.add(instanceId);
    void this.drain(instanceId).finally(() => {
      this.draining.delete(instanceId);
      // An instruction may have arrived while the last delivery finished.
      this.wake(instanceId);
    });
  }

  private async drain(instanceId: string): Promise<void> {
    const attempts = this.pending.get(instanceId);
    while (attempts && attempts.size > 0 && !this.running.has(instanceId)) {
      const [attemptId, delivery] = attempts.entries().next().value ?? [];
      if (attemptId === undefined || delivery === undefined) return;
      attempts.delete(attemptId);
      for (const message of await this.store.listMessages(attemptId))
        if (message.status === "queued")
          await this.deliverOnce(message, delivery);
    }
    if (attempts?.size === 0) this.pending.delete(instanceId);
  }

  private async deliverOnce(
    message: AgentSessionMessage,
    delivery: AgentSessionDelivery,
  ): Promise<void> {
    if (!(await this.store.updateMessage(message.id, ["queued"], "delivering")))
      return;
    try {
      await delivery({ ...message, status: "delivering" });
      await this.store.updateMessage(message.id, ["delivering"], "delivered");
    } catch (error: unknown) {
      logCaughtError("AgentSessionInbox", error);

      // A failed write is reported once; repeating it could repeat its side effects.
      await this.store.updateMessage(message.id, ["delivering"], "failed");
      await this.journal.append(message.attemptId, [
        {
          turn: null,
          kind: "error",
          text: `instruction not delivered: ${error instanceof Error ? error.message : "unknown"}`,
          dedupeKey: `message:${message.id}:failed`,
        },
      ]);
    }
  }
}
