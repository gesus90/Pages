import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError } from "@/backend/logging/Logger";

import type { AgentTerminalInput } from "@/definition/AgentTerminal";
import type { TerminalSignalSource } from "@/backend/service/agents/terminal/TerminalSignals";
import type { TerminalKeys } from "./TerminalLaunch";
import type { TerminalHostStore } from "./TerminalStore";

/** The CLI gets this long to take a paste before the key that sends it. */
const SUBMIT_DELAY_MS = 200;
const PASTE_START = "\u001b[200~";
const PASTE_END = "\u001b[201~";

/** What the inputs of a terminal reach. */
export interface TerminalInputTarget {
  write(data: string): boolean;
  resize(columns: number, rows: number): void;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds).unref();
  });
}

/**
 * Text as one bracketed paste: the CLI takes it as one block, line breaks
 * included, and a contained end marker cannot end the paste early.
 *
 * @param text - What a person or the plan sends.
 * @returns The paste sequence.
 */
export function bracketedPaste(text: string): string {
  const body = text
    .replaceAll(PASTE_END, "")
    .replaceAll(PASTE_START, "")
    .replaceAll(/\r?\n/gu, "\r");
  return `${PASTE_START}${body}${PASTE_END}`;
}

/**
 * Applies what viewers sent to the CLI of a terminal, in order.
 *
 * @remarks
 * The web process checks every input before it queues it; this process only
 * takes the queue of its own terminal and writes it to the CLI. An input
 * that arrives after the CLI ended is dropped: there is no shell behind it.
 */
export class TerminalInputs {
  private readonly instanceId: string;
  private readonly store: TerminalHostStore;
  private readonly target: TerminalInputTarget;
  private readonly interrupt: readonly TerminalKeys[];
  private readonly queue = new SerialQueue();
  private unsubscribe: (() => void) | null = null;
  private isDraining = false;

  public constructor(input: {
    readonly instanceId: string;
    readonly store: TerminalHostStore;
    readonly target: TerminalInputTarget;
    readonly interrupt: readonly TerminalKeys[];
  }) {
    this.instanceId = input.instanceId;
    this.store = input.store;
    this.target = input.target;
    this.interrupt = input.interrupt;
  }

  /** Starts taking the inputs of the terminal. */
  public start(signals: TerminalSignalSource): void {
    this.unsubscribe = signals.subscribe("input", this.instanceId, () => {
      void this.drain();
    });
  }

  /** Stops taking inputs; queued ones are dropped with the terminal. */
  public stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Sends text as one paste and then the key that submits it.
   *
   * @param text - The prompt of a step or the multi-line input of a person.
   */
  public async paste(text: string): Promise<void> {
    await this.queue.run(async () => {
      if (!this.target.write(bracketedPaste(text))) return;
      await wait(SUBMIT_DELAY_MS);
      this.target.write("\r");
    });
  }

  /** Interrupts the current step of the agent with the keys of its CLI. */
  public async interruptStep(): Promise<void> {
    await this.queue.run(async () => {
      for (const keys of this.interrupt) {
        if (keys.delayMs > 0) await wait(keys.delayMs);
        this.target.write(keys.data);
      }
    });
  }

  private async drain(): Promise<void> {
    if (this.isDraining) return;
    this.isDraining = true;
    try {
      for (const input of await this.store.takeInputs(this.instanceId))
        await this.apply(input);
    } catch (error: unknown) {
      logCaughtError("TerminalInputs", error);
    } finally {
      this.isDraining = false;
    }
  }

  private async apply(input: AgentTerminalInput): Promise<void> {
    if (input.kind === "paste") {
      await this.paste(input.text);
      return;
    }
    if (input.kind === "interrupt") {
      await this.interruptStep();
      return;
    }
    await this.queue.run(() => {
      if (input.kind === "resize")
        this.target.resize(input.columns, input.rows);
      else this.target.write(input.text);
      return Promise.resolve();
    });
  }
}
