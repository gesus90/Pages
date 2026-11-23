import { logCaughtError } from "@/backend/logging/Logger";
import { wavFromPcm } from "@/backend/service/speech/SpeechSynthesisAudio";
import {
  AGENT_CALL_INPUT_SAMPLE_RATE,
  AGENT_CALL_MAXIMUM_UTTERANCE_MS,
} from "@/definition/AgentCall";

import {
  isSilentUtterance,
  measureUtterance,
  noiseReasonOf,
} from "./AgentCallAudio";

import type {
  AgentCallFailure,
  AgentCallSilenceReason,
} from "@/definition/AgentCall";
import type { SpeechTestOutcome } from "@/definition/SpeechRecognition";

/** What the recognition of one utterance needs. */
export interface AgentCallRecognizerOptions {
  /** Recognizes one complete WAV recording; it may clear the buffer it gets. */
  readonly transcribe: (
    audio: Buffer,
    signal: AbortSignal,
  ) => Promise<SpeechTestOutcome>;
  /** Receives each new preliminary transcript while the person speaks. */
  readonly onPartial: (text: string) => void;
  /** The clock in milliseconds. */
  readonly now: () => number;
}

/** What the utterance gave once it ended. */
export type AgentCallRecognition =
  | {
      readonly kind: "text";
      readonly text: string;
      /** The recognition that ran in the pause covered the whole speech, so no request followed the end. */
      readonly isEarly: boolean;
      readonly partials: number;
      /** From the end message to the final transcript, in milliseconds. */
      readonly finalMs: number;
    }
  | { readonly kind: "silent"; readonly reason: AgentCallSilenceReason }
  | { readonly kind: "failed"; readonly code: AgentCallFailure };

/** One recognition of the first blocks of the utterance. */
interface Attempt {
  readonly blocks: number;
  readonly controller: AbortController;
  readonly result: Promise<SpeechTestOutcome | null>;
}

const BYTES_PER_MS = (AGENT_CALL_INPUT_SAMPLE_RATE * 2) / 1000;

/** The utterance a preliminary transcript first needs, in milliseconds of audio. */
const FIRST_PARTIAL_MS = 700;

/** The least new audio before the next preliminary transcript, in milliseconds. */
const MINIMUM_PARTIAL_STEP_MS = 900;

/**
 * How much the audio has to grow, as a share of what was recognized last,
 * before the next preliminary transcript; the steps widen, so a long
 * utterance costs about twice its length, not its square.
 */
const PARTIAL_GROWTH = 0.6;

/** The longest wait for blocks the end names but that have not arrived. */
const MISSING_BLOCKS_WAIT_MS = 2_000;

const MAXIMUM_AUDIO_BYTES = AGENT_CALL_MAXIMUM_UTTERANCE_MS * BYTES_PER_MS;

const COMPONENT = "AgentCallRecognizer";

/**
 * Recognizes one utterance of a live call while it is spoken.
 * @remarks
 * The browser sends the utterance in small numbered blocks of 16 kHz PCM.
 * The recognizer keeps them in memory in order, ignores a block it already
 * has, and recognizes the growing utterance again at widening steps, so the
 * person sees a preliminary transcript before the end of the speech. A pause
 * starts one recognition at once; if it covered all speech when the end is
 * confirmed, it is the final transcript and no request follows the end.
 * Only one recognition runs at a time. The audio is never stored: every
 * block is cleared when the utterance is over or dropped.
 */
export class AgentCallRecognizer {
  private readonly options: AgentCallRecognizerOptions;
  private readonly blocks = new Map<number, Buffer>();
  private readonly arrival: (() => void)[] = [];
  private bytes = 0;
  private contiguous = 0;
  private contiguousBytes = 0;
  private running: Attempt | null = null;
  private latest: {
    readonly blocks: number;
    readonly outcome: SpeechTestOutcome;
  } | null = null;
  private pausedAt = 0;
  private nextPartialBytes = FIRST_PARTIAL_MS * BYTES_PER_MS;
  private lastPartial = "";
  private partials = 0;
  private isEnded = false;
  private isDiscarded = false;

  public constructor(options: AgentCallRecognizerOptions) {
    this.options = options;
  }

  /**
   * Adds one block of the utterance.
   * @param sequence - The running number of the block, from 0.
   * @param pcm - 16-bit little-endian samples at 16 kHz.
   * @returns `false` when the utterance grew beyond the longest one a turn takes.
   */
  public push(sequence: number, pcm: Buffer): boolean {
    if (this.isDiscarded || this.blocks.has(sequence)) return true;
    this.bytes += pcm.length;
    if (this.bytes > MAXIMUM_AUDIO_BYTES) return false;
    this.blocks.set(sequence, Buffer.from(pcm));
    while (this.blocks.has(this.contiguous)) {
      this.contiguousBytes += this.blocks.get(this.contiguous)?.length ?? 0;
      this.contiguous += 1;
    }
    for (const wake of this.arrival.splice(0)) wake();
    if (!this.isEnded && this.contiguousBytes >= this.nextPartialBytes)
      this.recognizeSoFar(this.contiguous);
    return true;
  }

  /**
   * Tells that the person paused after a number of blocks, so recognition of
   * all speech so far starts now instead of after the end.
   * @param blocks - How many blocks hold the speech before the pause.
   */
  public pause(blocks: number): void {
    if (this.isEnded || this.isDiscarded) return;
    this.pausedAt = Math.min(blocks, this.contiguous);
    if (this.running === null) this.recognizeSoFar(this.pausedAt);
  }

  /**
   * Ends the utterance and gives its final transcript.
   * @param blocks - How many blocks the browser sent.
   * @param voicedBlocks - How many of them hold the speech, before the closing pause.
   * @param signal - Cancels the recognition: the person hung up or dropped it.
   * @returns The transcript, why there is none, or the step that failed.
   */
  public async finish(
    blocks: number,
    voicedBlocks: number,
    signal: AbortSignal,
  ): Promise<AgentCallRecognition> {
    const startedAt = this.options.now();
    this.isEnded = true;
    await this.waitForBlocks(blocks, signal);
    const available = Math.min(blocks, this.contiguous);
    const audio = this.wavOf(available);
    const facts = measureUtterance(audio);
    if (facts === null || facts.durationMs > AGENT_CALL_MAXIMUM_UTTERANCE_MS)
      return { kind: "failed", code: "invalid" };
    // No provider is asked for the end of a recording without sound.
    if (isSilentUtterance(facts)) return { kind: "silent", reason: "silence" };
    const voiced = Math.min(Math.max(1, voicedBlocks), available);
    const early = await this.earlyOutcome(voiced);
    const outcome = early ?? (await this.options.transcribe(audio, signal));
    audio.fill(0);
    if (!outcome.ok)
      return {
        kind: "failed",
        code:
          outcome.code === "not_configured"
            ? "recognition_not_configured"
            : "recognition_failed",
      };
    const noise = noiseReasonOf(outcome.text);
    if (noise !== null) return { kind: "silent", reason: noise };
    return {
      kind: "text",
      text: outcome.text.trim(),
      isEarly: early !== null,
      partials: this.partials,
      finalMs: Math.round(this.options.now() - startedAt),
    };
  }

  /** Drops the utterance: stops its recognition and clears its audio. */
  public discard(): void {
    if (this.isDiscarded) return;
    this.isDiscarded = true;
    this.isEnded = true;
    this.running?.controller.abort();
    this.running = null;
    for (const block of this.blocks.values()) block.fill(0);
    this.blocks.clear();
    for (const wake of this.arrival.splice(0)) wake();
  }

  private wavOf(blocks: number): Buffer {
    const parts: Buffer[] = [];
    for (let index = 0; index < blocks; index += 1) {
      const block = this.blocks.get(index);
      if (block !== undefined) parts.push(block);
    }
    return wavFromPcm(Buffer.concat(parts), {
      sampleRate: AGENT_CALL_INPUT_SAMPLE_RATE,
      channels: 1,
    });
  }

  private async waitForBlocks(
    blocks: number,
    signal: AbortSignal,
  ): Promise<void> {
    const deadline = this.options.now() + MISSING_BLOCKS_WAIT_MS;
    while (
      this.contiguous < blocks &&
      !signal.aborted &&
      !this.isDiscarded &&
      this.options.now() < deadline
    )
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 100);
        this.arrival.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
  }

  // A recognition that covered every block with speech is already the final transcript.
  private async earlyOutcome(
    voiced: number,
  ): Promise<SpeechTestOutcome | null> {
    const running = this.running;
    if (running !== null && running.blocks < voiced) {
      running.controller.abort();
      this.running = null;
    }
    if (this.latest !== null && this.latest.blocks >= voiced)
      return this.latest.outcome.ok ? this.latest.outcome : null;
    if (this.running === null) return null;
    const outcome = await this.running.result;
    return outcome?.ok === true ? outcome : null;
  }

  private recognizeSoFar(blocks: number): void {
    if (this.running !== null || blocks <= (this.latest?.blocks ?? 0)) return;
    const coveredBytes = this.contiguousBytes;
    this.nextPartialBytes = Math.max(
      coveredBytes + MINIMUM_PARTIAL_STEP_MS * BYTES_PER_MS,
      coveredBytes * (1 + PARTIAL_GROWTH),
    );
    const controller = new AbortController();
    const result = this.options
      .transcribe(this.wavOf(blocks), controller.signal)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) logCaughtError(COMPONENT, error);
        return null;
      });
    const attempt: Attempt = { blocks, controller, result };
    this.running = attempt;
    void result.then((outcome) => this.settle(attempt, outcome));
  }

  private settle(attempt: Attempt, outcome: SpeechTestOutcome | null): void {
    if (this.running === attempt) this.running = null;
    if (outcome === null || this.isDiscarded) return;
    if (attempt.blocks > (this.latest?.blocks ?? 0))
      this.latest = { blocks: attempt.blocks, outcome };
    if (!this.isEnded && outcome.ok) this.report(outcome.text.trim());
    if (this.isEnded) return;
    // A pause that came while this recognition ran gets its own recognition now.
    if (this.pausedAt > attempt.blocks) this.recognizeSoFar(this.pausedAt);
    else if (this.contiguousBytes >= this.nextPartialBytes)
      this.recognizeSoFar(this.contiguous);
  }

  private report(text: string): void {
    if (text === this.lastPartial || noiseReasonOf(text) !== null) return;
    this.lastPartial = text;
    this.partials += 1;
    this.options.onPartial(text);
  }
}
