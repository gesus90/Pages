import { SerialQueue } from "@/backend/concurrency/SerialQueue";
import { logCaughtError, logDiagnostic } from "@/backend/logging/Logger";
import {
  TERMINAL_SEGMENT_CHARACTERS,
  TERMINAL_SESSION_CHARACTERS,
} from "@/definition/AgentTerminal";

import type { TerminalRedactor } from "./TerminalRedactor";
import type { TerminalScreen } from "./TerminalScreen";
import type { TerminalHostStore } from "./TerminalStore";

/** Output is gathered this long before it becomes a segment. */
const SEGMENT_DELAY_MS = 40;

/** Held output of the redactor is released after this pause of the CLI. */
const RELEASE_DELAY_MS = 250;

/** The screen of a viewer that opens the terminal is stored at most this often. */
const SCREEN_INTERVAL_MS = 2_000;

/** The size limit of a session is checked after this much new output. */
const RETENTION_CHECK_CHARACTERS = 256 * 1024;

/**
 * Turns the raw output of a terminal CLI into redacted, numbered segments.
 *
 * @remarks
 * Every chunk passes the redactor first; nothing unredacted is stored, shown
 * or answered. Output is gathered for a few milliseconds and stored as one
 * segment, so a busy CLI writes a few segments per second. The screen of the
 * server applies each segment after it was stored, so a stored screen always
 * matches its sequence exactly; it is saved every two seconds while the
 * output changes and once at the end. A storage failure is logged and never
 * stops the CLI: the run does not depend on its log.
 */
export class TerminalRecorder {
  private readonly instanceId: string;
  private readonly store: TerminalHostStore;
  private readonly redactor: TerminalRedactor;
  private readonly screen: TerminalScreen;
  private readonly writes = new SerialQueue();
  private buffer = "";
  private segmentTimer: ReturnType<typeof setTimeout> | null = null;
  private releaseTimer: ReturnType<typeof setTimeout> | null = null;
  private screenTimer: ReturnType<typeof setTimeout> | null = null;
  private lastSequence = 0;
  private savedSequence = 0;
  private sinceRetention = 0;
  private hasWarned = false;
  private lastOutputAt = Date.now();

  public constructor(input: {
    readonly instanceId: string;
    readonly store: TerminalHostStore;
    readonly redactor: TerminalRedactor;
    readonly screen: TerminalScreen;
  }) {
    this.instanceId = input.instanceId;
    this.store = input.store;
    this.redactor = input.redactor;
    this.screen = input.screen;
  }

  /** When the CLI wrote last, in milliseconds since the epoch. */
  public get lastActivity(): number {
    return this.lastOutputAt;
  }

  /**
   * Takes a raw chunk of the CLI.
   *
   * @param raw - Output as the pseudo terminal delivered it.
   */
  public receive(raw: string): void {
    this.lastOutputAt = Date.now();
    this.add(this.redactor.push(raw));
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    this.releaseTimer = this.redactor.hasPending
      ? setTimeout(() => {
          this.releaseTimer = null;
          this.add(this.redactor.flush());
        }, RELEASE_DELAY_MS)
      : null;
  }

  /** Stores everything received so far and the final screen. */
  public async finish(): Promise<void> {
    if (this.releaseTimer !== null) clearTimeout(this.releaseTimer);
    if (this.screenTimer !== null) clearTimeout(this.screenTimer);
    this.releaseTimer = null;
    this.screenTimer = null;
    this.add(this.redactor.flush());
    this.flushSegment();
    await this.writes.run(() => this.saveScreen());
  }

  private add(chunk: string): void {
    if (chunk.length === 0) return;
    this.buffer += chunk;
    if (this.buffer.length >= TERMINAL_SEGMENT_CHARACTERS) {
      this.flushSegment();
      return;
    }
    this.segmentTimer ??= setTimeout(
      () => this.flushSegment(),
      SEGMENT_DELAY_MS,
    );
  }

  private flushSegment(): void {
    if (this.segmentTimer !== null) clearTimeout(this.segmentTimer);
    this.segmentTimer = null;
    while (this.buffer.length > 0) {
      const body = this.buffer.slice(0, TERMINAL_SEGMENT_CHARACTERS);
      this.buffer = this.buffer.slice(body.length);
      void this.writes.run(() => this.persist(body));
    }
  }

  private async persist(body: string): Promise<void> {
    try {
      const sequence = await this.store.append(this.instanceId, body);
      await this.screen.write(body);
      if (sequence === null) return;
      this.lastSequence = sequence;
      this.sinceRetention += body.length;
      if (this.sinceRetention >= RETENTION_CHECK_CHARACTERS) {
        this.sinceRetention = 0;
        await this.store.retain(this.instanceId, TERMINAL_SESSION_CHARACTERS);
      }
      this.screenTimer ??= setTimeout(() => {
        this.screenTimer = null;
        void this.writes.run(() => this.saveScreen());
      }, SCREEN_INTERVAL_MS);
    } catch (error: unknown) {
      this.warn(error);
    }
  }

  private async saveScreen(): Promise<void> {
    if (this.lastSequence === this.savedSequence) return;
    try {
      const sequence = this.lastSequence;
      await this.store.saveScreen(this.instanceId, {
        screen: await this.screen.snapshot(),
        sequence,
        isAlternateScreen: this.screen.isAlternateScreen,
        ...this.screen.size,
      });
      this.savedSequence = sequence;
    } catch (error: unknown) {
      this.warn(error);
    }
  }

  private warn(error: unknown): void {
    logCaughtError("TerminalRecorder", error);
    if (this.hasWarned) return;
    this.hasWarned = true;
    logDiagnostic(
      "TerminalRecorder",
      "warn",
      "Pages could not store part of a plan terminal; the CLI keeps running.",
      error,
    );
  }
}
