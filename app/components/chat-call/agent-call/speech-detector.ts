import {
  encodeWav,
  joinSamples,
  resampleTo16k,
} from "@/app/components/settings/agents/speech-settings/wav-recording";

/** How an utterance of the streaming detector ended. */
export interface SpeechEnding {
  /** When the speech ended, on the clock of `performance.now()`. */
  readonly endedAt: number;
  /** How many of the blocks sent last belong to the closing pause. */
  readonly trailingBlocks: number;
  /** `false` when the utterance was shorter than a word or muted, so nothing may come of it. */
  readonly isKept: boolean;
}

/** What the detector tells about the voice of the person. */
export interface SpeechDetectorEvents {
  /** The person began to speak; while the agent plays this takes longer speech. */
  readonly onSpeechStart: () => void;
  /** The person finished an utterance of real speech: a 16 kHz WAV file and when the speech ended. */
  readonly onUtterance?: (audio: Blob, endedAt: number) => void;
  /** Streaming: one block of the running utterance as 16-bit samples at 16 kHz, from its start on. */
  readonly onBlock?: (samples: Int16Array) => void;
  /** Streaming: the person has paused; `trailingBlocks` of the blocks sent are this pause. */
  readonly onPause?: (trailingBlocks: number) => void;
  /** Streaming: the utterance is over. */
  readonly onEnd?: (ending: SpeechEnding) => void;
  /** The person's input level, from 0 to 1, for the display. */
  readonly onLevel?: (level: number) => void;
}

const BLOCK_SIZE = 2048;

/** The level below which nothing counts as speech, whatever the room sounds like. */
const MINIMUM_THRESHOLD = 0.015;

/** How much louder than the background a block has to be. */
const NOISE_FACTOR = 3;

/** How long the person has to be quiet before the utterance is over, in milliseconds. */
const END_SILENCE_MS = 600;

/** The speech it takes to start an utterance, in milliseconds; a click is shorter. */
const START_SPEECH_MS = 90;

/** While the agent plays, speech has to last this long to interrupt it. */
const INTERRUPT_SPEECH_MS = 240;

/** The shortest stretch of speech that is sent, in milliseconds. */
const MINIMUM_UTTERANCE_MS = 300;

/** The longest utterance; a longer one is cut here and sent. */
const MAXIMUM_UTTERANCE_MS = 30_000;

/** The sound before the first loud block that is kept, in milliseconds. */
const PREROLL_MS = 300;

/** The quiet after which recognition may start before the end is certain, in milliseconds. */
const PAUSE_HINT_MS = 200;

/** Turns a block of the microphone into 16-bit samples at 16 kHz. */
function pcmBlockOf(block: Float32Array, sampleRate: number): Int16Array {
  const samples = resampleTo16k(block, sampleRate);
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return pcm;
}

function levelOf(block: Float32Array): number {
  let sum = 0;
  for (const sample of block) sum += sample * sample;
  return Math.sqrt(sum / block.length);
}

/**
 * Finds the speech in the microphone of a call, on the device, before anything
 * is sent.
 * @remarks
 * A level detector with an adaptive background: a block is speech when it is
 * clearly louder than the quiet of the room. Speech starts an utterance, a
 * pause ends it, and an utterance shorter than a word is dropped. Muting
 * throws away what is being recorded and sends nothing until it is lifted.
 * While the agent plays, a longer speech is needed to start an utterance, so
 * the agent's own voice does not interrupt it. With `onBlock` the detector
 * streams: it hands each block of the utterance on as it is heard, tells
 * an early pause and the end, and encodes no file.
 */
export class SpeechDetector {
  private readonly events: SpeechDetectorEvents;
  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly processor: ScriptProcessorNode;
  private readonly preroll: Float32Array[] = [];
  private utterance: Float32Array[] = [];
  private background = MINIMUM_THRESHOLD / NOISE_FACTOR;
  private loudMs = 0;
  private quietMs = 0;
  private speechMs = 0;
  private isSpeaking = false;
  private isPauseTold = false;
  private quietBlocks = 0;
  private isMuted = false;
  private isAgentPlaying = false;
  private isClosed = false;

  public constructor(stream: MediaStream, events: SpeechDetectorEvents) {
    this.events = events;
    this.context = new AudioContext();
    this.source = this.context.createMediaStreamSource(stream);
    this.processor = this.context.createScriptProcessor(BLOCK_SIZE, 1, 1);
    this.processor.onaudioprocess = (event) => {
      this.handleBlock(new Float32Array(event.inputBuffer.getChannelData(0)));
    };
    this.source.connect(this.processor);
    // A processor only runs while it is connected to the output; its output stays silent.
    this.processor.connect(this.context.destination);
  }

  /**
   * Mutes or unmutes the detector.
   * @param isMuted - Whether nothing the microphone hears may be sent.
   */
  public setMuted(isMuted: boolean): void {
    this.isMuted = isMuted;
    if (isMuted) this.drop();
  }

  /**
   * Tells whether the agent is playing, which raises the proof speech needs.
   * @param isPlaying - Whether the agent's voice is audible now.
   */
  public setAgentPlaying(isPlaying: boolean): void {
    this.isAgentPlaying = isPlaying;
  }

  /** Stops listening and drops what was recorded. */
  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.processor.onaudioprocess = null;
    this.source.disconnect();
    this.processor.disconnect();
    this.drop();
    void this.context.close();
  }

  private handleBlock(block: Float32Array): void {
    if (this.isClosed) return;
    const blockMs = (block.length / this.context.sampleRate) * 1000;
    if (this.isMuted) {
      this.events.onLevel?.(0);
      return;
    }
    const level = levelOf(block);
    this.events.onLevel?.(Math.min(1, level * 8));
    const threshold = Math.max(
      MINIMUM_THRESHOLD,
      this.background * NOISE_FACTOR,
    );
    if (level >= threshold) this.hearSpeech(block, blockMs);
    else this.hearQuiet(block, blockMs, level);
  }

  private hearSpeech(block: Float32Array, blockMs: number): void {
    this.loudMs += blockMs;
    this.quietMs = 0;
    if (!this.isSpeaking) {
      this.rememberPreroll(block, blockMs);
      const needed = this.isAgentPlaying
        ? INTERRUPT_SPEECH_MS
        : START_SPEECH_MS;
      if (this.loudMs < needed) return;
      this.isSpeaking = true;
      this.utterance = [...this.preroll];
      this.preroll.length = 0;
      this.speechMs = this.loudMs;
      this.events.onSpeechStart();
      for (const kept of this.utterance) this.stream(kept);
      return;
    }
    this.utterance.push(block);
    this.stream(block);
    this.quietBlocks = 0;
    this.isPauseTold = false;
    this.speechMs += blockMs;
    if (this.utterance.length * blockMs >= MAXIMUM_UTTERANCE_MS) this.finish();
  }

  private hearQuiet(block: Float32Array, blockMs: number, level: number): void {
    if (!this.isSpeaking) {
      this.loudMs = 0;
      // The background follows the room slowly and never jumps to a speech level.
      this.background = this.background * 0.95 + level * 0.05;
      this.rememberPreroll(block, blockMs);
      return;
    }
    this.utterance.push(block);
    this.stream(block);
    this.quietMs += blockMs;
    this.quietBlocks += 1;
    if (
      !this.isPauseTold &&
      this.quietMs >= PAUSE_HINT_MS &&
      this.speechMs >= MINIMUM_UTTERANCE_MS
    ) {
      this.isPauseTold = true;
      this.events.onPause?.(this.quietBlocks);
    }
    if (this.quietMs >= END_SILENCE_MS) this.finish();
  }

  private stream(block: Float32Array): void {
    this.events.onBlock?.(pcmBlockOf(block, this.context.sampleRate));
  }

  private rememberPreroll(block: Float32Array, blockMs: number): void {
    this.preroll.push(block);
    const kept = Math.ceil(PREROLL_MS / blockMs);
    while (this.preroll.length > kept) this.preroll.shift();
  }

  private finish(): void {
    const isLongEnough = this.speechMs >= MINIMUM_UTTERANCE_MS;
    const blocks = this.utterance;
    const endedAt = performance.now() - this.quietMs;
    const trailingBlocks = this.quietBlocks;
    this.reset();
    this.events.onEnd?.({ endedAt, trailingBlocks, isKept: isLongEnough });
    if (!isLongEnough || this.events.onUtterance === undefined) return;
    const samples = resampleTo16k(joinSamples(blocks), this.context.sampleRate);
    this.events.onUtterance(encodeWav(samples), endedAt);
  }

  // A running utterance that is thrown away still tells its end, so a stream is closed.
  private drop(): void {
    const wasSpeaking = this.isSpeaking;
    this.reset();
    if (wasSpeaking)
      this.events.onEnd?.({
        endedAt: performance.now(),
        trailingBlocks: 0,
        isKept: false,
      });
  }

  private reset(): void {
    this.utterance = [];
    this.preroll.length = 0;
    this.loudMs = 0;
    this.quietMs = 0;
    this.speechMs = 0;
    this.quietBlocks = 0;
    this.isPauseTold = false;
    this.isSpeaking = false;
  }
}
