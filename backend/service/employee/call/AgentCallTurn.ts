import { logCaughtError } from "@/backend/logging/Logger";

import { AnswerSentenceSplitter } from "./AgentCallSentences";

import type {
  AgentCallEvent,
  AgentCallFailure,
  AgentCallTimings,
} from "@/definition/AgentCall";
import type { AnswerTap } from "./AgentCallAnswerTap";
import type { AnswerSentence } from "./AgentCallSentences";

/** One sentence of the answer that was handed to the voice, in speaking order. */
export interface SpokenSentence {
  readonly turn: number;
  /** The run of text of the turn the sentence belongs to; a reset starts a new one. */
  readonly segment: number;
  readonly start: number;
  readonly end: number;
  readonly speechLength: number;
}

/** One phrase of the answer the voice speaks. */
export interface AgentCallPhrase {
  /** The position of the phrase in the answer, from 0. */
  readonly index: number;
  readonly text: string;
  readonly signal: AbortSignal;
  /** Called when the first audio of the phrase goes to the browser. */
  readonly markAudio: () => void;
}

/** What speaking one phrase gave. */
export type AgentCallPhraseOutcome =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code:
        "not_configured" | "provider_failed" | "provider_unreachable";
    };

/** What a running turn needs from its call. */
export interface AgentCallTurnOptions {
  /**
   * Speaks one phrase and hands its audio to the browser, whole or in
   * blocks; it never rejects except when the turn was cancelled.
   */
  readonly speak: (phrase: AgentCallPhrase) => Promise<AgentCallPhraseOutcome>;
  readonly emit: (event: AgentCallEvent) => void;
  /** Ends the turn: the person interrupted or hung up. */
  readonly signal: AbortSignal;
  /** The clock in milliseconds. */
  readonly now: () => number;
  /** When the recording of the utterance was complete, on the clock of `now`. */
  readonly startedAt: number;
}

/** How long a turn waits for the end of a job it has stopped, in milliseconds. */
const SETTLE_TIMEOUT_MS = 15_000;

interface Segment {
  readonly id: number;
  readonly splitter: AnswerSentenceSplitter;
  /** How many characters the answer of this run of text has so far. */
  length: number;
}

/**
 * One answer that is spoken while it is written.
 * @remarks
 * The turn hears the text of the running job, cuts it into short phrases and
 * has each phrase spoken in order by the call's speaker, which hands the
 * audio on as soon as it exists, so the first phrase plays while the rest is
 * still written. A cancelled
 * turn drops every sentence that has not been reported yet. It keeps which
 * sentences were handed over, so the stored answer can be marked where an
 * interruption cut the speech.
 */
export class AgentCallTurn implements AnswerTap {
  public readonly sentences: SpokenSentence[] = [];
  public readonly storedMessages = new Map<number, string>();
  private readonly options: AgentCallTurnOptions;
  private readonly startedAt: number;
  private readonly segments = new Map<number, Segment>();
  private readonly endPromise: Promise<void>;
  private readonly markEnded: () => void;
  private speaking: Promise<void> = Promise.resolve();
  private failure: AgentCallFailure | null = null;
  private transcriptMs: number | null = null;
  private firstSentenceMs: number | null = null;
  private firstAudioMs: number | null = null;
  private answerMs: number | null = null;
  private reportedSentences = 0;

  public constructor(options: AgentCallTurnOptions) {
    this.options = options;
    this.startedAt = options.startedAt;
    let resolveEnded: () => void = () => undefined;
    this.endPromise = new Promise<void>((resolve) => {
      resolveEnded = resolve;
    });
    this.markEnded = resolveEnded;
  }

  /** Notes that the recognized text was there. */
  public markTranscript(): void {
    this.transcriptMs = this.elapsed();
  }

  /** How many sentences reached the browser. */
  public get reportedCount(): number {
    return this.reportedSentences;
  }

  /** The times of the turn so far. */
  public timings(): AgentCallTimings {
    return {
      transcriptMs: this.transcriptMs,
      firstSentenceMs: this.firstSentenceMs,
      firstAudioMs: this.firstAudioMs,
      answerMs: this.answerMs,
    };
  }

  /** The step that failed, or `null` while the turn went well. */
  public get failedStep(): AgentCallFailure | null {
    return this.failure;
  }

  /**
   * Takes new text of the answer and hands each finished sentence to the voice.
   * @param turn - The turn of the job the text belongs to.
   * @param delta - The new characters.
   * @param isReset - The text of this turn so far is replaced.
   */
  public text(turn: number, delta: string, isReset: boolean): void {
    let segment = this.segments.get(turn);
    if (segment === undefined || isReset) {
      if (segment !== undefined)
        this.handOver(turn, segment, segment.splitter.flush());
      segment = {
        id: (segment?.id ?? 0) + 1,
        splitter: new AnswerSentenceSplitter(),
        length: 0,
      };
      this.segments.set(turn, segment);
    }
    segment.length += delta.length;
    this.handOver(turn, segment, segment.splitter.push(delta));
  }

  /**
   * Notes the stored message of a turn's answer.
   * @param turn - The turn of the job.
   * @param messageId - The message in the session.
   */
  public stored(turn: number, messageId: string): void {
    this.storedMessages.set(turn, messageId);
  }

  /** Notes that the job ended, so no more text follows. */
  public ended(): void {
    this.answerMs ??= this.elapsed();
    this.markEnded();
  }

  /** The number of characters the answer of a run of text has. */
  public lengthOf(turn: number, segmentId: number): number | null {
    const segment = this.segments.get(turn);
    return segment?.id === segmentId ? segment.length : null;
  }

  /** The last run of text of a turn, or `null` without one. */
  public lastSegmentOf(turn: number): number | null {
    return this.segments.get(turn)?.id ?? null;
  }

  /**
   * Waits for the end of the answer and of its speech.
   * @remarks
   * The rest of the text that had no sentence end yet is spoken as the last
   * sentence. A cancelled turn waits only a short time for the stopped job to report its end.
   */
  public async finish(): Promise<void> {
    const { signal } = this.options;
    await Promise.race([this.endPromise, this.waitAfterCancel()]);
    if (!signal.aborted)
      for (const [turn, segment] of this.segments)
        this.handOver(turn, segment, segment.splitter.flush());
    await this.speaking;
  }

  // A running answer is awaited to its end; a cancelled one only for a short time.
  private waitAfterCancel(): Promise<void> {
    const { signal } = this.options;
    return new Promise<void>((resolve) => {
      const arm = (): void => {
        const timer = setTimeout(resolve, SETTLE_TIMEOUT_MS);
        void this.endPromise.then(() => clearTimeout(timer));
      };
      if (signal.aborted) arm();
      else signal.addEventListener("abort", arm, { once: true });
    });
  }

  private handOver(
    turn: number,
    segment: Segment,
    sentences: readonly AnswerSentence[],
  ): void {
    for (const sentence of sentences) {
      this.sentences.push({
        turn,
        segment: segment.id,
        start: sentence.start,
        end: sentence.end,
        speechLength: sentence.speech.length,
      });
      this.firstSentenceMs ??= this.elapsed();
      const index = this.sentences.length - 1;
      this.speaking = this.speaking.then(() => this.speakOne(index, sentence));
    }
  }

  private async speakOne(
    index: number,
    sentence: AnswerSentence,
  ): Promise<void> {
    const { signal } = this.options;
    if (signal.aborted || this.failure !== null) return;
    let outcome: AgentCallPhraseOutcome;
    try {
      outcome = await this.options.speak({
        index,
        text: sentence.speech,
        signal,
        markAudio: () => {
          this.firstAudioMs ??= this.elapsed();
        },
      });
    } catch (error: unknown) {
      if (!signal.aborted) logCaughtError("AgentCallTurn", error);
      return;
    }
    if (signal.aborted) return;
    if (!outcome.ok) {
      this.failure =
        outcome.code === "not_configured"
          ? "synthesis_not_configured"
          : "synthesis_failed";
      this.options.emit({ type: "failed", code: this.failure });
      return;
    }
    this.reportedSentences += 1;
  }

  private elapsed(): number {
    return Math.round(this.options.now() - this.startedAt);
  }
}
