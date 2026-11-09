import { PostgresNotificationListener } from "@/backend/database/postgres/PostgresNotificationListener";
import { TERMINAL_CHANNEL } from "@/backend/agents/terminal/TerminalStore";
import { logCaughtError } from "@/backend/logging/Logger";
import { registerShutdownTask } from "@/backend/runtime/ProcessLifecycle";

import type { TerminalNotice } from "@/backend/agents/terminal/TerminalStore";

/** Without a notification a subscriber still looks this often. */
const POLL_MILLISECONDS = 1_000;

/** Receives changes of one terminal. */
export type TerminalSignalListener = () => void;

/** Subscribes to the changes of terminals, wherever their process runs. */
export interface TerminalSignalSource {
  /**
   * Calls the listener when the terminal announces a change of this kind,
   * and at least every second.
   *
   * @returns Ends the subscription.
   */
  subscribe(
    kind: TerminalNotice,
    instanceId: string,
    listener: TerminalSignalListener,
  ): () => void;
}

/**
 * The terminal notifications of one process (PAGE-265).
 *
 * @remarks
 * The process that runs a CLI and the process a viewer is connected to are
 * often different: plan runs may run in `pages-runs`, viewers reach the API.
 * Both learn about segments and inputs through PostgreSQL `NOTIFY`. The
 * listening session opens with the first subscriber. PostgreSQL drops
 * notifications while no session listens, so each subscriber also looks
 * every second and after every reconnect; it reads from its own cursor and
 * never misses or repeats anything.
 */
export class TerminalSignals implements TerminalSignalSource {
  private readonly databaseUrl: string | undefined;
  private readonly listeners = new Map<string, Set<TerminalSignalListener>>();
  private listener: PostgresNotificationListener | null = null;

  /**
   * @param databaseUrl - The instance's PostgreSQL URL; without it subscribers only poll.
   */
  public constructor(databaseUrl: string | undefined) {
    this.databaseUrl = databaseUrl;
  }

  /** Subscribes to one kind of change of one terminal. */
  public subscribe(
    kind: TerminalNotice,
    instanceId: string,
    listener: TerminalSignalListener,
  ): () => void {
    const key = `${kind}:${instanceId}`;
    const entries = this.listeners.get(key) ?? new Set();
    entries.add(listener);
    this.listeners.set(key, entries);
    this.listen();
    const timer = setInterval(() => call(listener), POLL_MILLISECONDS);
    timer.unref();
    return () => {
      clearInterval(timer);
      entries.delete(listener);
      if (entries.size === 0) this.listeners.delete(key);
    };
  }

  private listen(): void {
    if (this.listener !== null || !this.databaseUrl) return;
    const listener = new PostgresNotificationListener(
      this.databaseUrl,
      TERMINAL_CHANNEL,
      {
        onMessage: (payload) => {
          for (const entry of this.listeners.get(payload) ?? []) call(entry);
        },
        onListening: () => {
          for (const entries of this.listeners.values())
            for (const entry of entries) call(entry);
        },
      },
    );
    this.listener = listener;
    registerShutdownTask(() => listener.stop(), {
      step: "terminal_signals",
    });
    listener.start();
  }
}

function call(listener: TerminalSignalListener): void {
  try {
    listener();
  } catch (error: unknown) {
    logCaughtError("TerminalSignals", error);
  }
}
